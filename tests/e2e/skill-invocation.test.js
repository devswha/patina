import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { chmod, cp, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mpsResult } from '../fixtures/verification-results.js';
import { DEFAULT_BEST_MODELS } from '../../src/model-defaults.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HELPER = join(ROOT, 'bin/patina-skill.js');
const SOURCE = 'The service retains 12 audit logs.';
const hash = value => createHash('sha256').update(value).digest('hex');

async function fixture(t, config = {}) {
  const root = await mkdtemp(join(tmpdir(), 'patina-skill-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  await mkdir(home);
  const input = join(root, "draft 'quoted' $(no-command); --audit.md");
  await writeFile(input, SOURCE);
  await writeFile(join(root, '.patina.yaml'), JSON.stringify({ language: 'en', ...config }));
  const env = { ...process.env, HOME: home, USERPROFILE: home, PATINA_API_KEY: 'fixture-private-key',
    PATINA_API_KEY_FILE: '', PATINA_API_BASE: '', PATINA_MODEL: '', OPENAI_API_KEY: '',
    NODE_OPTIONS: '', TMPDIR: root, XDG_CONFIG_HOME: join(home, '.config') };
  return { root, home, input, env };
}

function command(f, args = [], { helper = HELPER, program } = {}) {
  const argv = program ? ['--input-type=module', '-e', program] : [helper, '--input', f.input, ...args];
  const child = spawn(process.execPath, argv, { cwd: f.root, env: f.env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const done = once(child, 'close', { signal: globalThis.AbortSignal.timeout(30_000) }).then(([exitCode]) => ({
    exitCode, stdout, stderr, summary: stdout.trim() ? JSON.parse(stdout) : null,
  })).catch(error => { child.kill('SIGKILL'); throw error; });
  return { child, done };
}

async function receipt(result) {
  assert.equal(result.stderr, '');
  return JSON.parse(await readFile(result.summary.receiptPath, 'utf8'));
}

async function privateArtifacts(result, expected) {
  const r = await receipt(result);
  const names = await readdir(dirname(result.summary.receiptPath));
  assert.deepEqual(names.sort(), expected.sort());
  assert.doesNotMatch(JSON.stringify([result.summary, r]), /fixture-private-key|retains 12|127\.0\.0\.1|messages|choices/);
  if (process.platform !== 'win32') {
    assert.equal((await stat(dirname(result.summary.receiptPath))).mode & 0o777, 0o700);
    for (const name of names) assert.equal((await stat(join(dirname(result.summary.receiptPath), name))).mode & 0o777, 0o600);
  }
  return r;
}

async function provider(t, f, { mps = 100, fidelity = 3, onRequest, output = SOURCE } = {}) {
  const requests = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const payload = JSON.parse(body);
    requests.push(payload);
    await onRequest?.(payload, requests.length);
    const prompt = payload.messages.map(message => message.content).join('\n');
    const answer = prompt.includes('Meaning Preservation evaluator') ? JSON.stringify(mpsResult(mps))
      : prompt.includes('Fidelity evaluator') ? JSON.stringify({ claims_preserved: fidelity, no_fabrication: fidelity, audience_register_match: fidelity })
      : output;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: answer } }] }));
  });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const listening = once(server, 'listening', { signal: globalThis.AbortSignal.timeout(5000) });
  server.listen(0, '127.0.0.1');
  await listening;
  await writeFile(join(f.home, '.patina.yaml'), JSON.stringify({ backend: 'openai-http', model: 'fixture-model',
    baseURL: `http://127.0.0.1:${server.address().port}/v1` }));
  return requests;
}

test('public helper rejects selected Kimi without exposing prose or invoking a rewrite', async t => {
  const f = await fixture(t);
  const result = await command(f, ['--lang', 'ko', '--backend', 'kimi-cli']).done;
  assert.equal(result.summary.code, 'backend_argv_exposes_input');
  assert.equal(result.exitCode, 1);
  const r = await privateArtifacts(result, ['receipt.json']);
  assert.equal(r.invocationStarted, false);
  assert.equal(result.summary.outputPath, null);
});

