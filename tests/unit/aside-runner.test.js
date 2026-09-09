import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { hashAsideText, readAsideSettings, saveAsideSettings } from '../../src/aside/options.js';
import { runAsideRewrite } from '../../src/aside/runner.js';
import { parseArgs } from '../../src/cli/args.js';
import { highHardFailMps, mpsResult } from '../fixtures/verification-results.js';

const SOURCE = 'Patina retains 12 audit logs. In conclusion, Patina retains them.';
const REWRITE = 'Patina keeps 12 audit logs. Patina retains them.';
const PROOF = Object.freeze({ verified: true, mps: 100, fidelity: 100, retried: false, reason: 'passed', mpsFloor: 70, fidelityFloor: 70,
  outputHash: hashAsideText(REWRITE) });
const NESTED_SOURCE = 'The service does not store drafts. It runs locally.\n';
const NESTED_RAW = '[BODY]The service does not store drafts. [BODY]It runs locally.[/BODY][/BODY]';
const NESTED_GRADED = 'The service does not store drafts. [BODY]It runs locally.\n\n[/BODY]';

async function fixture(t, { source = SOURCE, settings } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'aside-runner-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, 'workspace with spaces');
  const temporary = join(root, 'temporary');
  await mkdir(workspace);
  await mkdir(temporary);
  const inputPath = join(workspace, "draft 'quoted' $(no-command); --audit.md");
  await writeFile(inputPath, source);
  if (settings !== undefined) await saveAsideSettings(workspace, settings);
  return { root, workspace, temporary, inputPath, outputPath: join(workspace, 'result.md') };
}

function fakeCli({ output = REWRITE, exitCode = 0, stdout, script, inspect,
  verification = { ...PROOF, outputHash: hashAsideText(output) } } = {}) {
  return (command, argv, options) => {
    assert.equal(command, process.execPath);
    assert.match(argv[0], /bin[/\\]patina\.js$/);
    assert.equal(options.shell, false);
    assert.deepEqual(options.stdio, ['ignore', 'pipe', 'ignore']);
    const parsed = parseArgs(argv.slice(1));
    assert.equal(parsed.verify, true);
    assert.equal(parsed.format, 'json');
    assert.equal(parsed.files.length, 1);
    assert.equal(parsed.inPlace, undefined);
    assert.equal(parsed.quiet, true);
    inspect?.({ argv, options, parsed, config: JSON.parse(readFileSync(parsed.config, 'utf8')), source: readFileSync(parsed.files[0], 'utf8') });
    const body = stdout === undefined ? JSON.stringify({ mode: 'rewrite', format: 'json', output, verification }) : stdout;
    const program = script ?? `process.stderr.write('provider-secret raw-draft'); process.stdout.write(${JSON.stringify(body)}); process.exitCode = ${exitCode};`;
    return spawn(command, ['--input-type=module', '-e', program], options);
  };
}

async function assertNoOutput(f, result) {
  assert.equal(result.outputPath, null);
  assert.equal(result.rewriteHash, null);
  assert.equal(result.verification.verified, false);
  assert.equal(result.ok, false);
  assert.notEqual(result.exitCode, 0);
  await assert.rejects(stat(f.outputPath), { code: 'ENOENT' });
  assert.equal((await readdir(f.temporary)).some(name => name.startsWith('patina-aside-run-')), false);
  assert.equal((await readdir(f.workspace)).some(name => name.startsWith('.patina-aside-output-')), false);
}

