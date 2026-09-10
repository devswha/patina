import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, request as httpRequest } from 'node:http';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRewriteThread, streamRewrite } from '../../playground/rewrite-client.js';
import { applyTextEdits } from '../../src/edit-controls.js';
import { scoreDeterministicSignals } from '../../src/scoring.js';
import { loadWebConfig } from '../../src/web-config.js';
import { sha256 } from '../../src/web-rewrite-receipt.js';
import { evaluateVerification, validateMps, validateFidelityResult } from '../../src/verification-schema.js';
import { highHardFailMps, mpsResult } from '../fixtures/verification-results.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const ORIGINAL = 'It is important to note that we retain 12 audit logs.';
const REWRITTEN = 'We retain 12 audit logs.';

test('preview validates same-origin funnel milestones without production storage', async (t) => {
  const base = await startPreview(t);
  const event = { name: 'Funnel Progress', data: { lang: 'ko', channel: 'community', campaign: 'multilingual-20260907', stage: 'arrival' } };
  const send = (body, origin = new URL(base).origin) => fetch(new URL('/api/funnel', base), {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, 'Sec-Fetch-Site': 'same-origin' },
    body: JSON.stringify(body),
  });
  const accepted = await send(event);
  assert.equal(accepted.status, 204);
  assert.equal(accepted.headers.get('x-patina-mock'), '1');
  assert.equal((await send({ ...event, data: { ...event.data, text: 'must not be accepted' } })).status, 400);
  assert.equal((await send(event, 'https://example.invalid')).status, 403);
});