test('real helper -> shipped CLI -> loopback provider accepts exact bytes with private proof', async t => {
  const f = await fixture(t);
  const requests = await provider(t, f);
  const result = await command(f, ['--lang', 'en', '--backend', 'openai-http', '--model', 'override-model']).done;
  assert.equal(result.exitCode, 0, result.stdout);
  assert.equal(result.summary.status, 'verified');
  const r = await privateArtifacts(result, ['receipt.json', 'output.txt']);
  assert.equal(r.invocationStarted, true);
  assert.equal(r.cliExitCode, 0);
  assert.equal(r.verification.verified, true);
  assert.equal(r.verification.outputHash, hash(SOURCE));
  assert.equal(r.sourceHash, hash(await readFile(f.input)));
  assert.equal(result.summary.outputHash, hash(await readFile(result.summary.outputPath)));
  assert.equal(await readFile(result.summary.outputPath, 'utf8'), SOURCE);
  assert.ok(requests.length >= 3);
  assert.ok(requests.every(request => request.model === 'override-model'));
  assert.equal(r.selection.modelSource, 'flag');
  assert.equal(r.selection.backendSource, 'flag');
  assert.ok(r.flags.includes('--verify'));
  assert.ok(r.flags.includes('<private-input>'));
  assert.ok(r.flags.includes('<private-config>'));
});

test('captured config remains authoritative through the real CLI after ambient mutation', async t => {
  const f = await fixture(t, { blocklist: ['project-term'], 'skip-patterns': ['en-filler'] });
  const originalRequests = await provider(t, f);
  const homePath = join(f.home, '.patina.yaml');
  const originalURL = JSON.parse(await readFile(homePath, 'utf8')).baseURL;
  const changedRequests = await provider(t, f);
  const changedURL = JSON.parse(await readFile(homePath, 'utf8')).baseURL;
  // No model, provider, or endpoint in the captured config. Keep the native
  // implicit model, with an inherited loopback endpoint instead of the network.
  f.env.PATINA_API_BASE = originalURL;
  await writeFile(homePath, JSON.stringify({ backend: 'openai-http', blocklist: ['home-term'] }));
  const capturedPath = join(f.root, 'captured.json');
  const envelopePath = join(f.root, 'child-envelope.json');
  const result = await command(f, [], { program: `
    import { runSkill } from ${JSON.stringify(HELPER)};
    import { spawn } from 'node:child_process';
    import { readFileSync, writeFileSync } from 'node:fs';
    const result = await runSkill(${JSON.stringify(['--input', f.input])}, { spawnImpl(command, argv, options) {
      if (argv.includes('--version')) return spawn(command, argv, options);
      const configFlag = argv.includes('--config-snapshot') ? '--config-snapshot' : '--config';
      writeFileSync(${JSON.stringify(capturedPath)}, readFileSync(argv[argv.indexOf(configFlag) + 1]));
      // This synchronous seam is the gate: snapshot capture has completed and
      // the actual CLI process has not started, let alone consumed config.
      writeFileSync(${JSON.stringify(homePath)}, JSON.stringify({
        backend: 'openai-http', model: 'changed-home-model', provider: 'openai',
        baseURL: ${JSON.stringify(changedURL)}, blocklist: ['changed-home-term'],
        allowlist: ['changed-home-safe'], 'skip-patterns': ['en-style']
      }));
      writeFileSync(${JSON.stringify(join(f.root, '.patina.yaml'))}, JSON.stringify({
        language: 'en', model: 'changed-project-model', provider: 'openai',
        baseURL: ${JSON.stringify(changedURL)}, persona: 'natural-en',
        blocklist: ['changed-project-term'], allowlist: ['changed-project-safe'],
        'skip-patterns': ['en-content']
      }));
      // No substitute executable, mocked loader, or synthetic CLI receipt.
      const child = spawn(command, argv, options);
      let stdout = '';
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.once('close', () => writeFileSync(${JSON.stringify(envelopePath)}, stdout));
      return child;
    } });
    console.log(JSON.stringify(result)); process.exitCode = result.exitCode;
  ` }).done;
  assert.equal(result.exitCode, 0, result.stdout);
  const r = await privateArtifacts(result, ['receipt.json', 'output.txt']);
  const captured = JSON.parse(await readFile(capturedPath, 'utf8'));
  const envelope = JSON.parse(await readFile(envelopePath, 'utf8'));
  t.diagnostic(JSON.stringify({ originalRequests: originalRequests.length, changedRequests: changedRequests.length,
    requestModels: [...new Set([...originalRequests, ...changedRequests].map(request => request.model))],
    selection: r.selection, status: r.status, outputHash: r.outputHash }));
  for (const key of ['model', 'baseURL', 'provider']) assert.equal(Object.hasOwn(captured, key), false);
  assert.deepEqual(captured.blocklist, ['home-term', 'project-term']);
  assert.deepEqual(captured.allowlist, []);
  assert.deepEqual(captured['skip-patterns'], ['en-filler']);
  assert.equal(envelope.persona, null);
  assert.equal(envelope.verification.verified, true);
  assert.equal(r.status, 'verified');
  assert.equal(r.cliExitCode, 0);
  assert.equal(r.invocationStarted, true);
  assert.equal(r.selection.backend, 'openai-http');
  assert.equal(r.selection.backendSource, 'config');
  assert.equal(r.selection.requestedModel, null);
  assert.equal(r.selection.modelSource, 'default');
  assert.equal(r.selection.model, DEFAULT_BEST_MODELS.openai);
  assert.equal(r.flags.includes('--model'), false);
  assert.equal(await readFile(f.input, 'utf8'), SOURCE);
  assert.equal(await readFile(result.summary.outputPath, 'utf8'), envelope.output);
  assert.equal(envelope.output, SOURCE);
  assert.equal(r.sourceHash, hash(SOURCE));
  assert.equal(result.summary.sourceHash, r.sourceHash);
  assert.equal(r.outputHash, hash(envelope.output));
  assert.equal(result.summary.outputHash, r.outputHash);
  assert.equal(r.verification.outputHash, r.outputHash);
  assert.equal(envelope.verification.outputHash, r.outputHash);
  assert.equal(changedRequests.length, 0, 'live ambient endpoint must receive no draft or verification request');
  assert.ok(originalRequests.length >= 3);
  assert.ok(originalRequests.every(request => request.model === r.selection.model));
});

