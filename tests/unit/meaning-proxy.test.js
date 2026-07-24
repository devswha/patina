import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateMeaningProxy, evaluateNumberSafety, countNegations, rareTokenRecall, droppedNumbers } from '../../src/features/meaning-proxy.js';

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
test('number safety accepts only deterministic equivalent claims across locales', () => {
  const cases = [
    ['en grouping', 'en', 'Revenue was 1,200.', 'Revenue was 1200.'],
    ['en full date', 'en', 'Due January 2, 2024.', 'Due January 2, 2024.'],
    ['en ISO currency', 'en', 'It cost USD 1,200.', 'It cost USD 1200.'],
    ['en percent wording', 'en', 'Growth was 30 percent.', 'Growth was 30%.'],
    ['en allowlisted unit conversion', 'en', 'The route is 1 km.', 'The route is 1000 m.'],
    ['en word number', 'en', 'Choose one option.', 'Choose 1 option.'],
    ['ko grouping', 'ko', '매출은 1,200이었다.', '매출은 1200이었다.'],
    ['ko full date', 'ko', '마감일은 2024년 1월 2일이다.', '마감일은 2024년 1월 2일이다.'],
    ['ko ISO currency', 'ko', '비용은 KRW 1200이다.', '비용은 KRW 1,200이다.'],
    ['ko percent wording', 'ko', '성장률은 30퍼센트다.', '성장률은 30%다.'],
    ['ko word number', 'ko', '하나를 선택한다.', '1개를 선택한다.'],
    ['zh grouping', 'zh', '收入为1,200。', '收入为1200。'],
    ['zh full date', 'zh', '截止日期是2024年1月2日。', '截止日期是2024年1月2日。'],
    ['zh ISO currency', 'zh', '价格为CNY 1200。', '价格为CNY 1,200。'],
    ['zh percent wording', 'zh', '增长百分之30。', '增长30%。'],
    ['zh recognized percent claim', 'zh', '百分之30。', '30%。'],
    ['zh word number', 'zh', '选择一项。', '选择1项。'],
    ['ja grouping', 'ja', '売上は1,200です。', '売上は1200です。'],
    ['ja full date', 'ja', '締切は2024年1月2日です。', '締切は2024年1月2日です。'],
    ['ja ISO currency', 'ja', '価格はJPY 1200です。', '価格はJPY 1,200です。'],
    ['ja percent wording', 'ja', '成長率は30パーセントです。', '成長率は30%です。'],
    ['ja word number', 'ja', '一つ選びます。', '1つ選びます。'],
  ];
  for (const [name, lang, original, rewrite] of cases) {
    const result = evaluateNumberSafety(original, rewrite, lang);
    assert.equal(result.ok, true, `${name}: ${result.reason}`);
    assert.equal(result.version, 'numeric-safety-v2');
  }
});