test('Aside accepts valid forced CLI JSON, propagates options safely, and keeps source bytes unchanged', async t => {
  const f = await fixture(t, { settings: { language: 'en', documentType: 'technical', persona: 'technical-explainer',
    register: 'professional', backend: 'codex-cli', model: 'org/model-v2:tag', protectedTerms: ['Patina', '12'] } });
  let seen = false;
  const result = await runAsideRewrite({ ...f, tempRoot: f.temporary, spawnImpl: fakeCli({ inspect: ({ argv, parsed, config, source }) => {
    seen = true;
    assert.equal(source, SOURCE);
    assert.notEqual(parsed.files[0], f.inputPath);
    assert.equal(resolve(parsed.files[0]), parsed.files[0]);
    assert.equal(argv.some(arg => arg.includes(SOURCE)), false);
    assert.equal(argv.some(arg => arg.includes('provider-secret')), false);
    assert.deepEqual(config, { language: 'en', 'document-type': 'technical', persona: 'technical-explainer', register: 'professional',
      backend: 'codex-cli', model: 'org/model-v2:tag' });
  } }) });
  assert.equal(seen, true);
  assert.equal(result.status, 'verified');
  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.outputPath, f.outputPath);
  assert.equal(result.sourceHash, hashAsideText(SOURCE));
  assert.equal(result.rewriteHash, hashAsideText(REWRITE));
  assert.equal(result.verification.verified, true);
  assert.equal(result.verification.exitCode, 0);
  assert.equal(result.verification.mps, 100);
  assert.equal(result.verification.fidelity, 100);
  assert.equal(result.verification.outputHash, result.rewriteHash);
  assert.deepEqual(result.verification.configuredFloors, { mps: 70, fidelity: 70 });
  assert.equal(result.verification.protectedTermsVerified, true);
  assert.equal(result.changes.changed, true);
  assert.ok(result.changes.editCount > 0);
  assert.equal(result.changes.originalLength - result.changes.removedLength + result.changes.addedLength, REWRITE.length);
  assert.equal(await readFile(f.inputPath, 'utf8'), SOURCE);
  assert.equal(await readFile(f.outputPath, 'utf8'), REWRITE);
  assert.deepEqual(await readdir(f.temporary), []);
  if (process.platform !== 'win32') assert.equal((await stat(f.outputPath)).mode & 0o777, 0o600);
  assert.doesNotMatch(JSON.stringify(result), /provider-secret|raw-draft|In conclusion/);
});

test('Aside unconfigured runs use blog/source defaults and a distinct default output path', async t => {
  const f = await fixture(t);
  const result = await runAsideRewrite({ ...f, inputPath: basename(f.inputPath), outputPath: undefined,
    tempRoot: f.temporary, spawnImpl: fakeCli({ output: SOURCE, inspect: ({ config }) => {
      assert.equal(config.persona, null);
      assert.equal(config.register, null);
      assert.equal(config['document-type'], 'blog');
      assert.equal(config.backend, undefined);
      assert.equal(config.model, undefined);
    } }) });
  assert.equal(result.status, 'verified');
  assert.equal(result.configured, false);
  assert.equal(result.settingsHash, null);
  assert.equal(result.effectiveOptions.language, 'en');
  assert.equal(result.changes.changed, false);
  assert.equal(result.changes.editCount, 0);
  assert.equal(result.outputPath, f.inputPath.replace(/\.md$/, '.patina.md'));
  await assert.rejects(stat(join(f.workspace, '.patina')), { code: 'ENOENT' });
});

test('a saved glossary protects matching terms across different posts without requiring absent terms', async t => {
  const f = await fixture(t, { settings: { protectedTerms: ['Patina', 'Aside'] } });
  const settingsBefore = await readFile(join(f.workspace, '.patina/aside.json'), 'utf8');
  const posts = [
    [SOURCE, REWRITE, 1, 1],
    [SOURCE.replaceAll('Patina', 'Aside'), REWRITE.replaceAll('Patina', 'Aside'), 1, 1],
    ['The team reviews every draft.', 'The team checks every draft.', 0, 2],
  ];
  for (const [index, [source, rewrite, applied, absent]] of posts.entries()) {
    const inputPath = join(f.workspace, `post-${index}.md`);
    const outputPath = join(f.workspace, `result-${index}.md`);
    await writeFile(inputPath, source);
    const result = await runAsideRewrite({ workspace: f.workspace, inputPath, outputPath,
      tempRoot: f.temporary, spawnImpl: fakeCli({ output: rewrite }) });
    assert.equal(result.status, 'verified', JSON.stringify(result));
    assert.equal(result.verification.protectedTermsApplied, applied);
    assert.equal(result.verification.protectedTermsAbsent, absent);
    assert.equal(await readFile(outputPath, 'utf8'), rewrite);
  }
  assert.equal(await readFile(join(f.workspace, '.patina/aside.json'), 'utf8'), settingsBefore);
});

