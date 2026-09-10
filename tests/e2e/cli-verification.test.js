import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync, rmSync, linkSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { mpsResult, highHardFailMps } from '../fixtures/verification-results.js';
import { cleanRewriteOutput, formatOutput } from '../../src/output.js';

const run = promisify(execFile);
const root = fileURLToPath(new URL('../../', import.meta.url));
const outputHash = text => createHash('sha256').update(text, 'utf8').digest('hex');
const NESTED_RAW = '[BODY]The service does not store drafts. [BODY]It runs locally.[/BODY][/BODY]';
const NESTED_GRADED = 'The service does not store drafts. [BODY]It runs locally.\n\n[/BODY]';

// Exercise real CLI children against the same scorer fixtures as the stdout
// verification tests. Every writable input is disposable, never a repo file.
async function runMeaningSafetyBatch(scenario, {
  destination = 'in-place', format = 'text', maxFailures = 3, validLast = true, validFirst = false, stdin = false, missingInput = false,
} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'patina-meaning-batch-'));
  const first = join(dir, 'first.txt');
  const second = join(dir, destination === 'other-input' ? 'first.review.txt' : 'second.txt');
  const original = scenario === 'nested-body'
    ? 'The service does not store drafts. It runs locally.\r\n'
    : 'The service retains 12 audit logs.\r\n';
  const validOriginal = 'The service keeps 24 audit logs.\r\n';
  const candidate = scenario === 'nested-body' ? NESTED_RAW
    : scenario.startsWith('dropped-number') ? 'The service retains the audit logs.'
    : 'The service deletes 12 audit logs.';
  const validCandidate = 'The service retains 24 audit logs.';
  const counts = { first: 0, second: 0 };
  writeFileSync(first, original);
  if (validLast) writeFileSync(second, validOriginal);
  if (destination === 'hardlink') linkSync(first, join(dir, 'first.review.txt'));
  if (destination === 'symlink') symlinkSync(first, join(dir, 'first.review.txt'));
  if (destination === 'other-hardlink') linkSync(second, join(dir, 'first.review.txt'));
  if (destination === 'other-symlink') symlinkSync(second, join(dir, 'first.review.txt'));
  if (destination === 'outdir-other-hardlink') {
    mkdirSync(join(dir, 'out'));
    linkSync(second, join(dir, 'out', 'first.txt'));
  }
  if (missingInput) writeFileSync(join(dir, 'first.review.txt'), 'Previous review.\n');
  writeFileSync(join(dir, 'key'), 'test-key');
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ persona: null, register: null,
    verification: { 'mps-floor': 95, 'fidelity-floor': 95 } }));
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const prompt = JSON.parse(body).messages.map(message => message.content).join('\n');
    const valid = prompt.includes('24 audit logs');
    let answer;
    if (prompt.includes('Meaning Preservation evaluator')) {
      answer = JSON.stringify(!valid && scenario === 'hard-fail' ? highHardFailMps()
        : !valid && scenario === 'malformed' ? { ...mpsResult(), pass_count: 0 }
        : mpsResult());
    } else if (prompt.includes('Fidelity evaluator')) {
      answer = JSON.stringify({ claims_preserved: 3, no_fabrication: 3, audience_register_match: 3 });
    } else {
      counts[valid ? 'second' : 'first']++;
      answer = valid ? validCandidate : candidate;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: answer } }] }));
  });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const routing = destination === 'stdout' ? []
      : ['suffix', 'hardlink', 'symlink', 'other-input', 'other-hardlink', 'other-symlink'].includes(destination) ? ['--suffix', '.review']
      : ['outdir', 'outdir-other-hardlink'].includes(destination) ? ['--outdir', join(dir, 'out')]
      : destination === 'source-dir' ? ['--outdir', dir] : ['--in-place'];
    const inputs = stdin ? [] : validFirst ? [second, first] : [first, ...(validLast ? [second] : [])];
    if (missingInput) inputs.push(join(dir, 'missing.txt'));
    const child = run(process.execPath, [join(root, 'bin/patina.js'), '--batch', ...routing,
      ...(scenario === 'dropped-number-unverified' ? [] : ['--verify']), '--format', format,
      '--max-failures', String(maxFailures), '--max-failure-rate', '1', '--max-retries', '0',
      '--lang', 'en', '--config', join(dir, 'config.json'), '--backend', 'openai-http', '--model', 'test-model',
      '--api-key-file', join(dir, 'key'), '--base-url', `http://127.0.0.1:${server.address().port}/v1`,
      // Mix relative and absolute paths in the direct cross-input collision.
      ...inputs.map(path => destination === 'other-input' && path === second ? './first.review.txt' : path)],
    { cwd: dir, timeout: 20000, env: { ...process.env, HOME: dir, USERPROFILE: dir, TMPDIR: dir } });
    if (stdin) child.child.stdin.end(original);
    const result = await child
      .then(result => ({ ...result, code: 0 }), error => error);
    const reviewPath = destination === 'suffix' ? join(dir, 'first.review.txt') : join(dir, 'out', 'first.txt');
    return { result, counts, first, second, original, validOriginal, validCandidate,
      firstAfter: readFileSync(first, 'utf8'), secondAfter: validLast ? readFileSync(second, 'utf8') : null,
      review: existsSync(reviewPath) ? readFileSync(reviewPath, 'utf8') : null };
  } finally {
    await new Promise(resolve => server.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
}

for (const scenario of ['hard-fail', 'malformed', 'nested-body', 'dropped-number', 'dropped-number-unverified']) {
  // win32: the unverified scenario's CLI child completes all batch work
  // correctly, then aborts at process teardown with a libuv assertion
  // (exit 0xC0000409, src\win\async.c:94, Node 24.17.0). That is a runtime-
  // level crash, absent coverage here — tracked as a win32 follow-up.
  const skip = process.platform === 'win32' && scenario === 'dropped-number-unverified'
    && 'libuv async-handle abort at CLI teardown on win32 (Node 24.17.0)';
  test(`CLI batch in-place preserves failed ${scenario} input and still writes the next valid file`, { skip }, async () => {
    for (const format of ['text', 'json']) {
      const { result, counts, first, second, original, validCandidate, firstAfter, secondAfter } =
        await runMeaningSafetyBatch(scenario, { format });
      assert.equal(result.code, 4, result.stderr);
      assert.equal(firstAfter, original, 'a failed candidate must never overwrite the source bytes');
      assert.equal(format === 'json' ? JSON.parse(secondAfter).output : secondAfter, validCandidate,
        'a previous safety failure must not poison the next valid file');
      assert.ok(!result.stdout.includes(`Written: ${first}`), result.stdout);
      assert.ok(result.stdout.includes(`Written: ${second}`), result.stdout);
      assert.match(result.stderr, /Successes: 1\/2\. Failures: 1\/2\./);
      assert.equal(result.stderr.split('batch file failed:').length - 1, 1);
      assert.equal(counts.first, ['hard-fail', 'malformed'].includes(scenario) ? 2 : 1);
      assert.equal(counts.second, 1);
    }
  });
}

test('CLI batch meaning failures honor the failure budget without false successes', async () => {
  const { result, counts, firstAfter, original, secondAfter, validOriginal } =
    await runMeaningSafetyBatch('hard-fail', { maxFailures: 1 });
  assert.equal(result.code, 4, result.stderr);
  assert.equal(firstAfter, original);
  assert.equal(secondAfter, validOriginal);
  assert.doesNotMatch(result.stdout, /Written:/);
  assert.match(result.stderr, /max failures reached \(1\/1\)/);
  assert.match(result.stderr, /Successes: 0\/2\. Failures: 1\/2\./);
  assert.equal(counts.second, 0, 'the breaker must stop before the next backend request');
});

test('CLI single-file batch also refuses an unsafe in-place write', async () => {
  const { result, firstAfter, original } = await runMeaningSafetyBatch('dropped-number', { validLast: false });
  assert.equal(result.code, 4, result.stderr);
  assert.equal(firstAfter, original);
  assert.doesNotMatch(result.stdout, /Written:/);
});

for (const destination of ['stdout', 'suffix', 'outdir']) {
  test(`CLI batch retains ${destination} review output while counting meaning failures`, async () => {
    const { result, firstAfter, original, secondAfter, validOriginal, review } =
      await runMeaningSafetyBatch('dropped-number', { destination, format: 'json' });
    assert.equal(result.code, 4, result.stderr);
    assert.equal(firstAfter, original);
    assert.equal(secondAfter, validOriginal);
    const firstOutput = destination === 'stdout'
      ? JSON.parse(result.stdout.slice(0, result.stdout.indexOf('\n{'))) : JSON.parse(review);
    assert.equal(firstOutput.output, 'The service retains the audit logs.');
    assert.equal(firstOutput.verification.verified, false);
    assert.equal(firstOutput.verification.reason, 'dropped-numbers');
    assert.match(result.stderr, /Successes: 1\/2\. Failures: 1\/2\./);
  });
}

for (const destination of ['source-dir', 'hardlink', 'symlink']) {
  test(`CLI batch refuses unsafe ${destination} output that aliases its source`, {
    skip: destination === 'symlink' && process.platform === 'win32',
  }, async () => {
    const { result, firstAfter, original, counts } =
      await runMeaningSafetyBatch('dropped-number', { destination });
    assert.equal(result.code, 4, result.stderr);
    assert.equal(firstAfter, original);
    assert.match(result.stderr, /Successes: 1\/2\. Failures: 1\/2\./);
    assert.equal(counts.second, 1);
  });
}

for (const destination of ['other-input', 'other-hardlink', 'other-symlink', 'outdir-other-hardlink']) {
  test(`CLI batch refuses failed output targeting another batch input via ${destination}`, {
    skip: destination === 'other-symlink' && process.platform === 'win32',
  }, async () => {
    for (const validFirst of [false, true]) {
      const { result, original, firstAfter, validOriginal, secondAfter, counts } =
        await runMeaningSafetyBatch('hard-fail', { destination, maxFailures: 1, validFirst });
      assert.equal(result.code, 4, result.stderr);
      assert.equal(firstAfter, original);
      assert.equal(secondAfter, validOriginal, 'a failed candidate must not overwrite another batch source');
      assert.equal(counts.second, validFirst ? 1 : 0);
      assert.equal(result.stdout.split('Written:').length - 1, validFirst ? 1 : 0);
      assert.match(result.stderr, validFirst ? /Successes: 1\/2\. Failures: 1\/2\./ : /Successes: 0\/2\. Failures: 1\/2\./);
    }
  });
}

test('CLI batch continues after a blocked cross-input write without poisoning the valid item', async () => {
  const { result, original, firstAfter, validOriginal, secondAfter, counts, second } =
    await runMeaningSafetyBatch('dropped-number', { destination: 'other-input' });
  assert.equal(result.code, 4, result.stderr);
  assert.equal(firstAfter, original);
  assert.equal(secondAfter, validOriginal);
  assert.equal(counts.second, 1);
  assert.equal(result.stdout.trim(), `Written: ${second.replace(/\.txt$/, '.review.txt')}`);
  assert.match(result.stderr, /Successes: 1\/2\. Failures: 1\/2\./);
});

test('CLI batch stdin keeps unsafe diagnostic output without treating stdin as a source file', async () => {
  const { result, firstAfter, original } = await runMeaningSafetyBatch('dropped-number', {
    stdin: true, validLast: false, format: 'json',
  });
  assert.equal(result.code, 4, result.stderr);
  assert.equal(firstAfter, original);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.output, 'The service retains the audit logs.');
  assert.equal(payload.verification.reason, 'dropped-numbers');
  assert.doesNotMatch(result.stdout, /Written:/);
});