test('real CLI and adapter floors reject closest candidates without publishing output', async t => {
  for (const scenario of [
    { mps: 60, floor: 70, child: 4 },
    { mps: 60, floor: 0, child: 0 },
    { fidelity: 0, floor: 0, child: 0 },
    { mps: 90, floor: 95, child: 4 },
  ]) {
    const f = await fixture(t, { verification: { 'mps-floor': scenario.floor, 'fidelity-floor': scenario.floor } });
    await provider(t, f, scenario);
    const result = await command(f).done;
    assert.equal(result.exitCode, 4, result.stdout);
    assert.equal(result.summary.code, 'verification_rejected');
    assert.equal(result.summary.outputPath, null);
    const r = await privateArtifacts(result, ['receipt.json']);
    assert.equal(r.cliExitCode, scenario.child);
    assert.equal(r.verification.verified, scenario.child === 0);
  }
});

test('source mutation is gated on the exact real provider request', async t => {
  const f = await fixture(t);
  let signalRequest;
  const requested = new Promise(resolve => { signalRequest = resolve; });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await provider(t, f, { onRequest: async (_payload, count) => { if (count === 1) { signalRequest(); await gate; } } });
  const run = command(f);
  await Promise.race([requested, run.done.then(() => assert.fail('request was not reached'))]);
  await writeFile(f.input, 'A newer source.');
  release();
  const result = await run.done;
  assert.equal(result.summary.code, 'input_changed');
  assert.equal(result.exitCode, 4);
  await privateArtifacts(result, ['receipt.json']);
});

test('audit, score, diff modes and root skill aliases publish unverified reports only', async t => {
  for (const mode of ['audit', 'score', 'diff']) {
    const f = await fixture(t);
    await provider(t, f);
    const result = await command(f, mode === 'audit' ? ['--mode', mode] : [`--${mode}`]).done;
    assert.equal(result.exitCode, 0, result.stdout);
    assert.equal(result.summary.status, 'unverified-report');
    assert.equal(result.summary.outputPath, null);
    const r = await privateArtifacts(result, ['receipt.json', 'report.json']);
    assert.equal(r.mode, mode);
    assert.equal(r.verification, null);
    assert.equal(r.flags.includes('--verify'), false);
    const report = JSON.parse(await readFile(result.summary.reportPath, 'utf8'));
    assert.equal(report.mode, mode);
    assert.equal(result.summary.outputHash, hash(await readFile(result.summary.reportPath)));
  }
});