test('Aside exit 4 rejects a nonempty closest candidate and never exposes it', async t => {
  const f = await fixture(t);
  const result = await runAsideRewrite({ ...f, tempRoot: f.temporary, spawnImpl: fakeCli({ exitCode: 4 }) });
  assert.equal(result.status, 'rejected');
  assert.equal(result.code, 'verification_rejected');
  assert.equal(result.verification.exitCode, 4);
  assert.equal(result.sourceHash, hashAsideText(SOURCE));
  await assertNoOutput(f, result);
  assert.doesNotMatch(JSON.stringify(result), /provider-secret|raw-draft|keeps 12/);
});

test('Aside rejects malformed JSON, wrong mode/format, missing/empty/ill-formed/oversized output', async t => {
  for (const stdout of ['not JSON provider-secret', 'null', '{}', JSON.stringify({ mode: 'score', format: 'json', output: REWRITE }),
    JSON.stringify({ mode: 'rewrite', format: 'text', output: REWRITE }),
    ...['', ' ', '\uD800', 'a\0b', 'a'.repeat(20_001)].map(output => JSON.stringify({ mode: 'rewrite', format: 'json', output }))]) {
    const f = await fixture(t);
    const result = await runAsideRewrite({ ...f, tempRoot: f.temporary, spawnImpl: fakeCli({ stdout }) });
    assert.equal(result.status, 'rejected');
    assert.match(result.code, /^invalid_cli_(?:json|output)$/);
    await assertNoOutput(f, result);
    assert.doesNotMatch(JSON.stringify(result), /provider-secret/);
  }
});

test('Aside bounds stdout bytes and ignores stderr secrets', async t => {
  const f = await fixture(t);
  const result = await runAsideRewrite({ ...f, tempRoot: f.temporary, spawnImpl: fakeCli({
    script: "process.stderr.write('provider-secret'); process.stdout.write('a'.repeat(300000));",
  }) });
  assert.equal(result.code, 'cli_output_limit');
  await assertNoOutput(f, result);
});

test('Aside rejects missing or malformed verification evidence despite exit zero and candidate text', async t => {
  const proofs = [null, {}, [],
    ...['mps', 'fidelity', 'mpsFloor', 'fidelityFloor'].flatMap(key => [null, '100', Infinity, -1, 101].map(value => ({ ...PROOF, [key]: value }))),
    { ...PROOF, verified: 'true' }, { ...PROOF, retried: 'false' },
    { ...PROOF, reason: 'provider-secret' }, { ...PROOF, retried: true },
    ...[undefined, null, 100, '', '0'.repeat(63), 'G'.repeat(64), 'A'.repeat(64)]
      .map(outputHash => ({ ...PROOF, outputHash })),
  ];
  for (const verification of proofs) {
    const f = await fixture(t);
    const result = await runAsideRewrite({ ...f, tempRoot: f.temporary, spawnImpl: fakeCli({ verification }) });
    assert.equal(result.status, 'rejected');
    assert.equal(result.code, 'invalid_cli_verification');
    await assertNoOutput(f, result);
    assert.doesNotMatch(JSON.stringify(result), /provider-secret/);
  }
  const f = await fixture(t);
  const result = await runAsideRewrite({ ...f, tempRoot: f.temporary, spawnImpl: fakeCli({
    stdout: JSON.stringify({ mode: 'rewrite', format: 'json', output: REWRITE, mps: 100, verified: true }),
  }) });
  assert.equal(result.code, 'invalid_cli_verification');
  await assertNoOutput(f, result);
});

