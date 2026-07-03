import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { runPersonaNew, runPersonaList, runPersonaShow, runPersonaRm, runPersonaEdit, runPersona } from '../../src/commands/persona.js';
import { loadPersona } from '../../src/personas/loader.js';
import { PatinaCliError } from '../../src/errors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

function tempRepo() {
  const tmp = mkdtempSync(join(tmpdir(), 'persona-cmd-'));
  cpSync(join(REPO_ROOT, 'personas'), join(tmp, 'personas'), { recursive: true });
  return tmp;
}

const silent = { info() {}, warn() {} };

test('persona new --template writes a valid, loadable custom persona', async () => {
  const repoRoot = tempRepo();
  const path = await runPersonaNew(['my-voice', '--lang', 'en', '--template'], { repoRoot, logger: silent });
  assert.ok(existsSync(path));
  assert.match(path, /custom\/personas\/en\/my-voice\.md$/);
  // Loads back through the real (validating) loader.
  const loaded = loadPersona(repoRoot, 'en', 'my-voice');
  assert.equal(loaded.id, 'my-voice');
  assert.equal(loaded.lang, 'en');
  assert.equal(loaded.source, 'learned');
  assert.equal(loaded.mps.floor, 70);
});

test('persona new --describe uses the backend but never leaks gate-weakening keys', async () => {
  const repoRoot = tempRepo();
  // A hostile backend tries to smuggle skip_patterns + a lowered floor.
  const mockLLM = async () => JSON.stringify({
    name: 'Warm direct',
    depth: 'style-only',
    register: 'warm-professional',
    prefer: ['구체적으로', '솔직히'],
    avoid: ['혁신적', '시너지'],
    skip_patterns: ['ko-c1'],
    mps: { enforce: false, floor: 10 },
  });
  const path = await runPersonaNew(['founder-warm', '--lang', 'ko', '--describe', '담백하고 따뜻한 창업자'], { repoRoot, callLLM: mockLLM, logger: silent });
  const raw = readFileSync(path, 'utf8');
  assert.doesNotMatch(raw, /skip_patterns|blocklist|allowlist|disable_/);
  // Floors are clamped to the core minimum, not the smuggled value.
  const loaded = loadPersona(repoRoot, 'ko', 'founder-warm');
  assert.equal(loaded.mps.floor, 70);
  assert.equal(loaded.mps.enforce, true);
  assert.deepEqual(loaded.blocks.preferredWords.allow, ['구체적으로', '솔직히']);
});

test('persona new --from-sample derives deterministic target features', async () => {
  const repoRoot = tempRepo();
  const sampleFile = join(repoRoot, 'sample.txt');
  writeFileSync(sampleFile, '오늘은 제품을 다시 보면서 문장 리듬을 다듬었다. 짧게 쓰고, 다시 읽고, 또 줄였다. 결론보다 흐름이 먼저 보이면 좋겠다.');
  const mockLLM = async () => JSON.stringify({ name: '에세이체', depth: 'style-only', register: 'plain', prefer: ['다듬었다'], avoid: [] });
  const path = await runPersonaNew(['essayist', '--lang', 'ko', '--from-sample', sampleFile], { repoRoot, callLLM: mockLLM, logger: silent });
  const loaded = loadPersona(repoRoot, 'ko', 'essayist');
  // Deterministic, language-agnostic anchors were measured from the sample.
  assert.ok(loaded.targetFeatures.sentence_opener_diversity);
  assert.ok(typeof loaded.targetFeatures.burstiness_cv.target === 'number');
  assert.ok(existsSync(path));
});

test('persona new rejects a bad id and an unsupported lang', async () => {
  const repoRoot = tempRepo();
  await assert.rejects(
    () => runPersonaNew(['Bad_Id', '--template'], { repoRoot, logger: silent }),
    (err) => err instanceof PatinaCliError && err.exitCode === 2,
  );
  await assert.rejects(
    () => runPersonaNew(['ok-id', '--lang', 'fr', '--template'], { repoRoot, logger: silent }),
    (err) => err instanceof PatinaCliError && err.exitCode === 2,
  );
});