test('CLI batch keeps separate review output when another batch input is missing', async () => {
  const { result, firstAfter, original, secondAfter, validOriginal, review } =
    await runMeaningSafetyBatch('dropped-number', { destination: 'suffix', format: 'json', missingInput: true });
  assert.equal(result.code, 4, result.stderr);
  assert.equal(firstAfter, original);
  assert.equal(secondAfter, validOriginal);
  assert.equal(JSON.parse(review).verification.reason, 'dropped-numbers');
  assert.equal(result.stdout.split('Written:').length - 1, 2);
  assert.match(result.stderr, /Successes: 1\/3\. Failures: 2\/3\./);
});

test('CLI --verify preserves stdout and exit 4 for semantic failures; normal evidence exits 0', async () => {
  for (const scenario of ['normal', 'hard-fail', 'malformed']) {
    const counts = { rewrite: 0, mps: 0, fidelity: 0 };
    const text = 'The service retains the audit log.';
    const dir = mkdtempSync(join(tmpdir(), 'patina-runtime-cli-'));
    writeFileSync(join(dir, 'key'), 'test-key');
    writeFileSync(join(dir, 'input.txt'), text);
    const server = createServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk;
      const prompt = JSON.parse(body).messages.map((message) => message.content).join('\n');
      let answer = text;
      if (prompt.includes('Meaning Preservation evaluator')) {
        counts.mps++;
        answer = JSON.stringify(scenario === 'hard-fail' ? highHardFailMps() : scenario === 'malformed' ? { ...mpsResult(), pass_count: 0 } : mpsResult());
      } else if (prompt.includes('Fidelity evaluator')) {
        counts.fidelity++;
        answer = JSON.stringify({ claims_preserved: scenario === 'malformed' ? 99 : 3, no_fabrication: 3, audience_register_match: 3 });
      } else {
        counts.rewrite++;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: answer } }] }));
    });
    try {
      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const result = await run(process.execPath, [join(root, 'bin/patina.js'), '--verify', '--lang', 'en', '--backend', 'openai-http',
        '--model', 'test-model', '--api-key-file', join(dir, 'key'), '--base-url', `http://127.0.0.1:${server.address().port}/v1`, join(dir, 'input.txt')],
      { cwd: root, timeout: 20000 }).then((result) => ({ ...result, code: 0 }), (error) => error);
      assert.equal(result.code, scenario === 'normal' ? 0 : 4, result.stderr);
      assert.equal(result.stdout.trim(), text);
      assert.equal(counts.rewrite, scenario === 'normal' ? 1 : 2);
      if (scenario === 'normal') assert.match(result.stderr, /\(passed\)/);
      else assert.match(result.stderr, /below floor/);
      // One correction per malformed score per candidate, never unbounded.
      assert.equal(counts.mps, scenario === 'normal' ? 1 : scenario === 'malformed' ? 4 : 2);
      assert.equal(counts.fidelity, scenario === 'normal' ? 1 : scenario === 'malformed' ? 4 : 2);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('JSON verification metadata is opt-in runtime evidence with no duplicate draft or extra fields', () => {
  const text = 'The service retains 12 audit logs.';
  const evidence = { verified: true, mps: 100, fidelity: 100, retried: false, reason: 'passed', mpsFloor: 95, fidelityFloor: 95,
    outputHash: outputHash(text) };
  const options = { verification: { ...evidence, text, apiKey: 'private-key' } };
  const verified = JSON.parse(formatOutput(text, 'rewrite', { format: 'json', verify: true }, options));
  assert.deepEqual(verified.verification, evidence);
  assert.equal(verified.output, text);
  assert.equal(JSON.stringify(verified).split(text).length, 2);
  assert.doesNotMatch(JSON.stringify(verified), /private-key/);
  for (const mode of ['rewrite', 'score', 'audit', 'diff']) {
    const payload = JSON.parse(formatOutput(text, mode, { format: 'json', verify: mode !== 'rewrite' }, options));
    assert.equal(Object.hasOwn(payload, 'verification'), false);
  }
  for (const format of ['text', 'markdown']) assert.equal(formatOutput(text, 'rewrite', { format, verify: true }, options), text);
  const modelResult = { output: text, verification: evidence };
  assert.equal(Object.hasOwn(JSON.parse(formatOutput(modelResult, 'rewrite', { format: 'json', verify: true })), 'verification'), false);
  const graded = cleanRewriteOutput(NESTED_RAW);
  assert.equal(graded, NESTED_GRADED);
  const nested = JSON.parse(formatOutput(graded, 'rewrite', { format: 'json', verify: true }, {
    verification: { ...evidence, outputHash: outputHash(graded) },
  }));
  assert.equal(nested.output, 'It runs locally.');
  assert.equal(nested.verification.outputHash, outputHash(graded), 'formatter must preserve the original evidence hash');
  assert.notEqual(nested.verification.outputHash, outputHash(nested.output));
});

test('CLI --verify JSON binds scores to graded text and rejects post-verification claim loss', async () => {
  for (const scenario of ['pass', 'hard-fail', 'malformed', 'dropped-number', 'retry-pass', 'nested-body']) {
    const text = scenario === 'nested-body' ? 'The service does not store drafts. It runs locally.\n' : 'The service retains 12 audit logs.';
    const dir = mkdtempSync(join(tmpdir(), 'patina-runtime-json-'));
    writeFileSync(join(dir, 'key'), 'test-key');
    writeFileSync(join(dir, 'input.txt'), text);
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ persona: null, register: null,
      verification: { 'mps-floor': 95, 'fidelity-floor': 95 } }));
    let rewriteCount = 0;
    const server = createServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk;
      const prompt = JSON.parse(body).messages.map(message => message.content).join('\n');
      let answer;
      if (prompt.includes('Meaning Preservation evaluator')) {
        answer = JSON.stringify(scenario === 'hard-fail' ? highHardFailMps()
          : scenario === 'malformed' ? { ...mpsResult(), pass_count: 0 }
          : mpsResult(scenario === 'retry-pass' && rewriteCount === 1 ? 80 : 100));
      } else if (prompt.includes('Fidelity evaluator')) {
        answer = JSON.stringify({ claims_preserved: 3, no_fabrication: 3, audience_register_match: 3 });
      } else {
        rewriteCount++;
        answer = scenario === 'dropped-number' ? 'The service retains the audit logs.' : scenario === 'nested-body' ? NESTED_RAW : text;
      }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: answer } }] }));
    });
    try {
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const result = await run(process.execPath, [join(root, 'bin/patina.js'), '--verify', '--format', 'json', '--lang', 'en',
        '--config', join(dir, 'config.json'), '--backend', 'openai-http', '--model', 'test-model',
        '--api-key-file', join(dir, 'key'), '--base-url', `http://127.0.0.1:${server.address().port}/v1`, join(dir, 'input.txt')],
      { cwd: dir, timeout: 20000, env: { ...process.env, HOME: dir, USERPROFILE: dir, TMPDIR: dir } })
        .then(result => ({ ...result, code: 0 }), error => error);
      const success = ['pass', 'retry-pass'].includes(scenario);
      assert.equal(result.code, success ? 0 : 4, result.stderr);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.mode, 'rewrite');
      assert.equal(payload.output, scenario === 'dropped-number' ? 'The service retains the audit logs.' : scenario === 'nested-body' ? 'It runs locally.' : text);
      assert.deepEqual(payload.verification, {
        verified: success, mps: scenario === 'malformed' ? null : scenario === 'hard-fail' ? 95 : 100,
        fidelity: 100, retried: !['pass', 'dropped-number', 'nested-body'].includes(scenario),
        reason: scenario === 'pass' ? 'passed' : scenario === 'retry-pass' ? 'passed-on-retry'
          : scenario === 'dropped-number' ? 'dropped-numbers' : scenario === 'nested-body' ? 'output-changed' : 'floor-not-met',
        mpsFloor: 95, fidelityFloor: 95,
        outputHash: outputHash(scenario === 'nested-body' ? NESTED_GRADED : payload.output),
      });
      assert.equal(rewriteCount, ['pass', 'dropped-number', 'nested-body'].includes(scenario) ? 1 : 2);
      if (scenario === 'nested-body') {
        assert.doesNotMatch(text, /\d/);
        assert.notEqual(payload.verification.outputHash, outputHash(payload.output));
        // Plain output keeps its existing body; only unsafe verification
        // changes the exit status. Ordinary unverified cleanup is unchanged.
        for (const verify of [true, false]) {
          const plain = await run(process.execPath, [join(root, 'bin/patina.js'), ...(verify ? ['--verify'] : []), '--format', 'text', '--lang', 'en',
            '--config', join(dir, 'config.json'), '--backend', 'openai-http', '--model', 'test-model',
            '--api-key-file', join(dir, 'key'), '--base-url', `http://127.0.0.1:${server.address().port}/v1`, join(dir, 'input.txt')],
          { cwd: dir, timeout: 20000, env: { ...process.env, HOME: dir, USERPROFILE: dir, TMPDIR: dir } })
            .then(result => ({ ...result, code: 0 }), error => error);
          assert.equal(plain.code, verify ? 4 : 0, plain.stderr);
          assert.equal(plain.stdout.trim(), verify ? 'It runs locally.' : NESTED_GRADED);
        }
      }
    } finally {
      await new Promise(resolve => server.close(resolve));
      rmSync(dir, { recursive: true, force: true });
    }
  }
});