// The real version probe is preserved. Only malformed child envelopes use the
// existing spawn seam; success and ordinary rejection above use the shipped CLI.
function seam(f, { output = SOURCE, verification, stdout, script, inspect = '', args = [] } = {}) {
  const proof = verification === undefined ? { verified: true, retried: false, reason: 'passed', mps: 100, fidelity: 100,
    mpsFloor: 70, fidelityFloor: 70, outputHash: hash(output) } : verification;
  const body = stdout ?? JSON.stringify({ mode: 'rewrite', format: 'json', output, verification: proof });
  return command(f, [], { program: `
    import { runSkill } from ${JSON.stringify(HELPER)};
    import { spawn } from 'node:child_process';
    import { readFileSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
    import { dirname, join } from 'node:path';
    import assert from 'node:assert/strict';
    const result = await runSkill(${JSON.stringify(['--input', f.input, ...args])}, { spawnImpl(command, argv, options) {
      if (argv.includes('--version')) return spawn(command, argv, options);
      const configPath = argv[argv.indexOf('--config-snapshot') + 1];
      const snapshot = JSON.parse(readFileSync(configPath, 'utf8'));
      const input = readFileSync(argv.at(-1));
      assert.equal(options.shell, false);
      assert.equal(argv.some(arg => arg.includes(${JSON.stringify(SOURCE)})), false);
      ${inspect}
      return spawn(command, ['-e', ${JSON.stringify(script ?? `process.stderr.write('fixture-private-key'); process.stdout.write(${JSON.stringify(body)});`)}], options);
    } });
    console.log(JSON.stringify(result)); process.exitCode = result.exitCode;
  ` });
}

test('spawn-seam mutations reject malformed proof, mismatched hash, dropped numbers, invalid UTF-8 and bounds', async t => {
  const proof = { verified: true, retried: false, reason: 'passed', mps: 100, fidelity: 100, mpsFloor: 70, fidelityFloor: 70, outputHash: hash(SOURCE) };
  for (const [mutation, code] of [
    [{ verification: null }, 'invalid_cli_verification'],
    [{ verification: { ...proof, mps: '100' } }, 'invalid_cli_verification'],
    [{ verification: { ...proof, fidelityFloor: 101 } }, 'invalid_cli_verification'],
    [{ verification: { ...proof, reason: 'fixture-private-key' } }, 'invalid_cli_verification'],
    [{ verification: { ...proof, outputHash: '0'.repeat(64) } }, 'verification_output_mismatch'],
    [{ verification: { ...proof, verified: false, reason: 'floor-not-met' } }, 'verification_rejected'],
    [{ verification: { ...proof, mps: 69, mpsFloor: 0 } }, 'verification_rejected'],
    [{ verification: { ...proof, fidelity: 69, fidelityFloor: 0 } }, 'verification_rejected'],
    [{ output: 'The service retains audit logs.' }, 'numbers_changed'],
    [{ output: '\uD800' }, 'invalid_cli_output'],
    [{ stdout: '[]' }, 'invalid_cli_output'],
    [{ stdout: 'not-json' }, 'invalid_cli_json'],
    [{ script: 'process.stdout.write(Buffer.from([0xc3, 0x28]));' }, 'invalid_cli_json'],
    [{ script: "process.stdout.write('x'.repeat(262145));" }, 'cli_output_limit'],
    [{ script: "process.stdout.write('candidate'); process.exitCode = 4;" }, 'verification_rejected'],
  ]) {
    const f = await fixture(t);
    const result = await seam(f, mutation).done;
    assert.equal(result.summary.code, code, result.stdout);
    assert.equal(result.exitCode, 4);
    assert.equal(result.summary.outputPath, null);
    await privateArtifacts(result, ['receipt.json']);
  }
});

test('configured floors cannot be lowered by a child proof', async t => {
  const f = await fixture(t, { verification: { 'mps-floor': 95, 'fidelity-floor': 95 } });
  const result = await seam(f, { verification: { verified: true, retried: false, reason: 'passed', mps: 90, fidelity: 90,
    mpsFloor: 0, fidelityFloor: 0, outputHash: hash(SOURCE) } }).done;
  assert.equal(result.summary.code, 'verification_rejected');
  await privateArtifacts(result, ['receipt.json']);
});