test('persona new refuses to clobber an existing custom persona without --force', async () => {
  const repoRoot = tempRepo();
  await runPersonaNew(['dup', '--lang', 'ko', '--template'], { repoRoot, logger: silent });
  await assert.rejects(
    () => runPersonaNew(['dup', '--lang', 'ko', '--template'], { repoRoot, logger: silent }),
    (err) => err instanceof PatinaCliError && err.exitCode === 2,
  );
  // --force overwrites.
  const path = await runPersonaNew(['dup', '--lang', 'ko', '--template', '--force'], { repoRoot, logger: silent });
  assert.ok(existsSync(path));
});

test('persona new with no mode and --no-interactive fails closed', async () => {
  const repoRoot = tempRepo();
  await assert.rejects(
    () => runPersonaNew(['x', '--no-interactive'], { repoRoot, logger: silent }),
    (err) => err instanceof PatinaCliError && err.exitCode === 2,
  );
});

test('interactive wizard routes to the chosen mode via injected ask', async () => {
  const repoRoot = tempRepo();
  const answers = ['2', '따뜻하고 담백한 말투']; // [2] describe, then the description
  const ask = async () => answers.shift();
  const mockLLM = async () => JSON.stringify({ name: '따뜻체', depth: 'style-only', register: 'warm', prefer: ['담백하게'], avoid: [] });
  const path = await runPersonaNew(['wiz-voice', '--lang', 'ko'], { repoRoot, ask, callLLM: mockLLM, logger: silent, interactive: true });
  const loaded = loadPersona(repoRoot, 'ko', 'wiz-voice');
  assert.equal(loaded.id, 'wiz-voice');
  assert.ok(existsSync(path));
});

test('persona list reports built-in and custom personas per language', async () => {
  const repoRoot = tempRepo();
  await runPersonaNew(['mine', '--lang', 'ko', '--template'], { repoRoot, logger: silent });
  const listing = runPersonaList(['--lang', 'ko', '--format', 'json'], { repoRoot });
  assert.ok(listing.ko.builtin.includes('preserve'));
  assert.ok(listing.ko.custom.includes('mine'));
  assert.ok(!listing.ko.builtin.includes('mine'));
});

test('persona dispatch rejects an unknown subcommand', async () => {
  await assert.rejects(
    () => runPersona(['frobnicate'], { repoRoot: REPO_ROOT }),
    (err) => err instanceof PatinaCliError && err.exitCode === 2,
  );
});

function captureLog(fn) {
  const logs = [];
  const orig = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  try { const ret = fn(); return { logs, ret }; }
  finally { console.log = orig; }
}

