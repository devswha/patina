import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { runPersonaNew, runPersonaList, runPersona } from '../../src/commands/persona.js';
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