test('config precedence and custom persona remain native; implicit default model stays absent', async t => {
  const f = await fixture(t, { persona: 'my-custom-voice', 'document-type': 'technical' });
  const result = await seam(f, { inspect: `
    assert.equal(snapshot.persona, 'my-custom-voice');
    assert.equal(snapshot['document-type'], 'technical');
    assert.equal(snapshot.language, 'en');
    assert.equal(Object.hasOwn(snapshot, 'model'), false);
  ` }).done;
  assert.equal(result.exitCode, 0, result.stdout);
  const r = await privateArtifacts(result, ['receipt.json', 'output.txt']);
  assert.equal(r.selection.modelSource, 'default');
  assert.equal(r.selection.requestedModel, null);
  await writeFile(join(f.home, '.patina.yaml'), JSON.stringify({ model: 'home-model' }));
  await writeFile(join(f.root, '.patina.yaml'), JSON.stringify({ language: 'ja', model: 'project-model' }));
  const explicit = join(f.root, 'explicit.json');
  await writeFile(explicit, JSON.stringify({ model: 'config-model', language: 'ko' }));
  const configured = await seam(f, { args: ['--config', explicit, '--lang', 'en'], inspect: `
    assert.equal(snapshot.model, 'config-model'); assert.equal(snapshot.language, 'en');
  ` }).done;
  assert.equal(configured.exitCode, 0, configured.stdout);
  assert.equal((await receipt(configured)).selection.modelSource, 'config');
});

test('BOM and multibyte input bytes survive the snapshot unchanged', async t => {
  const f = await fixture(t);
  const source = '\uFEFFThe service retains 12 audit logs. 日本語';
  await writeFile(f.input, source);
  const result = await seam(f, { output: source, inspect: `assert.equal(input.toString('utf8'), ${JSON.stringify(source)});` }).done;
  assert.equal(result.exitCode, 0, result.stdout);
  assert.equal(result.summary.sourceHash, hash(source));
  assert.equal(await readFile(result.summary.outputPath, 'utf8'), source);
});

test('invalid input and invalid floors fail before a rewrite is started', async t => {
  for (const source of ['', ' ', '\0draft', 'a'.repeat(20_001), '字'.repeat(30_000), Buffer.from([0xc3, 0x28])]) {
    const f = await fixture(t);
    await writeFile(f.input, source);
    const result = await command(f).done;
    assert.equal(result.summary.code, 'invalid_input');
    assert.equal((await privateArtifacts(result, ['receipt.json'])).invocationStarted, false);
  }
  for (const floor of ['70', -1, 101]) {
    const f = await fixture(t, { verification: { 'mps-floor': floor } });
    const result = await command(f).done;
    assert.equal(result.summary.code, 'invalid_config');
    assert.equal((await receipt(result)).invocationStarted, false);
  }
});

test('missing selected backend and missing selected authentication never fall back', async t => {
  const f = await fixture(t);
  const executables = join(f.root, 'executables');
  await mkdir(executables);
  f.env.PATH = executables;
  const unavailable = await command(f, ['--backend', 'codex-cli']).done;
  assert.equal(unavailable.summary.code, 'backend_unavailable');
  assert.equal((await privateArtifacts(unavailable, ['receipt.json'])).invocationStarted, false);
  const codex = join(executables, 'codex');
  await writeFile(codex, '#!/bin/sh\nexit 0\n');
  await chmod(codex, 0o700);
  const unauthenticated = await command(f, ['--backend', 'codex-cli']).done;
  assert.equal(unauthenticated.summary.code, 'backend_auth_missing');
  assert.equal((await privateArtifacts(unauthenticated, ['receipt.json'])).selection.backend, 'codex-cli');
  f.env.PATINA_API_KEY = '';
  const http = await command(f, ['--backend', 'openai-http']).done;
  assert.equal(http.summary.code, 'backend_auth_missing');
  await privateArtifacts(http, ['receipt.json']);
});

test('missing installed CLI and dependency failure have a before-import receipt', async t => {
  for (const missing of ['cli', 'dependency']) {
    const f = await fixture(t);
    const installed = join(f.root, 'installed');
    await mkdir(join(installed, 'bin'), { recursive: true });
    await cp(HELPER, join(installed, 'bin/patina-skill.js'));
    await writeFile(join(installed, 'package.json'), '{"type":"module"}');
    if (missing === 'dependency') {
      await cp(join(ROOT, 'src'), join(installed, 'src'), { recursive: true });
      await cp(join(ROOT, 'bin/patina.js'), join(installed, 'bin/patina.js'));
    }
    const result = await command(f, [], { helper: join(installed, 'bin/patina-skill.js') }).done;
    assert.equal(result.summary.code, missing === 'cli' ? 'cli_missing' : 'dependency_unavailable');
    const r = await privateArtifacts(result, ['receipt.json']);
    assert.equal(r.invocationStarted, false);
    assert.equal(r.cliVersion, null);
  }
});