test('number safety preserves independent numeric claims, signs, multiplicity, and punctuation commas', () => {
  const passing = [
    ['punctuation comma', 'en', 'Version 1, then 2.', 'Version 1, then 2.'],
    ['negative value', 'en', 'The balance is -5.', 'The balance is -5.'],
    ['negative value', 'ko', '잔액은 -5이다.', '잔액은 -5이다.'],
    ['negative value', 'zh', '余额为-5。', '余额为-5。'],
    ['negative value', 'ja', '残高は-5です。', '残高は-5です。'],
    ['independent claim reordering', 'ko', '2024년에 고객 30명을 확보했다.', '고객 30명을 확보한 것은 2024년이다.'],
    ['duplicate positive control', 'en', 'Values 1, then 1.', 'Values 1, then 1.'],
    ['ordinary decimal', 'en', 'The value is 0.05.', 'The value is 0.05.'],
  ];
  for (const [name, lang, original, rewrite] of passing) {
    assert.equal(evaluateNumberSafety(original, rewrite, lang).ok, true, name);
  }
  const groupedCurrency = evaluateNumberSafety('It cost USD 1,200.', 'It cost USD 1200.', 'en');
  assert.deepEqual(groupedCurrency.originalClaims, ['currency:USD:1200/1']);
  assert.deepEqual(groupedCurrency.rewriteClaims, ['currency:USD:1200/1']);

  const failing = [
    ['unsupported slash ratio', 'en', 'Ratio 1/2.', 'Ratio 2/1.', 'ambiguous_numeric_syntax'],
    ['unsupported range', 'en', 'Range 1-2.', 'Range 1-2.', 'unsupported_numeric_syntax'],
    ['unsupported addition', 'en', 'Total 1+2.', 'Total 1+2.', 'unsupported_numeric_syntax'],
    ['unsupported ratio', 'en', 'Ratio 1:2.', 'Ratio 1:2.', 'unsupported_numeric_syntax'],
    ['unsupported Unicode decimal digit', 'en', 'Value ３０.', 'Value ３０.', 'unsupported_numeric_syntax'],
    ['duplicate occurrence loss', 'en', 'Values 1, then 1.', 'Value 1.', 'numeric_claim_changed'],
    ['sign flip', 'en', 'The balance is -5.', 'The balance is 5.', 'numeric_claim_changed'],
    ['sign flip', 'ko', '잔액은 -5이다.', '잔액은 5이다.', 'numeric_claim_changed'],
    ['sign flip', 'zh', '余额为-5。', '余额为5。', 'numeric_claim_changed'],
    ['sign flip', 'ja', '残高は-5です。', '残高は5です。', 'numeric_claim_changed'],
    ['Unicode minus sign flip', 'en', 'The balance is −5.', 'The balance is 5.', 'numeric_claim_changed'],
    ['leading-dot decimal comparator flip', 'en', 'p < .05', 'p > .05', 'unsupported_numeric_syntax'],
    ['leading-dot decimal sign flip', 'en', 'The value is -.5.', 'The value is .5.', 'unsupported_numeric_syntax'],
    ['unchanged leading-dot decimal syntax', 'en', 'The value is .05.', 'The value is .05.', 'unsupported_numeric_syntax'],
    ['unchanged Unicode-minus leading-dot decimal syntax', 'en', 'The value is −.5.', 'The value is −.5.', 'unsupported_numeric_syntax'],
    ['unchanged numeric comparator', 'en', 'p < 0.05', 'p < 0.05', 'unsupported_numeric_syntax'],
    ['changed numeric comparator cannot reuse number multiset', 'en', 'p < 0.05', 'p > 0.05', 'unsupported_numeric_syntax'],
  ];
  for (const [name, lang, original, rewrite, reason] of failing) {
    const result = evaluateNumberSafety(original, rewrite, lang);
    assert.equal(result.ok, false, name);
    assert.equal(result.reason, reason, name);
    if (name === 'duplicate occurrence loss' || name === 'sign flip') {
      const proxy = evaluateMeaningProxy({ original, rewrite, lang });
      assert.equal(proxy.signals.numberSafety.ok, false, `${name}: stream-facing result`);
      assert.ok(proxy.reasons.includes(`number safety failed: ${reason}`), `${name}: explicit failure reason`);
    }
  }
});
test('number safety handles numeric syntax adversaries without blocking common prose', () => {
  const passing = [
    ['hyphenated age adjective', 'en', 'A 3-year plan.', 'A 3-year plan.'],
    ['chapter label', 'en', 'chapter 1: Introduction', 'chapter 1: Introduction'],
    ['Chinese lexical 一般/一定', 'zh', '这是一般说明。', '这是一定说明。'],
    ['Korean grammatical particles', 'ko', '이 일이 중요하다.', '이 일은 중요하다.'],
    ['Chinese counter', 'zh', '选择一项。', '选择1项。'],
    ['Japanese counter', 'ja', '一つ選びます。', '1つ選びます。'],
    ['Korean lexical word is not a numeral', 'ko', '열정이 필요하다.', '의욕이 필요하다.'],
  ];
  for (const [name, lang, original, rewrite] of passing) {
    assert.equal(evaluateNumberSafety(original, rewrite, lang).ok, true, name);
  }

  const failing = [
    ['Unicode minus changes value', 'en', '−5', '5'],
    ['unsupported degree temperature', 'en', '30 °C', '30 °F'],
    ['abbreviated English month date', 'en', 'Feb 3, 2026', 'Mar 3, 2026'],
  ];
  for (const [name, lang, original, rewrite] of failing) {
    assert.equal(evaluateNumberSafety(original, rewrite, lang).ok, false, name);
  }
});
test('number safety handles CJK numeric context and Han numeral compounds', () => {
  const passing = [
    ['ko particle', 'ko', '1200이었다', 'number:1200/1'],
    ['ko signed particle', 'ko', '-5이다', 'number:-5/1'],
    ['zh counter', 'zh', '1项', 'number:1/1'],
    ['ja particle', 'ja', '12です', 'number:12/1'],
  ];
  for (const [name, lang, text, claim] of passing) {
    const result = evaluateNumberSafety(text, text, lang);
    assert.equal(result.ok, true, name);
    assert.equal(result.reason, null, name);
    assert.deepEqual(result.originalClaims, [claim], name);
  }
  const changedCounters = [
    ['zh 台 counter changes', 'zh', '一台设备。', '二台设备。'],
    ['ja 台 counter changes', 'ja', '一台です。', '二台です。'],
    ['ko enumerated word numerals change', 'ko', '하나를 선택한다.', '둘을 선택한다.'],
  ];
  for (const [name, lang, original, rewrite] of changedCounters) {
    assert.equal(evaluateNumberSafety(original, rewrite, lang).ok, false, name);
  }

  const koreanEnumerated = [
    ['하나 particle', '하나를 선택한다.', '1개를 선택한다.', 'number:1/1'],
    ['둘 particle', '둘을 선택한다.', '2개를 선택한다.', 'number:2/1'],
    ['explicit numeric counter', '1대를 선택한다.', '1대를 선택한다.', 'number:1/1'],
  ];
  for (const [name, original, rewrite, claim] of koreanEnumerated) {
    const result = evaluateNumberSafety(original, rewrite, 'ko');
    assert.equal(result.ok, true, name);
    assert.deepEqual(result.originalClaims, [claim], name);
  }

  const failing = [
    ['zh adjacent Han numerals', 'zh', '十二'],
    ['ja adjacent Han numerals', 'ja', '十二'],
  ];
  for (const [name, lang, text] of failing) {
    const result = evaluateNumberSafety(text, text, lang);
    assert.equal(result.ok, false, name);
    assert.equal(result.reason, 'unsupported_word_number', name);
  }
});