test('Aside rejects an exit-zero score of 100 when post-verification cleanup changed the output hash', async t => {
  const f = await fixture(t, { source: NESTED_SOURCE });
  const result = await runAsideRewrite({ ...f, tempRoot: f.temporary, spawnImpl: fakeCli({ output: 'It runs locally.',
    verification: { ...PROOF, outputHash: hashAsideText(NESTED_GRADED) },
  }) });
  assert.equal(result.status, 'rejected');
  assert.equal(result.code, 'verification_output_mismatch');
  assert.equal(result.verification.exitCode, 0);
  assert.equal(result.verification.cliVerified, true);
  assert.equal(result.verification.mps, 100);
  assert.equal(result.verification.fidelity, 100);
  assert.equal(result.verification.outputHash, hashAsideText(NESTED_GRADED));
  assert.equal(await readFile(f.inputPath, 'utf8'), NESTED_SOURCE);
  await assertNoOutput(f, result);
});

test('Aside requires verified=true and scores at both its own and configured floors', async t => {
  for (const verification of [
    { ...PROOF, verified: false, reason: 'floor-not-met', retried: true },
    { ...PROOF, mps: 69.9, mpsFloor: 0, fidelityFloor: 0 },
    { ...PROOF, fidelity: 69.9, mpsFloor: 0, fidelityFloor: 0 },
    { ...PROOF, mps: 90, mpsFloor: 95 },
    { ...PROOF, fidelity: 90, fidelityFloor: 95 },
  ]) {
    const f = await fixture(t);
    const result = await runAsideRewrite({ ...f, tempRoot: f.temporary, spawnImpl: fakeCli({ verification }) });
    assert.equal(result.code, 'verification_rejected');
    assert.equal(result.verification.exitCode, 0);
    assert.equal(result.verification.mps, verification.mps);
    assert.equal(result.verification.fidelity, verification.fidelity);
    await assertNoOutput(f, result);
  }
  const f = await fixture(t);
  const result = await runAsideRewrite({ ...f, tempRoot: f.temporary, spawnImpl: fakeCli({
    verification: { ...PROOF, mps: 70, fidelity: 70, mpsFloor: 0, fidelityFloor: 0, text: 'provider-secret' },
  }) });
  assert.equal(result.status, 'verified');
  assert.equal(result.verification.mpsFloor, 70);
  assert.equal(result.verification.fidelityFloor, 70);
  assert.deepEqual(result.verification.configuredFloors, { mps: 0, fidelity: 0 });
  assert.doesNotMatch(JSON.stringify(result), /provider-secret/);
});

test('Aside invocation overrides merge selected options without mutating or persisting saved preferences', async t => {
  const f = await fixture(t, { settings: { language: 'ko', persona: 'natural-ko', register: 'casual',
    backend: 'codex-cli', model: 'saved-model', protectedTerms: ['Patina'] } });
  const before = await readAsideSettings(f.workspace);
  const settingsPath = join(f.workspace, '.patina', 'aside.json');
  const beforeBytes = await readFile(settingsPath);
  const overrides = { language: 'en', documentType: 'technical', persona: null, register: 'professional',
    backend: 'claude-cli', model: 'one-run-model', protectedTerms: ['12'] };
  const result = await runAsideRewrite({ ...f, overrides, tempRoot: f.temporary, spawnImpl: fakeCli({ inspect: ({ config }) => {
    assert.deepEqual(config, { language: 'en', 'document-type': 'technical', persona: null, register: 'professional',
      backend: 'claude-cli', model: 'one-run-model' });
    assert.equal(config.verification, undefined);
  } }) });
  assert.equal(result.ok, true);
  assert.deepEqual(result.settings, before.settings);
  assert.equal(result.settingsHash, before.settingsHash);
  assert.deepEqual(result.effectiveOptions, { version: 1, ...overrides, verify: true, format: 'json' });
  assert.deepEqual(await readAsideSettings(f.workspace), before);
  assert.deepEqual(await readFile(settingsPath), beforeBytes);
  assert.deepEqual(overrides.protectedTerms, ['12']);
  const next = await runAsideRewrite({ ...f, outputPath: join(f.workspace, 'second.md'), tempRoot: f.temporary,
    overrides: { documentType: 'technical', register: undefined }, spawnImpl: fakeCli() });
  assert.equal(next.ok, true);
  assert.equal(next.effectiveOptions.register, 'casual');
  assert.equal(next.effectiveOptions.model, 'saved-model');
});