test('unsafe managed storage is rejected without traversing its symlink', async t => {
  const f = await fixture(t);
  const outside = join(f.root, 'outside');
  await mkdir(outside);
  await symlink(outside, join(f.home, '.patina'));
  const result = await command(f).done;
  assert.equal(result.summary.code, 'unsafe_run_storage');
  assert.equal(result.summary.receiptPath, null);
  assert.equal(result.summary.outputPath, null);
  assert.deepEqual(await readdir(outside), []);
});

test('final receipt write failure never advertises or retains accepted output', async t => {
  const f = await fixture(t);
  const result = await seam(f, { inspect: `
    const receipt = join(dirname(configPath), 'receipt.json');
    renameSync(receipt, join(dirname(configPath), 'initial.json'));
    mkdirSync(receipt);
  ` }).done;
  assert.equal(result.summary.code, 'receipt_write_failed');
  assert.equal(result.exitCode, 1);
  assert.equal(result.summary.outputPath, null);
  assert.equal(result.summary.outputHash, null);
  const names = await readdir(dirname(result.summary.receiptPath));
  assert.deepEqual(names.sort(), ['initial.json', 'receipt.json']);
});

test('public cancellation waits for the exact real provider request and cleans snapshots', async t => {
  const f = await fixture(t);
  let ready;
  const requested = new Promise(resolve => { ready = resolve; });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await provider(t, f, { onRequest: async () => { ready(); await gate; } });
  const run = command(f);
  await Promise.race([requested, run.done.then(() => assert.fail('request was not reached'))]);
  run.child.kill('SIGINT');
  const result = await run.done;
  release();
  assert.equal(result.exitCode, 130);
  assert.equal(result.summary.code, 'aborted');
  await privateArtifacts(result, ['receipt.json']);
});

test('output is bounded by the child byte cap, not the source character limit', async t => {
  const f = await fixture(t);
  const output = SOURCE + 'a'.repeat(20_001);
  const result = await seam(f, { output }).done;
  assert.equal(result.exitCode, 0, result.stdout);
  assert.equal(await readFile(result.summary.outputPath, 'utf8'), output);
});

test('failed spawn records invocationStarted=false rather than a planned invocation', async t => {
  const f = await fixture(t);
  const result = await command(f, [], { program: `
    import { runSkill } from ${JSON.stringify(HELPER)};
    import { spawn } from 'node:child_process';
    const result = await runSkill(${JSON.stringify(['--input', f.input])}, { spawnImpl(command, argv, options) {
      if (argv.includes('--version')) return spawn(command, argv, options);
      throw new Error('fixture-private-key');
    } });
    console.log(JSON.stringify(result)); process.exitCode = result.exitCode;
  ` }).done;
  assert.equal(result.summary.code, 'cli_start_failed');
  assert.equal((await privateArtifacts(result, ['receipt.json'])).invocationStarted, false);
});

test('unsupported Node and broken actual CLI version never read or send draft bytes', async t => {
  for (const kind of ['node', 'cli']) {
    const f = await fixture(t);
    const result = await command(f, [], { program: `
      import { runSkill } from ${JSON.stringify(HELPER)};
      import { spawn } from 'node:child_process';
      ${kind === 'node' ? "Object.defineProperty(process.versions, 'node', { value: '18.0.0' });" : ''}
      const result = await runSkill(${JSON.stringify(['--input', f.input])}, { spawnImpl(command, _argv, options) {
        return spawn(command, ['-e', "process.stderr.write('fixture-private-key'); process.exitCode = 1;"], options);
      } });
      console.log(JSON.stringify(result)); process.exitCode = result.exitCode;
    ` }).done;
    assert.equal(result.summary.code, kind === 'node' ? 'unsupported_node' : 'cli_setup_failed');
    const r = await privateArtifacts(result, ['receipt.json']);
    assert.equal(r.invocationStarted, false);
    assert.equal(r.sourceHash, null);
  }
});
