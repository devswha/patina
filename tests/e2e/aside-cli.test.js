import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { saveAsideSettings, readAsideSettings } from '../../src/aside/options.js';

const cli = fileURLToPath(new URL('../../bin/patina.js', import.meta.url));
function command(args, cwd, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'aside', ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let stdout = '', stderr = '';
    child.stdout.on('data', value => { stdout += value; });
    child.stderr.on('data', value => { stderr += value; });
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('aside CLI did not finish')); }, 15000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}
async function workspace(t, { autoClean = true } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'patina-aside-cli-'));
  if (autoClean) t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('aside CLI discovers its skill and detached options session persists to status', async (t) => {
  // No autoClean: the session-close hook and the rm must run in that order.
  // t.after hooks run in registration order and a failed hook skips the
  // rest, so the rm is registered after the close below; on win32 an rm
  // racing the live detached server fails EBUSY and would skip the close.
  const dir = await workspace(t, { autoClean: false });
  const skill = await command(['skill'], dir);
  assert.equal(skill.code, 0);
  const bundle = JSON.parse(skill.stdout);
  assert.equal(bundle.content, await readFile(bundle.path, 'utf8'));
  assert.match(bundle.content, /name: patina-aside/);
  const initial = await command(['status', '--workspace', dir], dir);
  assert.equal(JSON.parse(initial.stdout).configured, false);
  const launched = await command(['options', '--workspace', dir], dir);
  assert.equal(launched.code, 0);
  const session = JSON.parse(launched.stdout);
  const url = new URL(session.url);
  const headers = { 'X-Patina-Session': url.hash.slice(1), Origin: url.origin, 'Content-Type': 'application/json' };
  t.after(async () => {
    await fetch(`${url.origin}/api/close`, { method: 'POST', headers, body: '{}' }).catch(() => {});
    // The detached server exits asynchronously, and win32 cannot remove the
    // workspace while the process still holds it as its cwd (EBUSY). Wait
    // for the port to stop answering before the workspace rm runs.
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      try {
        await fetch(`${url.origin}/api/options`, { headers, signal: AbortSignal.timeout(500) });
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch {
        return;
      }
    }
  });
  t.after(() => rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }));
  const state = await (await fetch(`${url.origin}/api/options`, { headers })).json();
  const settings = { ...state.settings, language: 'ko', register: 'professional' };
  assert.equal((await fetch(`${url.origin}/api/options`, { method: 'POST', headers, body: JSON.stringify({ settings, baseHash: state.settingsHash }) })).status, 200);
  const persisted = JSON.parse((await command(['status', '--workspace', dir], dir)).stdout);
  assert.equal(persisted.settings.language, 'ko');
  assert.equal(persisted.settings.register, 'professional');
  assert.equal(persisted.configured, true);
});

test('aside CLI applies selected/per-run options and never writes a rejected candidate', async (t) => {
  const dir = await workspace(t);
  await mkdir(join(dir, 'runtime'));
  const source = 'Patina keeps 12 records.\n\nIn conclusion, our team reviews each record.';
  const rewritten = 'Patina keeps 12 records.\n\nOur team reviews each record.';
  await writeFile(join(dir, 'draft.md'), source);
  const requests = [];
  let fail = false;
  const server = createServer(async (req, res) => {
    let data = ''; for await (const chunk of req) data += chunk;
    const body = JSON.parse(data); requests.push(body);
    const prompt = body.messages.map(message => message.content).join('\n');
    let content = rewritten;
    if (prompt.includes('Meaning Preservation evaluator')) {
      content = JSON.stringify({ anchors: [{ type: 'claim', content: 'Patina keeps 12 records.', verdict: fail ? 'SOFT_FAIL' : 'PASS' }],
        pass_count: fail ? 0 : 1, total_count: 1, polarity_pass_count: 0, polarity_total_count: 0, mps: fail ? 0 : 100 });
    } else if (prompt.includes('claims_preserved') && prompt.includes('no_fabrication')) {
      content = JSON.stringify({ claims_preserved: 3, no_fabrication: 3, audience_register_match: 3 });
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content } }], model: body.model }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const baseURL = `http://127.0.0.1:${server.address().port}/v1`;
  await writeFile(join(dir, '.patina.yaml'), JSON.stringify({ provider: 'openai', baseURL, backend: 'openai-http', model: 'fixture-model' }));
  await saveAsideSettings(dir, { language: 'en', documentType: 'blog', register: 'professional', backend: 'openai-http', model: 'fixture-model', protectedTerms: ['Patina'] });
  const saved = await readAsideSettings(dir);
  const env = { ...process.env, TMPDIR: join(dir, 'runtime'), PATINA_API_BASE: baseURL, PATINA_API_KEY: 'local-fixture-only' };
  const accepted = await command(['rewrite', '--workspace', dir, '--input', 'draft.md', '--output', 'verified.md', '--register', 'casual'], dir, env);
  assert.equal(accepted.code, 0, accepted.stderr + accepted.stdout);
  const report = JSON.parse(accepted.stdout);
  assert.equal(report.status, 'verified');
  assert.equal(report.verification.verified, true);
  assert.equal(report.verification.mps, 100);
  assert.equal(report.effectiveOptions.register, 'casual');
  assert.equal(await readFile(join(dir, 'verified.md'), 'utf8'), rewritten);
  assert.equal((await readAsideSettings(dir)).settingsHash, saved.settingsHash);
  assert.ok(requests.every(request => request.model === 'fixture-model'));
  fail = true;
  const rejected = await command(['rewrite', '--workspace', dir, '--input', 'draft.md', '--output', 'rejected.md'], dir, env);
  assert.equal(rejected.code, 4, rejected.stderr + rejected.stdout);
  assert.equal(JSON.parse(rejected.stdout).status, 'rejected');
  await assert.rejects(access(join(dir, 'rejected.md')));
  assert.equal(await readFile(join(dir, 'draft.md'), 'utf8'), source);
});