test('number safety rejects unsupported or partial word-number expressions', () => {
  const cases = [
    ['en unsupported teen word number', 'en', 'Choose thirteen options.', 'Choose one option.'],
    ['en unsupported magnitude must not collapse', 'en', 'Choose one quadrillion options.', 'Choose one option.'],
    ['en partial word number', 'en', 'Choose one hundred options.', 'Choose one option.'],
    ['en unsupported word-number insertion', 'en', 'Choose one option.', 'Choose one hundred options.'],
    ['ko compound word number', 'ko', '열하나를 선택한다.', '하나를 선택한다.'],
    ['ko standalone magnitude with counter', 'ko', '백 명이 참석했다.', '백 명이 참석했다.'],
    ['ko standalone fraction', 'ko', '절반을 사용한다.', '절반을 사용한다.'],
    ['zh compound word number', 'zh', '选择十一项。', '选择一项。'],
    ['zh standalone unsupported word number', 'zh', '百项选择。', '一项选择。'],
    ['ja compound word number', 'ja', '十一個を選びます。', '一つ選びます。'],
  ];
  for (const [name, lang, original, rewrite] of cases) {
    const result = evaluateNumberSafety(original, rewrite, lang);
    assert.equal(result.ok, false, name);
    assert.equal(result.reason, 'unsupported_word_number', name);
  }
});
test('number safety v2 leaves everyday KO/EN words claim-free (precision regression)', () => {
  // v1 regressions: Sino-Korean numeral morphemes inside ordinary words
  // (이+해, 오+해, 구+조, 조+건, 경+이, 만+일) and bare EN ordinals/fractions
  // 422-rejected most real prose on the live web tier. These must all pass.
  const cases = [
    ['ko 이해', 'ko', '이 문제를 이해하고 있다.'],
    ['ko 오해', 'ko', '오해를 풀고 싶다.'],
    ['ko 구조', 'ko', '시스템 구조를 바꿨다.'],
    ['ko 조건', 'ko', '조건이 좋아진다.'],
    ['ko 조회', 'ko', '조회수가 늘었다.'],
    ['ko 만일', 'ko', '만일의 사태에 대비한다.'],
    ['ko 환경+조사', 'ko', '디지털 환경이 빠르게 바뀌고 있다.'],
    ['ko 천장', 'ko', '천장이 높다.'],
    ['ko 만장일치', 'ko', '만장일치로 통과했다.'],
    ['ko 해+명절', 'ko', '그 해 명절에 모였다.'],
    ['ko 환경 개선', 'ko', '환경 개선이 필요하다.'],
    ['en ordinal prose', 'en', 'The first thing to check is the score.'],
    ['en fraction prose', 'en', 'Half of our users prefer the second option.'],
    ['en quarter prose', 'en', 'Revenue grew this quarter.'],
  ];
  for (const [name, lang, text] of cases) {
    const result = evaluateNumberSafety(text, text, lang);
    assert.equal(result.ok, true, `${name}: ${result.reason}`);
  }
  // Ordinal/fraction word drift is delegated to the LLM MPS/fidelity floors in
  // v2 — the deterministic gate no longer rejects it.
  assert.equal(evaluateNumberSafety('Choose the first option.', 'Choose the second option.', 'en').ok, true);
});
test('number safety v2.2: 분의/쉰 substrings stay lexical, real numerals stay guarded', () => {
  // Live 422s: '분의' is a substring of 여러분의/대부분의 and bare '쉰' is the
  // rest-verb form far more often than fifty. Digit fractions keep their
  // protection through claimed digits; 쉰 with a counter is still a numeral.
  for (const t of ['대부분의 사람들이 동의한다.', '여러분의 성원에 감사드립니다.', '목이 쉰 소리가 났다.', '하루 쉰 다음 다시 시작했다.', '3분의 1이 찬성했다.']) {
    const r = evaluateNumberSafety(t, t, 'ko');
    assert.equal(r.ok, true, `${t}: ${r.reason}`);
  }
  for (const t of ['쉰 명이 모였다.', '쉰 살이 되었다.']) {
    assert.equal(evaluateNumberSafety(t, t, 'ko').reason, 'unsupported_word_number', t);
  }
  assert.equal(evaluateNumberSafety('3분의 1이 찬성했다.', '3분의 2가 찬성했다.', 'ko').reason, 'numeric_claim_changed');
});
test('number safety leaves bare KO discourse counters claim-free (v2.1 regression)', () => {
  // Live 422: "아무도 말해주지 않는 사실 하나 —" claimed number:1, so the
  // faux-insight rewrite that deletes the frame (with its counter) failed
  // numeric equivalence. Bare numerals without a particle/counter are
  // discourse counters, not quantity claims.
  const original = '솔직히 말하면, 반전: 개발 기간은 겨우 두 달이었습니다. 아무도 말해주지 않는 사실 하나 — 좋은 도구는 홍보가 필요 없습니다.';
  const rewrite = '개발 기간은 겨우 두 달이었다. 좋은 도구는 홍보가 필요 없다.';
  const result = evaluateNumberSafety(original, rewrite, 'ko');
  assert.equal(result.ok, true, result.reason);
  assert.deepEqual(result.originalClaims, []);
  const bare = [
    ['sentence-final bare numeral', '팁 하나 공유합니다.', '팁을 공유합니다.'],
    ['dash-separated bare numeral', '질문 하나. 왜 지금인가?', '왜 지금인가?'],
  ];
  for (const [name, o, r] of bare) {
    assert.equal(evaluateNumberSafety(o, r, 'ko').ok, true, name);
  }
  // Particled/countered numerals stay claimed: dropping one still fails.
  assert.equal(evaluateNumberSafety('하나를 선택한다.', '선택한다.', 'ko').ok, false);
  assert.equal(evaluateNumberSafety('하나만 남았다.', '남았다.', 'ko').ok, false);
});
test('number safety claims KO digit+magnitude and fail-closes chained magnitudes', () => {
  const passing = [
    ['single magnitude with counter', '참석자가 3만 명이다.', '참석자가 3만 명이다.', ['number:30000/1']],
    ['grouped digits + magnitude', '매출이 1,200만 원 늘었다.', '매출이 1,200만 원 늘었다.', ['number:12000000/1']],
    ['decimal magnitude', '예산은 1.5억이다.', '예산은 1.5억이다.', ['number:150000000/1']],
    ['notation equivalence 3만 == 30000', '참석자가 3만 명이다.', '참석자가 30000명이다.', ['number:30000/1']],
    ['만 as 滿 stays lexical (5점 만점)', '별점 5점 만점에 4점이다.', '별점 5점 만점에 4점이다.', ['number:5/1', 'number:4/1']],
  ];
  for (const [name, original, rewrite, claims] of passing) {
    const result = evaluateNumberSafety(original, rewrite, 'ko');
    assert.equal(result.ok, true, `${name}: ${result.reason}`);
    assert.deepEqual(result.originalClaims, claims, name);
  }
  const failing = [
    ['dropped magnitude value', '매출이 1,200만 원 늘었다.', '매출이 늘었다.', 'numeric_claim_changed'],
    ['changed magnitude value', '참석자가 3만 명이다.', '참석자가 5만 명이다.', 'numeric_claim_changed'],
    ['spaced chain fails closed', '예산은 1억 2천만 원이다.', '예산은 1억 2천만 원이다.', 'unsupported_word_number'],
    ['chain drift never compares partial claims', '예산은 1억 2천만 원이다.', '예산은 1억 2천억 원이다.', 'unsupported_word_number'],
    ['attached chain fails closed', '가격은 3만5천 원이다.', '가격은 3만5천 원이다.', 'unsupported_word_number'],
  ];
  for (const [name, original, rewrite, reason] of failing) {
    const result = evaluateNumberSafety(original, rewrite, 'ko');
    assert.equal(result.ok, false, name);
    assert.equal(result.reason, reason, name);
  }
});
test('number safety fails closed for ambiguous or changed numeric claims', () => {
  const cases = [
    ['ambiguous comma decimal', 'en', 'The rate is 3,14.', 'The rate is 3,14.', 'ambiguous_number_grouping'],
    ['ambiguous slash date', 'en', 'Due 01/02/2024.', 'Due 01/02/2024.', 'ambiguous_numeric_syntax'],
    ['symbol-only currency', 'ko', '비용은 ₩1200이다.', '비용은 ₩1200이다.', 'ambiguous_numeric_syntax'],
    ['compound unit', 'zh', '速度是10 km/h。', '速度是10 km/h。', 'ambiguous_numeric_syntax'],
    ['missing value', 'ja', '在庫は12です。', '在庫があります。', 'numeric_claim_changed'],
    ['added value', 'en', 'There are 12 seats.', 'There are 12 seats and 3 tables.', 'numeric_claim_changed'],
    ['changed date', 'ko', '마감일은 2024년 1월 2일이다.', '마감일은 2024년 1월 3일이다.', 'numeric_claim_changed'],
    ['changed currency', 'zh', '价格为CNY 1200。', '价格为CNY 1300。', 'numeric_claim_changed'],
    ['changed percent', 'ja', '成長率は30%です。', '成長率は31%です。', 'numeric_claim_changed'],
    ['unsupported conversion', 'en', 'The route is 1 km.', 'The route is 999 m.', 'numeric_claim_changed'],
  ];
  for (const [name, lang, original, rewrite, reason] of cases) {
    const result = evaluateNumberSafety(original, rewrite, lang);
    assert.equal(result.ok, false, name);
    assert.equal(result.reason, reason, name);
    const proxy = evaluateMeaningProxy({ original, rewrite, lang });
    assert.equal(proxy.signals.numberSafety.ok, false, `${name}: stream-facing result`);
    assert.ok(proxy.reasons.includes(`number safety failed: ${reason}`), `${name}: explicit failure reason`);
  }
});