test('Aside unconfigured invocation overrides stay ephemeral and reject secrets or incompatible combinations', async t => {
  const f = await fixture(t);
  const result = await runAsideRewrite({ ...f, overrides: { language: 'en', persona: 'natural-en' },
    tempRoot: f.temporary, spawnImpl: fakeCli() });
  assert.equal(result.ok, true);
  assert.equal(result.effectiveOptions.persona, 'natural-en');
  assert.equal(result.settings.persona, null);
  assert.equal(result.configured, false);
  await assert.rejects(stat(join(f.workspace, '.patina')), { code: 'ENOENT' });
  for (const overrides of [null, [], 'draft', { apiKey: 'provider-secret' }, { baseURL: 'provider-secret' },
    { verification: { 'mps-floor': 0 } }, { model: 'model; command' }, { backend: '--audit' },
    { language: 'auto', persona: 'natural-en' }, { documentType: 'namuwiki' },
    JSON.parse('{"__proto__": {"model":"provider-secret"}}')]) {
    const rejected = await runAsideRewrite({ ...f, overrides, outputPath: join(f.workspace, 'rejected.md'),
      spawnImpl: () => { assert.fail('invalid overrides must not spawn'); } });
    assert.equal(rejected.status, 'error');
    assert.equal(rejected.ok, false);
    assert.equal(rejected.outputPath, null);
    assert.doesNotMatch(JSON.stringify(rejected), /provider-secret/);
    await assert.rejects(stat(join(f.workspace, 'rejected.md')), { code: 'ENOENT' });
  }
});

test('Aside rejects invalid UTF-8 child output while exit 4 still wins over its bytes', async t => {
  for (const exitCode of [0, 4]) {
    const f = await fixture(t);
    const result = await runAsideRewrite({ ...f, tempRoot: f.temporary, spawnImpl: fakeCli({
      script: `process.stdout.write(Buffer.from([0xc3, 0x28])); process.exitCode = ${exitCode};`,
    }) });
    assert.equal(result.status, 'rejected');
    assert.equal(result.code, exitCode === 4 ? 'verification_rejected' : 'invalid_cli_json');
    await assertNoOutput(f, result);
  }
});

test('Aside safe errors never expose thrown messages or nonzero CLI stderr/stdout', async t => {
  for (const spawnImpl of [fakeCli({ exitCode: 1 }), () => { throw new Error('provider-secret'); },
    (_command, _argv, options) => spawn('/definitely-absent-aside-executable', [], options)]) {
    const f = await fixture(t);
    const result = await runAsideRewrite({ ...f, tempRoot: f.temporary, spawnImpl });
    assert.equal(result.status, 'error');
    assert.ok(['cli_failed', 'cli_start_failed'].includes(result.code));
    assert.doesNotMatch(JSON.stringify(result), /provider-secret|definitely-absent|raw-draft/);
    await assertNoOutput(f, result);
  }
});