test('persona show --json prints the normalized persona and never the body', () => {
  const repoRoot = tempRepo();
  const { logs, ret } = captureLog(() => runPersonaShow(['preserve', '--lang', 'ko', '--json'], { repoRoot }));
  const printed = JSON.parse(logs.join('\n'));
  const expected = loadPersona(repoRoot, 'ko', 'preserve');
  assert.deepEqual(printed, expected);
  assert.deepEqual(ret, expected);
  // The docs-only Markdown body must never appear in JSON output.
  assert.doesNotMatch(logs.join('\n'), /docs-only|# /);
});

test('persona show human output lists target_features and never prints the body', () => {
  const repoRoot = tempRepo();
  const { logs } = captureLog(() => runPersonaShow(['natural-ko', '--lang', 'ko'], { repoRoot }));
  const out = logs.join('\n');
  assert.match(out, /target_features:/);
  assert.match(out, /burstiness_cv/);
  assert.match(out, /source:\s+library/);
});

test('persona rm refuses a built-in library persona and leaves it intact', async () => {
  const repoRoot = tempRepo();
  const libPath = join(repoRoot, 'personas', 'ko', 'natural-ko.md');
  assert.ok(existsSync(libPath));
  await assert.rejects(
    () => runPersonaRm(['natural-ko', '--lang', 'ko', '--force'], { repoRoot, logger: silent }),
    (err) => err instanceof PatinaCliError && err.exitCode === 2 && /built-in personas cannot be removed/.test(err.message),
  );
  assert.ok(existsSync(libPath));
});

test('persona rm refuses the preserve default', async () => {
  const repoRoot = tempRepo();
  await assert.rejects(
    () => runPersonaRm(['preserve', '--force'], { repoRoot, logger: silent }),
    (err) => err instanceof PatinaCliError && err.exitCode === 2,
  );
});

test('persona rm requires a custom persona to exist', async () => {
  const repoRoot = tempRepo();
  await assert.rejects(
    () => runPersonaRm(['nope-not-here', '--lang', 'ko', '--force'], { repoRoot, logger: silent }),
    (err) => err instanceof PatinaCliError && err.exitCode === 2,
  );
});

test('persona rm --force deletes exactly the custom persona and leaves others intact', async () => {
  const repoRoot = tempRepo();
  await runPersonaNew(['one', '--lang', 'ko', '--template'], { repoRoot, logger: silent });
  await runPersonaNew(['two', '--lang', 'ko', '--template'], { repoRoot, logger: silent });
  const onePath = join(repoRoot, 'custom', 'personas', 'ko', 'one.md');
  const twoPath = join(repoRoot, 'custom', 'personas', 'ko', 'two.md');
  const removed = await runPersonaRm(['one', '--lang', 'ko', '--force'], { repoRoot, logger: silent });
  assert.equal(removed, onePath);
  assert.ok(!existsSync(onePath));
  assert.ok(existsSync(twoPath));
});

test('persona rm honors the interactive confirm via injected ask', async () => {
  const repoRoot = tempRepo();
  await runPersonaNew(['keep', '--lang', 'ko', '--template'], { repoRoot, logger: silent });
  const p = join(repoRoot, 'custom', 'personas', 'ko', 'keep.md');
  // Declining leaves the file untouched.
  const aborted = await runPersonaRm(['keep', '--lang', 'ko'], { repoRoot, logger: silent, ask: async () => 'n' });
  assert.equal(aborted, null);
  assert.ok(existsSync(p));
  // 'yes' confirms and deletes.
  const removed = await runPersonaRm(['keep', '--lang', 'ko'], { repoRoot, logger: silent, ask: async () => 'yes' });
  assert.equal(removed, p);
  assert.ok(!existsSync(p));
});

test('persona edit --name copies a library persona into custom and preserves the library', async () => {
  const repoRoot = tempRepo();
  const libPath = join(repoRoot, 'personas', 'ko', 'natural-ko.md');
  const libBefore = readFileSync(libPath, 'utf8');
  const written = await runPersonaEdit(['natural-ko', '--lang', 'ko', '--name', 'My Natural KO'], { repoRoot, logger: silent });
  assert.match(written, /custom\/personas\/ko\/natural-ko\.md$/);
  // Library file is untouched (copy-on-edit into custom only).
  assert.ok(existsSync(libPath));
  assert.equal(readFileSync(libPath, 'utf8'), libBefore);
  // The shadow reloads through the validating loader (custom-first).
  const reloaded = loadPersona(repoRoot, 'ko', 'natural-ko');
  assert.equal(reloaded.name, 'My Natural KO');
  assert.equal(reloaded.source, 'learned');
  assert.equal(reloaded.mps.floor, 70);
  assert.equal(reloaded.fidelity.floor, 70);
});

test('persona edit requires an edit input flag', async () => {
  const repoRoot = tempRepo();
  await assert.rejects(
    () => runPersonaEdit(['natural-ko', '--lang', 'ko'], { repoRoot, logger: silent }),
    (err) => err instanceof PatinaCliError && err.exitCode === 2,
  );
});

test('persona dispatch unknown subcommand lists all five subcommands', async () => {
  await assert.rejects(
    () => runPersona(['frobnicate'], { repoRoot: REPO_ROOT }),
    (err) => err instanceof PatinaCliError && /new, list, show, rm, edit/.test(err.message),
  );
});