async function startPreview(t, { root = ROOT, env = {} } = {}) {
  const child = spawn(process.execPath, [path.join(root, 'scripts/dev-server.mjs'), '--host', '127.0.0.1', '--port', '0'], {
    cwd: root,
    env: {
      ...process.env,
      PATINA_DEV_LLM_BASE_URL: '', PATINA_DEV_LLM_KEY: '', PATINA_DEV_LLM_MODEL: '', PATINA_DEV_LLM_SCORE: '',
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stderr.on('data', (chunk) => { output += chunk; });
  t.after(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill();
    const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
    try { await exited; } finally { clearTimeout(timer); }
  });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Preview startup timed out: ${output}`)), 10000);
    const onError = (error) => { clearTimeout(timer); reject(error); };
    const onExit = () => onError(new Error(`Preview exited before listening: ${output}`));
    child.once('error', onError);
    child.once('exit', onExit);
    child.stdout.on('data', (chunk) => {
      output += chunk;
      const address = output.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0];
      if (!address) return;
      clearTimeout(timer);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
      resolve(address);
    });
  });
}

// Use node:http so encoded/dot traversal reaches the server unchanged by fetch's URL parser.
function request(base, route, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(base, {
      path: route, method, agent: false,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.setTimeout(10000, () => req.destroy(new Error(`Request timed out: ${route}`)));
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

function frames(response) {
  assert.equal(response.status, 200, response.body);
  assert.match(response.headers['content-type'], /application\/x-ndjson/);
  return response.body.trim().split('\n').map((line) => JSON.parse(line));
}

function assertPreviewScores(done) {
  assert.equal(done.type, 'done', JSON.stringify(done));
  validateMps(done.mps);
  validateFidelityResult(done.fidelity);
  assert.deepEqual(evaluateVerification(done), { ok: true, failed: [] });
  for (const scores of [done, done.receipt.verification]) {
    for (const name of ['mps', 'fidelity']) {
      assert.equal(scores[name].previewOnly, true);
      assert.equal(scores[name].verdict, 'preview');
    }
  }
}

test('loopback preview serves the browser dependency graph and completes a real handler request', { timeout: 30000 }, async (t) => {
  const base = await startPreview(t);

  await t.test('HTML, styles, images and all transitive static imports match the public files', async () => {
    const pending = ['/'];
    const loaded = new Set();
    while (pending.length) {
      const route = pending.shift();
      if (loaded.has(route)) continue;
      loaded.add(route);
      const response = await request(base, route);
      assert.equal(response.status, 200, route);
      const file = path.join(ROOT, 'playground', route === '/' ? 'index.html' : route);
      assert.equal(response.body, await readFile(file, 'utf8'), `public-root parity: ${route}`);
      const type = response.headers['content-type'];
      assert.match(type, route === '/' ? /text\/html/ : route.endsWith('.js') ? /javascript/ : route.endsWith('.css') ? /text\/css/ : /image\/svg\+xml/);
      const refs = [];
      if (route === '/') {
        refs.push(...[...response.body.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)].map((match) => match[1]));
      } else if (route.endsWith('.js')) {
        refs.push(...[...response.body.matchAll(/\b(?:import|export)\s+(?:[^;]*?\s+from\s*)?["']([^"']+)["']/g)].map((match) => match[1]));
      } else if (route.endsWith('.css')) {
        refs.push(...[...response.body.matchAll(/url\(\s*["']?([^\s)"']+)/g)].map((match) => match[1]));
      }
      for (const ref of refs) {
        if (ref.startsWith('#')) continue;
        const target = new URL(ref, new URL(route, base));
        if (target.origin === new URL(base).origin) pending.push(target.pathname);
      }
    }
    for (const route of ['/preferences.js', '/experience-copy.js', '/edit-review.js', '/protected-input.js', '/edit-review.css', '/src/web-rewrite-contract.js', '/src/edit-controls.js',
      '/examples/index.js', '/examples/ko.js', '/examples/en.js', '/examples/zh.js', '/examples/ja.js']) {
      assert.ok(loaded.has(route), `${route} must be reachable from the page`);
    }
    const contract = await request(base, '/src/web-rewrite-contract.js');
    assert.match(contract.body, /export const WEB_DOCUMENT_TYPES/);
    assert.match(contract.body, /'default', 'blog', 'academic'/);
  });

  await t.test('HEAD, query strings, encoded filenames and safe SPA paths still work', async () => {
    const get = await request(base, '/launch-config.js');
    const head = await request(base, '/launch-config.js?version=preview', { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(head.body, '');
    assert.equal(Number(head.headers['content-length']), Buffer.byteLength(get.body));
    assert.equal(head.headers['content-type'], 'application/javascript; charset=utf-8');
    assert.equal(head.headers['cache-control'], 'no-store, max-age=0');
    assert.equal((await request(base, '/%70references.js?version=1')).body, (await request(base, '/preferences.js')).body);
    assert.equal((await request(base, '/draft/session')).body, (await request(base, '/')).body);
    assert.equal((await request(base, '/missing.js')).status, 404);
    assert.equal((await request(base, '/chatgpt.js', { method: 'POST' })).status, 405);
  });

  await t.test('raw malformed paths, traversal and private repo files never get a successful fallback', async () => {
    for (const route of ['/%ff', '/%E0%A4%A', '/%', '/%00', '/chatgpt.js%00', '/api/%', '//[invalid']) {
      assert.equal((await request(base, route)).status, 400, route);
    }
    for (const route of ['/../package.json', '/%2e%2e/package.json', '/%2E%2E%2Fpackage.json', '/assets/../../package.json', '/src/%2e%2e/%2e%2e/.env', '/..%5cpackage.json', '/.git', '/.git/config', '/%2eenv', '/.env.example', '/assets/.env']) {
      assert.equal((await request(base, route)).status, 403, route);
    }
    for (const route of ['/package.json', '/src/api.js', '/scripts/dev-server.mjs', '/node_modules/js-yaml/package.json', '/README.md', '/docs/internal/secret.json', '/playground/README.md', '/%252e%252e/package.json']) {
      assert.equal((await request(base, route)).status, 404, route);
    }
    assert.equal((await request(base, '/preferences.js')).status, 200, 'bad requests must not crash the server');
  });

  await t.test('browser client accepts streamed deltas, preview scores, receipt and edit review', async () => {
    const thread = createRewriteThread({ lang: 'en', documentType: 'default' });
    const events = [];
    let responseHeaders;
    const result = await streamRewrite({
      url: new URL('/api/rewrite', base).href,
      body: { ...thread.buildRequest({ text: ORIGINAL, tier: 'free' }), includeEdits: true },
      fetchImpl: async (...args) => {
        const response = await fetch(...args);
        responseHeaders = response.headers;
        return response;
      },
      onStart: () => events.push('start'),
      onDelta: (text) => events.push(text),
      onDone: () => events.push('done'),
      onError: (error) => assert.fail(JSON.stringify(error)),
    });
    assert.equal(result.ok, true);
    assert.equal(responseHeaders.get('x-patina-mock'), '1');
    assert.equal(responseHeaders.get('cache-control'), 'no-store');
    const done = result.finalFrame;
    assertPreviewScores(done);
    assert.equal(events[0], 'start');
    assert.equal(events.at(-1), 'done');
    assert.equal(events.slice(1, -1).join(''), REWRITTEN);
    assert.equal(done.rewrite, REWRITTEN);
    assert.equal(done.receipt.hashes.original, sha256(ORIGINAL));
    assert.equal(done.receipt.hashes.output, sha256(REWRITTEN));
    assert.equal(done.editReview.baseHash, sha256(ORIGINAL));
    assert.equal(applyTextEdits(ORIGINAL, done.editReview.edits), REWRITTEN);
    const config = { ...loadWebConfig({ repoRoot: ROOT }), language: 'en', documentType: 'default' };
    assert.deepEqual(done.signals.before, scoreDeterministicSignals({ text: ORIGINAL, config, repoRoot: ROOT }));
    assert.deepEqual(done.signals.after, scoreDeterministicSignals({ text: REWRITTEN, config, repoRoot: ROOT }));
    assert.equal(done.diff.beforeChars, ORIGINAL.length);
    assert.equal(done.diff.afterChars, REWRITTEN.length);
    thread.commit({ userText: ORIGINAL, assistantText: done.rewrite });
    assert.equal(thread.currentDraft, REWRITTEN);
    assert.doesNotMatch(JSON.stringify(done), /local-mock-key/);
  });

  await t.test('mock scores cannot bypass input, number or protected-text checks', async () => {
    const body = { mode: 'first', tier: 'free', lang: 'en', text: ORIGINAL };
    assert.equal((await request(base, '/api/rewrite', { method: 'POST', body: { ...body, documentType: 'unknown' } })).status, 400);
    for (const [extra, code] of [
      [{ protectedSpans: [{ start: 0, end: ORIGINAL.length }] }, 'protected_text_failed'],
      [{ mode: 'verify', original: ORIGINAL, text: 'We retain audit logs.', baseHash: sha256(ORIGINAL) }, 'number_safety_failed'],
    ]) {
      const output = frames(await request(base, '/api/rewrite', { method: 'POST', body: { ...body, ...extra } }));
      assert.equal(output.at(-1).code, code);
      assert.equal(output.some((frame) => frame.type === 'done'), false);
    }
  });
});

test('public-root symlinks cannot expose private or hidden files', { timeout: 15000 }, async (t) => {
  // All filesystem probes live in a disposable replica, never in the shared playground.
  const root = await mkdtemp(path.join(tmpdir(), 'patina-preview-static-'));
  await mkdir(path.join(root, 'scripts'));
  await cp(path.join(ROOT, 'scripts/dev-server.mjs'), path.join(root, 'scripts/dev-server.mjs'));
  await mkdir(path.join(root, 'api'));
  await cp(path.join(ROOT, 'api/funnel.js'), path.join(root, 'api/funnel.js'));
  await cp(path.join(ROOT, 'playground'), path.join(root, 'playground'), { recursive: true });
  await symlink(path.join(ROOT, 'src'), path.join(root, 'src'), 'dir');
  await mkdir(path.join(root, 'playground-private'));
  await writeFile(path.join(root, 'playground-private', 'secret.js'), 'private sentinel');
  await writeFile(path.join(root, 'playground', '.secret.js'), 'hidden sentinel');
  await symlink('../playground-private/secret.js', path.join(root, 'playground', 'outside.js'));
  await symlink('.secret.js', path.join(root, 'playground', 'hidden.js'));
  await symlink('preferences.js', path.join(root, 'playground', 'public-alias.js'));
  const base = await startPreview(t, { root });
  // t.after hooks run in registration order and a failed hook skips the
  // rest: the replica rm must be registered AFTER startPreview's kill hook,
  // or a win32 EBUSY (the child still holds root as cwd) would leak the
  // server and hang the worker. maxRetries absorbs the handle-release lag.
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }));
  for (const route of ['/outside.js', '/hidden.js', '/.secret.js']) {
    const response = await request(base, route);
    assert.equal(response.status, 403, route);
    assert.doesNotMatch(response.body, /sentinel/);
  }
  assert.equal((await request(base, '/public-alias.js')).body, (await request(base, '/preferences.js')).body);
});

test('DEV_LLM transport uses preview fixtures only when real scoring is disabled', { timeout: 30000 }, async (t) => {
  let scenario = 'valid';
  const calls = [];
  const provider = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    assert.equal(req.url, '/v1/chat/completions');
    if (body.stream) {
      calls.push('rewrite');
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: REWRITTEN } }] })}\n\ndata: [DONE]\n\n`);
      return;
    }
    const isMps = body.messages.some((message) => message.content.includes('Meaning Preservation evaluator'));
    calls.push(isMps ? 'mps' : 'fidelity');
    const content = isMps
      ? scenario === 'malformed' ? { mps: 100 } : scenario === 'hard-fail' ? highHardFailMps() : mpsResult()
      : { claims_preserved: 3, no_fabrication: 3, audience_register_match: 3 };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }));
  });
  t.after(() => {
    provider.closeAllConnections();
    return new Promise((resolve) => provider.close(resolve));
  });
  await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve));
  const env = {
    PATINA_DEV_LLM_BASE_URL: `http://127.0.0.1:${provider.address().port}/v1`,
    PATINA_DEV_LLM_KEY: 'local-provider-test-key', PATINA_DEV_LLM_MODEL: 'local-test-model',
  };
  const body = { mode: 'first', tier: 'free', lang: 'en', text: ORIGINAL };
  await t.test('default DEV_LLM scoring returns schema-complete, explicitly preview-only scores', async (t) => {
    const base = await startPreview(t, { env });
    const output = frames(await request(base, '/api/rewrite', { method: 'POST', body }));
    assertPreviewScores(output.at(-1));
    assert.equal(output.at(-1).rewrite, REWRITTEN);
    assert.deepEqual(calls, ['rewrite']);
  });
  await t.test('real scoring still accepts valid evidence and rejects malformed or HARD_FAIL evidence', async (t) => {
    const base = await startPreview(t, { env: { ...env, PATINA_DEV_LLM_SCORE: 'real' } });
    for (scenario of ['valid', 'malformed', 'hard-fail']) {
      calls.length = 0;
      const output = frames(await request(base, '/api/rewrite', { method: 'POST', body }));
      const terminal = output.at(-1);
      assert.equal(terminal.type, scenario === 'valid' ? 'done' : 'error', JSON.stringify(terminal));
      if (scenario === 'valid') assert.equal(evaluateVerification(terminal).ok, true);
      else {
        assert.equal(terminal.code, 'floor_failed');
        assert.deepEqual(terminal.failed, ['mps']);
      }
      assert.equal(terminal.mps.previewOnly, undefined);
      assert.equal(terminal.fidelity.previewOnly, undefined);
      assert.equal(calls.filter((stage) => stage === 'rewrite').length, 1);
      assert.equal(calls.filter((stage) => stage === 'mps').length, scenario === 'malformed' ? 2 : 1);
      assert.equal(calls.filter((stage) => stage === 'fidelity').length, 1);
    }
  });
});