test('Aside stale input hash rejects output after a successful child', async t => {
  const f = await fixture(t);
  const result = await runAsideRewrite({ ...f, tempRoot: f.temporary, spawnImpl: fakeCli({ inspect: () => {
    writeFileSync(f.inputPath, 'A newer source draft.');
  } }) });
  assert.equal(result.status, 'rejected');
  assert.equal(result.code, 'input_changed');
  assert.equal(await readFile(f.inputPath, 'utf8'), 'A newer source draft.');
  await assertNoOutput(f, result);
});

test('Aside never overwrites source, existing files, symlinks, or an output created during the child', async t => {
  for (const kind of ['source', 'existing', 'symlink', 'during']) {
    const f = await fixture(t);
    if (kind === 'existing') await writeFile(f.outputPath, 'KEEP');
    if (kind === 'symlink') await symlink(f.inputPath, f.outputPath);
    const result = await runAsideRewrite({ ...f, outputPath: kind === 'source' ? f.inputPath : f.outputPath,
      tempRoot: f.temporary, spawnImpl: fakeCli({ inspect: () => {
        assert.equal(kind, 'during', 'existing destination must fail before spawning');
        writeFileSync(f.outputPath, 'KEEP');
      } }) });
    assert.equal(result.code, kind === 'source' ? 'output_is_input' : 'output_exists');
    assert.equal(result.outputPath, null);
    assert.equal(await readFile(f.inputPath, 'utf8'), SOURCE);
    if (kind === 'existing' || kind === 'during') assert.equal(await readFile(f.outputPath, 'utf8'), 'KEEP');
    assert.deepEqual(await readdir(f.temporary), []);
  }
});

test('Aside rejects invalid/bounded/non-file inputs before starting any backend', async t => {
  for (const source of ['', '  ', '\0draft', 'a'.repeat(20_001), '字'.repeat(30_000), Buffer.from([0xC3, 0x28])]) {
    const f = await fixture(t, { source });
    const result = await runAsideRewrite({ ...f, spawnImpl: () => { assert.fail('must not spawn'); } });
    assert.equal(result.code, 'invalid_input');
    await assertNoOutput(f, result);
  }
  const f = await fixture(t);
  await rm(f.inputPath);
  await mkdir(f.inputPath);
  const result = await runAsideRewrite({ ...f, spawnImpl: () => { assert.fail('must not spawn'); } });
  assert.equal(result.code, 'invalid_input');
});

test('Aside source hash preserves BOM and multibyte UTF-8 exactly', async t => {
  const source = '\uFEFFパティナは意味と数字を保ったまま文章を整えます。😀';
  const f = await fixture(t, { source });
  const result = await runAsideRewrite({ ...f, tempRoot: f.temporary, spawnImpl: fakeCli({ output: source,
    inspect: ({ source: snapshot }) => assert.equal(snapshot, source) }) });
  assert.equal(result.status, 'verified');
  assert.equal(result.sourceHash, hashAsideText(await readFile(f.inputPath)));
  assert.equal(result.rewriteHash, result.sourceHash);
  assert.equal(result.effectiveOptions.language, 'ja');
});

test('Aside protected terms require exact global counts and order, with no repair', async t => {
  for (const output of ['Patina retains 12 audit logs.', 'Patina Patina Patina retains 12 audit logs.',
    '12 audit logs remain. Patina retains them. Patina agrees.', 'Patina retains 12 audit logs. patina retains them.']) {
    const f = await fixture(t, { settings: { protectedTerms: ['Patina', '12'] } });
    const result = await runAsideRewrite({ ...f, tempRoot: f.temporary, spawnImpl: fakeCli({ output }) });
    assert.equal(result.status, 'rejected');
    assert.equal(result.code, 'protected_text_changed');
    await assertNoOutput(f, result);
  }
});

test('Aside ambiguous protected terms fail before spawning', async t => {
  for (const [source, settings, code] of [
    [SOURCE, { protectedTerms: ['Patina', 'Pat'] }, 'protected_text_ambiguous'],
    ['banana 12', { protectedTerms: ['ana'] }, 'protected_text_ambiguous'],
  ]) {
    const f = await fixture(t, { source, settings });
    const result = await runAsideRewrite({ ...f, spawnImpl: () => { assert.fail('must not spawn'); } });
    assert.equal(result.code, code);
    await assertNoOutput(f, result);
  }
});

