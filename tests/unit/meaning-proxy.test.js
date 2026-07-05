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

test('empty original + non-empty rewrite fails as hallucinated expansion (#2)', () => {
  const r = evaluateMeaningProxy({ original: '', rewrite: 'a fabricated new fact', lang: 'en' });
  assert.equal(r.severity, 'fail', 'empty→non-empty must not record a benign ratio of 1');
  assert.equal(r.ok, false);
  // A true no-op (empty→empty) stays benign.
  assert.notEqual(evaluateMeaningProxy({ original: '', rewrite: '', lang: 'en' }).severity, 'fail');
});

test('comma grouping normalizes only valid thousands groups (#3)', () => {
  // Valid grouping collapses so 1,200 === 1200 (no false dropped-number).
  assert.deepEqual(droppedNumbers('1,200 units', '1200 units'), []);
  assert.deepEqual(droppedNumbers('n 1,234,567', 'n 1234567'), []);
  assert.deepEqual(droppedNumbers('rate 1,234.56', 'rate 1234.56'), []);
  // Non-standard grouping is preserved so it never collapses onto 12 / 314 and
  // masks a genuinely dropped number.
  assert.deepEqual(droppedNumbers('value 1,2', 'value 12'), ['1,2']);
  assert.deepEqual(droppedNumbers('pi 3,14', 'pi 314'), ['3,14']);
});

test('rare-token recall does not false-survive short Latin substrings (#4)', () => {
  // us/art/ai embedded inside business/party/chair must NOT count as survived.
  const r = rareTokenRecall('AI US art', 'chair business party', 'en');
  assert.equal(r.active, true);
  assert.equal(r.survived, 0);
  assert.equal(r.recall, 0);
  // CJK substrings and long (>=5) Latin tokens still survive as substrings.
  assert.ok(rareTokenRecall('삼성전자 반도체 실적', '삼성전자의 반도체 실적이 좋다', 'ko').recall > 0);
  assert.ok(rareTokenRecall('deterministic humanizer pipeline', 'the deterministic humanizers pipelines run', 'en').recall > 0);
});

test('negation counting: multilingual advisory matrix and known Phase A gaps (#5)', () => {
  // Working cases across languages.
  assert.equal(countNegations('cannot go without it, notable', 'en'), 2);
  assert.equal(countNegations('ではありません', 'ja'), 1);
  assert.equal(countNegations('不能 没有', 'zh'), 2);
  // KNOWN advisory-only gaps, pinned so Phase B calibration has a baseline:
  //  ko: glued 안됐다/못했다 are missed; 아니메이션 false-positives on 아니 → net 1.
  assert.equal(countNegations('안됐다 못했다 아니메이션', 'ko'), 1);
  //  ja: mid-sentence 使わずに missed; 少ない (lexical adj) false-positive on ない → net 1.
  assert.equal(countNegations('使わずに 少ない', 'ja'), 1);
  //  zh: 非常/无锡 (compound / proper noun) false-positive on 非/无 → 4 not 2.
  assert.equal(countNegations('不能 没有 非常 无锡', 'zh'), 4);
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
