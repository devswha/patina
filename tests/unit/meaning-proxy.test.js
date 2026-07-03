import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateMeaningProxy, countNegations, rareTokenRecall, droppedNumbers } from '../../src/features/meaning-proxy.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const fixtures = JSON.parse(readFileSync(resolve(REPO_ROOT, 'tests/fixtures/meaning-proxy/pairs.json'), 'utf8'));

test('meaning-preserving pairs never fail (pass or warn only)', () => {
  for (const f of fixtures.preserving) {
    const r = evaluateMeaningProxy(f);
    assert.notEqual(r.severity, 'fail', `${f.name}: preserving pair must not be a proxy FAIL (got reasons: ${r.reasons.join('; ')})`);
    assert.ok(r.ok, `${f.name}: ok should be true`);
  }
});

test('meaning-broken pairs (dropped entities / polarity flip / truncation) fail', () => {
  for (const f of fixtures.broken) {
    const r = evaluateMeaningProxy(f);
    assert.equal(r.severity, 'fail', `${f.name}: broken pair must be a proxy FAIL`);
    assert.equal(r.ok, false);
    assert.ok(r.reasons.length > 0, `${f.name}: a fail must carry reasons`);
  }
});

test('negation counting is word/token-boundary, not raw substring', () => {
  // "notable"/"annotation"/"cannonball" contain the letters of negations but are
  // NOT negations; only whole-word markers + n't contractions count.
  assert.equal(countNegations('This is a notable annotation about a cannonball.', 'en'), 0);
  assert.equal(countNegations("It is not ready and cannot start; nothing works.", 'en'), 3);
  assert.equal(countNegations("It isn't ready and won't start.", 'en'), 2);
  // ko: standalone 안/못 and 않/없/아니 morphemes count; 안전/안내 must NOT.
  assert.equal(countNegations('안전 안내 데스크', 'ko'), 0);
  assert.ok(countNegations('그건 안 되고 문제가 없다', 'ko') >= 2);
});

test('rare-token recall is inactive below 3 rare tokens (no N=1 volatility fail)', () => {
  const short = { lang: 'en', original: 'Go now.', rewrite: 'Please deploy soon.' };
  const rare = rareTokenRecall(short.original, short.rewrite, 'en');
  assert.equal(rare.active, false, 'a <3-rare-token original must not activate the recall signal');
  const r = evaluateMeaningProxy(short);
  // With the recall signal inactive, a heavily reworded SHORT text is not a
  // rare-token FAIL (length ratio here stays within bounds).
  assert.notEqual(r.severity, 'fail');
  assert.equal(r.signals.rareTokenRecall, null);
});

test('dropped numbers are reported deterministically', () => {
  assert.deepEqual(droppedNumbers('There were 30 in 2024.', 'There were thirty last year.'), ['30', '2024']);
  assert.deepEqual(droppedNumbers('1,200 units', '1200 units'), []);
});

test('meaning-proxy imports no backend/LLM module (Lane A purity)', () => {
  const src = readFileSync(resolve(REPO_ROOT, 'src/features/meaning-proxy.js'), 'utf8');
  const imports = [...src.matchAll(/^import\s+.*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  // The only allowed dependency is the Lane A feature substrate.
  assert.deepEqual(imports, ['./index.js'], `unexpected imports: ${JSON.stringify(imports)}`);
  for (const forbidden of ['backends', 'api.js', 'scoring.js', 'providers.js', 'verify.js', 'prompt-builder']) {
    assert.ok(!src.includes(`/${forbidden}`) && !src.includes(`${forbidden}'`), `must not reference ${forbidden}`);
  }
});