test('Aside checks missing numbers even if a child incorrectly exits zero', async t => {
  const f = await fixture(t);
  const result = await runAsideRewrite({ ...f, tempRoot: f.temporary, spawnImpl: fakeCli({ output: 'Patina retains logs.' }) });
  assert.equal(result.code, 'numbers_changed');
  await assertNoOutput(f, result);
});

test('Aside cancellation before spawn and during a real child is bounded and content-free', async t => {
  for (const before of [true, false]) {
    const f = await fixture(t);
    const controller = new AbortController();
    if (before) controller.abort(new Error('provider-secret'));
    let pid;
    let closed = Promise.resolve([]);
    const spawnImpl = fakeCli({ script: "process.stdout.write('READY'); process.stdin.resume(); setInterval(() => {}, 1000);",
      inspect: () => assert.equal(before, false) });
    const result = await runAsideRewrite({ ...f, signal: controller.signal, tempRoot: f.temporary,
      spawnImpl: (...args) => {
        const child = spawnImpl(...args);
        pid = child.pid;
        // invokeCli unrefs the killed child, so the close deadline must keep the loop alive.
        const closeController = new AbortController();
        const closeTimer = setTimeout(() => closeController.abort(), 5000);
        closed = once(child, 'close', { signal: closeController.signal }).finally(() => clearTimeout(closeTimer));
        child.stdout.once('data', () => controller.abort(new Error('provider-secret')));
        return child;
      } });
    assert.equal(result.status, 'error');
    assert.equal(result.code, 'aborted');
    assert.equal(result.exitCode, 1);
    if (pid) {
      await closed;
      assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    }
    await assertNoOutput(f, result);
    assert.doesNotMatch(JSON.stringify(result), /provider-secret/);
  }
});

test('Aside timeouts are bounded and reject invalid limits', async t => {
  for (const timeoutMs of [0, Infinity, NaN, -1, 300_001]) {
    const f = await fixture(t);
    const result = await runAsideRewrite({ ...f, timeoutMs, spawnImpl: () => { assert.fail('must not spawn'); } });
    assert.equal(result.code, 'invalid_timeout');
  }
  const f = await fixture(t);
  const result = await runAsideRewrite({ ...f, timeoutMs: 100, tempRoot: f.temporary,
    spawnImpl: fakeCli({ script: 'setInterval(() => {}, 1000);' }) });
  assert.equal(result.code, 'timeout');
  await assertNoOutput(f, result);
});

test('Aside shipped CLI retains floors, rejects post-verification claim loss, and applies ephemeral options', async t => {
  for (const scenario of ['pass', 'hard-fail', 'low-mps', 'low-fidelity', 'high-mps-floor', 'high-fidelity-floor', 'high-floor-pass', 'overrides', 'nested-body']) {
    const source = scenario === 'nested-body' ? NESTED_SOURCE : 'The service retains 12 audit logs.';
    const f = await fixture(t, { source });
    const home = join(f.root, 'home');
    await mkdir(home);
    const floor = scenario.startsWith('high-') ? 95 : 0;
    await writeFile(join(home, '.patina.yaml'), JSON.stringify({
      language: 'ko', 'document-type': 'formal', persona: 'natural-ko', register: 'casual',
      backend: 'openai-http', model: 'configured-model', verification: { 'mps-floor': floor, 'fidelity-floor': floor },
    }));
    const requests = [];
    const server = createServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk;
      const payload = JSON.parse(body);
      requests.push(payload);
      const prompt = payload.messages.map(message => message.content).join('\n');
      let answer = scenario === 'nested-body' ? NESTED_RAW : source;
      if (prompt.includes('Meaning Preservation evaluator')) answer = JSON.stringify(scenario === 'hard-fail' ? highHardFailMps()
        : mpsResult(scenario === 'low-mps' ? 60 : scenario === 'high-mps-floor' ? 90 : 100));
      else if (prompt.includes('Fidelity evaluator')) answer = JSON.stringify({ claims_preserved: scenario === 'low-fidelity' ? 0 : 3,
        no_fabrication: scenario === 'low-fidelity' ? 0 : 3, audience_register_match: scenario === 'high-fidelity-floor' ? 2 : 3 });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: answer } }] }));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      await writeFile(join(f.workspace, '.patina.yaml'), JSON.stringify({ baseURL: `http://127.0.0.1:${server.address().port}/v1`,
        persona: 'natural-ko', register: 'professional' }));
      const env = { ...process.env, HOME: home, USERPROFILE: home, PATINA_API_KEY: 'aside-local-test-key',
        PATINA_API_KEY_FILE: '', PATINA_BASE_URL: '', OPENAI_BASE_URL: '', PATINA_MODEL: '',
        TMPDIR: f.temporary };
      const overrides = scenario === 'overrides' ? { language: 'en', documentType: 'technical', persona: 'natural-en', register: 'professional',
        backend: 'openai-http', model: 'one-run-model' } : {};
      const result = await runAsideRewrite({ ...f, env, overrides, timeoutMs: 20_000, tempRoot: f.temporary });
      const success = ['pass', 'high-floor-pass', 'overrides'].includes(scenario);
      const childFailed = ['hard-fail', 'high-mps-floor', 'high-fidelity-floor', 'nested-body'].includes(scenario);
      assert.equal(result.status, success ? 'verified' : 'rejected', JSON.stringify(result));
      assert.equal(result.verification.exitCode, childFailed ? 4 : 0);
      assert.equal(result.verification.cliVerified, !childFailed);
      assert.deepEqual(result.verification.configuredFloors, { mps: floor, fidelity: floor });
      assert.equal(result.verification.mpsFloor, Math.max(70, floor));
      assert.equal(result.verification.fidelityFloor, Math.max(70, floor));
      assert.equal(result.verification.mps, scenario === 'low-mps' ? 60 : scenario === 'high-mps-floor' ? 90 : scenario === 'hard-fail' ? 95 : 100);
      assert.equal(result.verification.fidelity, scenario === 'low-fidelity' ? 50 : scenario === 'high-fidelity-floor' ? 91.7 : 100);
      assert.equal(result.verification.outputHash, hashAsideText(scenario === 'nested-body' ? NESTED_GRADED : source));
      if (scenario === 'nested-body') {
        assert.equal(result.verification.reason, 'output-changed');
        assert.equal(result.verification.retried, false);
        assert.doesNotMatch(source, /\d/);
      }
      assert.ok(requests.length >= 3);
      assert.ok(requests.every(request => request.model === (scenario === 'overrides' ? 'one-run-model' : 'configured-model')));
      const rewritePrompt = requests[0].messages.map(message => message.content).join('\n');
      if (scenario === 'overrides') {
        assert.doesNotMatch(rewritePrompt, /Persona is omitted: preserve the source voice/);
        assert.match(rewritePrompt, /Register is explicit/);
        assert.equal(result.effectiveOptions.persona, 'natural-en');
        assert.equal(result.settings.persona, null);
      } else {
        assert.match(rewritePrompt, /Persona is omitted: preserve the source voice/);
        assert.match(rewritePrompt, /Register is omitted: preserve the source/);
      }
      if (success) assert.equal(await readFile(f.outputPath, 'utf8'), source);
      else await assertNoOutput(f, result);
      assert.equal(await readFile(f.inputPath, 'utf8'), source);
      assert.doesNotMatch(JSON.stringify(result), /aside-local-test-key|127\.0\.0\.1/);
    } finally {
      await new Promise(resolve => server.close(resolve));
    }
  }
});
