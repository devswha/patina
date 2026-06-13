import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectTranslationese, TRANSLATIONESE_RULES } from '../../src/features/translationese.js';
import { analyzeText } from '../../src/features/index.js';
import {
  KO_POST_EDITESE_SCHEMA,
  koreanPostEditeseFeatures,
} from '../../src/features/stylometry.js';
import {
  KO_INTERFERENCE_RULE_IDS,
  KO_POST_EDITESE_INTERFERENCE_RULE_IDS,
  KO_INTERFERENCE_TRANSLATIONESE_RULES,
  getKoInterferenceRule,
} from '../../src/features/catalog/ko-interference.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');


test('calque-dense ko fires (count + density gate met)', () => {
  const text = '당신은 이 도구를 사용할 수 있습니다. 그것은 다양한 기능을 제공합니다. 이 작업은 에이전트에 의해 처리됩니다. 사용법은 다음과 같습니다.';
  const r = detectTranslationese(text, { lang: 'ko' });
  assert.equal(r.hot, true);
  assert.ok(r.count >= 4, `count ${r.count}`);
  assert.ok(r.density >= 0.5, `density ${r.density}`);
  const ids = r.byRule.map((x) => x.id);
  assert.ok(ids.includes('direct-address-you'));
  assert.ok(ids.includes('dummy-subject'));
  assert.ok(ids.includes('provides'));
});

test('a single calque in long clean prose does NOT fire (density gate)', () => {
  const text = '오늘 점심은 김치찌개를 먹었다. 비가 와서 우산을 챙겼다. 이 작업은 에이전트에 의해 처리되었다. 친구랑 영화를 봤는데 생각보다 재밌었다. 날씨가 좋아서 좀 걸었다.';
  const r = detectTranslationese(text, { lang: 'ko' });
  assert.equal(r.hot, false);
  assert.ok(r.count < 4);
});

test('clean native ko has zero calque hits (no false positive)', () => {
  const text = '어제는 비가 많이 왔다. 그래서 집에만 있었다. 라면 끓여 먹고 영화 한 편 봤다. 나쁘지 않은 하루였다.';
  const r = detectTranslationese(text, { lang: 'ko' });
  assert.equal(r.count, 0);
  assert.equal(r.hot, false);
});

test('noun-calque catches "커맨드 기둥" style direct calques', () => {
  const r = detectTranslationese('세 가지 커맨드 기둥을 설치합니다. 기둥 커맨드는 그 다음에 호출합니다.', { lang: 'ko' });
  assert.ok(r.byRule.some((x) => x.id === 'noun-calque'));
  assert.ok(r.hits.some((h) => h.includes('기둥')));
});

test('non-ko languages are skipped (calques are ko-specific here)', () => {
  const r = detectTranslationese('You can use this. It is provided by the agent.', { lang: 'en' });
  assert.equal(r.count, 0);
  assert.equal(r.hot, false);
});

test('every rule ships a before/after example', () => {
  for (const rule of TRANSLATIONESE_RULES) {
    assert.ok(rule.example && rule.example.before && rule.example.after, `rule ${rule.id} missing example`);
    // the rule must actually match its own "before" example
    assert.ok(rule.re().test(rule.example.before), `rule ${rule.id} does not match its before example`);
  }
});

test('ko interference catalog drives translationese and post-editese consumers', () => {
  // Object identity, not value equality: a re-forked local copy of a rule
  // (the regression this catalog exists to prevent) is value-equal but not
  // the same object, so === is what actually detects forking.
  for (const id of KO_INTERFERENCE_RULE_IDS) {
    const consumerRule = TRANSLATIONESE_RULES.find((rule) => rule.id === id);
    assert.ok(consumerRule, `translationese is missing catalog rule ${id}`);
    assert.equal(
      consumerRule,
      getKoInterferenceRule(id),
      `translationese rule ${id} must be the catalog object itself, not a copy`,
    );
  }

  // Stylometry consumes the catalog through buildKoInterferenceRegex(id) calls;
  // pin each call site in the source so an inline re-fork of a counter fails here.
  const stylometrySource = readFileSync(resolve(REPO_ROOT, 'src/features/stylometry.js'), 'utf8');
  for (const id of KO_POST_EDITESE_INTERFERENCE_RULE_IDS) {
    assert.ok(KO_INTERFERENCE_RULE_IDS.includes(id), `${id} must come from the shared catalog`);
    assert.ok(
      stylometrySource.includes(`buildKoInterferenceRegex('${id}')`),
      `stylometry must build its ${id} counter from the catalog`,
    );
  }

  // No consumer may carry a verbatim copy of a catalog regex body — the
  // pattern text must exist only in catalog/ko-interference.js.
  const translationeseSource = readFileSync(resolve(REPO_ROOT, 'src/features/translationese.js'), 'utf8');
  for (const rule of KO_INTERFERENCE_TRANSLATIONESE_RULES) {
    const body = rule.re().source;
    for (const [name, source] of [['stylometry.js', stylometrySource], ['translationese.js', translationeseSource]]) {
      assert.ok(
        !source.includes(body),
        `${name} carries a verbatim copy of the ${rule.id} regex; it must live only in the catalog`,
      );
    }
  }
});
test('ko translationese detects im-not-ai derived advisory rules', () => {
  const text = [
    '메리는 그녀가 그녀의 어머니에게 전화했다고 말했다.',
    '회의에서의 결정은 앞으로의 운영으로의 전환을 앞당겼다.',
    '우리는 회의를 가졌고 중요한 결정을 내렸다.',
    '이 작업은 에이전트에 의해 처리되었다.',
    '이 문제는 분석되어진 뒤 보고서에 쓰여진다.',
    '그는 자료를 검토하고, 결과를 정리하며, 보고서를 작성했다.',
  ].join(' ');
  const r = detectTranslationese(text, { lang: 'ko' });
  const ids = r.byRule.map((x) => x.id);

  assert.ok(ids.includes('a16-pronoun-literal'), 'A-16 pronoun literal mapping');
  assert.ok(ids.includes('a19-double-particle'), 'A-19 double particles');
  assert.ok(ids.includes('a7-light-verb'), 'A-7 light verbs');
  assert.ok(ids.includes('t2-by-passive'), 'T2 by-passive co-occurrence');
  assert.ok(ids.includes('a8-double-passive'), 'A-8 double passive');
  assert.ok(ids.includes('c11-connective-comma'), 'C-11 connective-ending comma');
  assert.equal(r.hot, true);
});

test('ko translationese caveats keep common formal Korean below stronger rules', () => {
  const text = '한국의 미래는 밝다. 그의 의견은 다르다. 위원회에 의해 회의가 열렸다.';
  const r = detectTranslationese(text, { lang: 'ko' });
  const ids = r.byRule.map((x) => x.id);

  assert.equal(ids.includes('a19-double-particle'), false, 'bare 의 is not a double particle');
  assert.equal(ids.includes('t2-by-passive'), false, 'bare 에 의해 without passive co-occurrence is not the strong rule');
  assert.equal(ids.includes('passive-e-uihae'), true, 'bare 에 의해 remains a weak advisory hit');
  assert.equal(r.hot, false);
});

test('ko shared by-passive catalog accepts 의해 and 의하여 spellings', () => {
  const texts = [
    '이 작업은 에이전트에 의해 처리되었다.',
    '이 보고서는 검토자에 의하여 작성되었다.',
    // The \s* dimension: spacing variants must keep matching on both consumers
    // (the catalog adopted stylometry's /에\s*의(?:해|하여)/ superset — a future
    // edit must not silently narrow it back to single-space 에 의해).
    '이 작업은 에이전트에  의해 처리되었다.',
    '이 작업은 에이전트에의해 처리되었다.',
  ];

  for (const text of texts) {
    const translationese = detectTranslationese(text, { lang: 'ko' });
    const ids = translationese.byRule.map((rule) => rule.id);

    assert.ok(ids.includes('passive-e-uihae'), `${text} should hit the weak by-passive rule`);
    assert.ok(ids.includes('t2-by-passive'), `${text} should hit the strong by-passive co-occurrence rule`);
    assert.equal(koreanPostEditeseFeatures(text, { lang: 'ko' }).metrics.interference.byPassiveCount, 1);
  }
});

test('ko pronoun literal rules ignore nouns ending in 그 and bound words', () => {
  const techText = '모든 로그는 남는다. 버그가 있으면 태그도 같이 적는다. 블로그를 고쳤고 플래그를 내렸다.';
  const colloquialText = '그녀석이 또 늦었다. 아 그것참 곤란하네. 그들먹은 상황이라고 했다.';

  const tech = detectTranslationese(techText, { lang: 'ko' });
  const colloquial = detectTranslationese(colloquialText, { lang: 'ko' });
  assert.equal(tech.byRule.some((row) => row.id === 'a16-pronoun-literal'), false);
  assert.equal(colloquial.byRule.some((row) => row.id === 'a16-pronoun-literal'), false);

  assert.equal(koreanPostEditeseFeatures(techText, { lang: 'ko' }).metrics.interference.pronounLiteralCount, 0);
  assert.equal(koreanPostEditeseFeatures(colloquialText, { lang: 'ko' }).metrics.interference.pronounLiteralCount, 0);
});

test('ko post-editese pronoun literal keeps stacked-particle calques (issue #395)', () => {
  const pronounLiteralCount = (text) =>
    koreanPostEditeseFeatures(text, { lang: 'ko' }).metrics.interference.pronounLiteralCount;

  const stackedForms = ['그들에게는', '그녀에게도', '그들과의', '그것도', '그것만', '그들처럼', '그녀보다'];
  for (const form of stackedForms) {
    const count = pronounLiteralCount(`${form} 결과가 전달되었다.`);
    assert.ok(count >= 1, `${form} should count as a pronoun literal (got ${count})`);
  }

  // U+2026 ellipsis directly after the particle is an eojeol boundary too.
  assert.ok(pronounLiteralCount('그녀는… 아무 말이 없었다.') >= 1, 'ellipsis boundary after particle');

  // Simple single-particle forms keep matching before space or sentence punctuation.
  assert.equal(pronounLiteralCount('그는 떠났다. 그녀는 남았다. 그것은 사실이다. 그들은 침묵했다.'), 4);
  assert.equal(pronounLiteralCount('그는, 결국 돌아왔다.'), 1);
});

test('ko translationese pronoun literal catches stacked-particle calques from shared a16 catalog', () => {
  const stackedForms = ['그들에게는', '그녀에게도', '그들과의', '그것도', '그것만', '그들처럼', '그녀보다'];
  const text = stackedForms.map((form) => `${form} 결과가 전달되었다.`).join(' ');
  const r = detectTranslationese(text, { lang: 'ko' });
  const row = r.byRule.find((rule) => rule.id === 'a16-pronoun-literal');

  assert.ok(row, 'a16-pronoun-literal should fire');
  assert.equal(row.count, stackedForms.length);
  for (const form of stackedForms) {
    assert.ok(r.hits.includes(form), `${form} should be reported as an a16 hit`);
  }
});

test('direct-address-you respects Hangul boundaries (#442)', () => {
  const rule = TRANSLATIONESE_RULES.find((r) => r.id === 'direct-address-you');
  const countYou = (text) => (text.match(rule.re()) || []).length;
  // 당신 inside unspaced compounds must not match.
  assert.equal(countYou('해당신청을 처리했다.'), 0);
  assert.equal(countYou('사당신축 공사가 끝났다.'), 0);
  // Genuine second-person 당신 still matches.
  assert.equal(countYou('당신은 이것을 설정할 수 있습니다.'), 1);
  assert.equal(countYou('당신의 의견을 존중한다.'), 1);
});

test('c11-connective-comma skips common 고-final nouns (#442)', () => {
  const count = (text) =>
    (text.match(getKoInterferenceRule('c11-connective-comma').re()) || []).length;
  // Plain noun lists ending in 고 are no longer counted as connective evidence.
  assert.equal(count('참고, 광고, 경고, 공고, 원고, 최고, 중고, 창고, 재고, 충고, 권고,'), 0);
  // Real connective endings before a comma still match (verb stem 하고, etc.).
  assert.ok(count('검토하고, 정리하며, 마쳤다.') >= 2);
});

test('ko post-editese pronoun literal still excludes bound nouns and word-internal 그', () => {
  const pronounLiteralCount = (text) =>
    koreanPostEditeseFeatures(text, { lang: 'ko' }).metrics.interference.pronounLiteralCount;

  assert.equal(pronounLiteralCount('그녀석이 또 늦었다. 아 그것참 곤란하네.'), 0);
  assert.equal(pronounLiteralCount('블로그는 어제 고쳤다. 태그를 새로 달았다.'), 0);
  assert.equal(pronounLiteralCount('그라데이션은 배경에 넣었다.'), 0, 'word-internal 그 must not match via the bare-그 branch');
  assert.equal(pronounLiteralCount('그 사람이 그 다음에 왔다.'), 0, 'determiner 그 without a particle must not match');
});

test('ko post-editese pronoun literal restores pre-#394 count on MT-style paragraph', () => {
  const text = [
    '그들에게는 선택지가 없었다.',
    '그녀에게도 같은 통지가 갔다.',
    '그들과의 협상은 결렬되었다.',
    '그것도 모자라 그것만 반복했다.',
    '그들처럼 행동했고 그녀보다 빨랐다.',
  ].join(' ');
  const payload = koreanPostEditeseFeatures(text, { lang: 'ko' });
  assert.equal(payload.metrics.interference.pronounLiteralCount, 7);
});
test('weak-only translationese stays advisory even above count and density gates', () => {
  const text = [
    '사용법은 다음과 같습니다.',
    '다양한 기능을 제공합니다.',
    '설치를 쉽게 만들어 줍니다.',
    '가장 빠른 도구 중 하나입니다.',
  ].join(' ');
  const r = detectTranslationese(text, { lang: 'ko' });
  const ids = r.byRule.map((x) => x.id).sort();

  assert.deepEqual(ids, ['as-follows', 'make-easy', 'one-of', 'provides'].sort());
  assert.equal(r.count, 4);
  assert.ok(r.density >= r.thresholds.density, `density ${r.density}`);
  assert.equal(r.thresholds.strong, 1);
  assert.equal(r.hot, false);
});

test('overlapping translationese rules count independent evidence spans for the hot gate', () => {
  const text = [
    '그것은 중요하다.',
    '그것은 필요하다.',
    '이 작업은 에이전트에 의해 처리되었다.',
  ].join(' ');
  const r = detectTranslationese(text, { lang: 'ko' });
  const ids = r.byRule.map((x) => x.id);

  assert.ok(ids.includes('dummy-subject'), 'dummy-subject raw rule remains visible');
  assert.ok(ids.includes('a16-pronoun-literal'), 'overlapping A-16 raw rule remains visible');
  assert.ok(ids.includes('passive-e-uihae'), 'weak passive raw rule remains visible');
  assert.ok(ids.includes('t2-by-passive'), 'overlapping strong T2 raw rule remains visible');
  assert.equal(r.count, 3);
  assert.equal(r.hot, false);
});

test('hot ko translationese remains advisory and outside the document hot verdict', () => {
  const text = '메리는 그녀가 그녀의 책을 갖고 있다. 회의에서의 결정으로의 이동은 에이전트에 의해 처리되었다.';
  const r = analyzeText(text, { lang: 'ko' });

  assert.equal(r.translationese.hot, true);
  assert.equal(
    r.hot,
    r.markupLeakage.leaked || r.structuralClassifier.hot === true || r.paragraphs.some((p) => p.hot),
  );
  assert.equal(r.hot, false);
});

test('analyzeText surfaces translationese as an advisory signal', () => {
  const text =
    '당신은 이 도구를 사용할 수 있습니다. 그것은 다양한 기능을 제공합니다.\n\n' +
    '이 작업은 에이전트에 의해 처리됩니다. 사용법은 다음과 같습니다.\n\n' +
    '설치는 한 줄로 끝납니다. 전역 설치는 필요 없습니다.';
  const r = analyzeText(text, { lang: 'ko' });
  assert.ok(r.translationese, 'translationese field present');
  assert.equal(r.translationese.hot, true);
  assert.ok(Array.isArray(r.translationese.byRule));
});

test('analyzeText keeps translationese OUT of the hot verdict (advisory only)', () => {
  // Clean, structurally-human ko prose with a couple of calques but below the
  // gate: translationese must not be hot, and must not be in the hot formula.
  const text =
    '어제는 비가 많이 왔다. 그래서 그냥 집에 있었다.\n\n' +
    '라면을 끓여 먹고 영화를 한 편 봤다. 꽤 괜찮았다.\n\n' +
    '저녁엔 동네를 좀 걸었다. 바람이 시원했다.';
  const r = analyzeText(text, { lang: 'ko' });
  assert.equal(r.translationese.hot, false);
  // hot is driven only by leakage / structural classifier / per-paragraph
  // signals (discourse tells reach it through paragraph attribution, #391)
  assert.equal(
    r.hot,
    r.markupLeakage.leaked || r.structuralClassifier.hot === true || r.paragraphs.some((p) => p.hot),
  );
});
const FORBIDDEN_KO_POST_EDITESE_KEYS = new Set([
  'hot',
  'severity',
  'score',
  'zScore',
  'zscore',
  'baseline',
  'percentile',
]);

function collectObjectKeys(value, keys = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectObjectKeys(item, keys);
    return keys;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.push(key);
      collectObjectKeys(child, keys);
    }
  }
  return keys;
}

test('ko post-editese exposes the v1 raw descriptive schema', () => {
  const text = [
    '그녀는 회의에서의 결정을 검토하고 있다.',
    '이 작업은 에이전트에 의해 처리되어진다.',
    '',
    '우리는 회의를 가졌고, 결정을 내렸다.',
    '그것은 중요한 자료이다.',
  ].join('\n');
  const payload = koreanPostEditeseFeatures(text, { lang: 'ko' });

  assert.equal(payload.schema, KO_POST_EDITESE_SCHEMA);
  assert.equal(payload.schema, 'koPostEditese.v1');
  assert.equal(payload.lang, 'ko');
  assert.equal(payload.analyzed, true);
  assert.equal(payload.skipReason, null);
  assert.equal(payload.paragraphCount, 2);
  assert.equal(payload.paragraphs.length, 2);
  assert.ok(payload.sentenceCount >= 4);
  assert.ok(payload.eojeolCount > 0);
  const paragraphSentenceTotal = payload.paragraphs.reduce((sum, row) => sum + row.sentenceCount, 0);
  const paragraphEojeolTotal = payload.paragraphs.reduce((sum, row) => sum + row.eojeolCount, 0);
  assert.equal(payload.sentenceCount, paragraphSentenceTotal);
  assert.equal(payload.eojeolCount, paragraphEojeolTotal);
  assert.deepEqual(Object.keys(payload).sort(), [
    'analyzed',
    'eojeolCount',
    'lang',
    'metrics',
    'paragraphCount',
    'paragraphs',
    'schema',
    'sentenceCount',
    'skipReason',
  ].sort());
  for (const row of payload.paragraphs) {
    assert.deepEqual(Object.keys(row).sort(), ['eojeolCount', 'id', 'metrics', 'sentenceCount'].sort());
    assert.deepEqual(Object.keys(row.metrics).sort(), ['endings', 'interference', 'lexical', 'rhythm'].sort());
    assert.deepEqual(Object.keys(row.metrics.lexical).sort(), Object.keys(payload.metrics.lexical).sort());
    assert.deepEqual(Object.keys(row.metrics.endings).sort(), Object.keys(payload.metrics.endings).sort());
    assert.deepEqual(Object.keys(row.metrics.interference).sort(), Object.keys(payload.metrics.interference).sort());
    assert.deepEqual(Object.keys(row.metrics.rhythm).sort(), Object.keys(payload.metrics.rhythm).sort());
  }


  assert.deepEqual(Object.keys(payload.metrics).sort(), ['endings', 'interference', 'lexical', 'rhythm'].sort());
  assert.deepEqual(Object.keys(payload.metrics.lexical).sort(), [
    'endingDiversity',
    'endingTypeCount',
    'mattr',
    'tokenCount',
    'ttr',
    'typeCount',
  ].sort());
  assert.deepEqual(Object.keys(payload.metrics.endings).sort(), [
    'declarativeDaCount',
    'declarativeDaRatio',
    'doendaCount',
    'endingStreakMax',
    'formalEndingCount',
    'handaCount',
    'idaCount',
    'politeEndingCount',
  ].sort());
  assert.deepEqual(Object.keys(payload.metrics.interference).sort(), [
    'byPassiveCount',
    'connectiveCommaCount',
    'doubleParticleCount',
    'doublePassiveCount',
    'lightVerbCount',
    'progressiveAspectCount',
    'pronounLiteralCount',
    'relativeClauseProxyCount',
  ].sort());
  assert.deepEqual(Object.keys(payload.metrics.rhythm).sort(), [
    'commaPer100Chars',
    'commaPerSentence',
    'eojeolLengthCV',
    'meanEojeolLength',
    'meanSentenceEojeols',
    'sentenceEojeolCV',
    'suffixClassDiversity',
    'suffixDiversity',
    'suffixMatchedCount',
  ].sort());

  assert.ok(payload.metrics.interference.pronounLiteralCount >= 2);
  assert.ok(payload.metrics.interference.doubleParticleCount >= 1);
  assert.ok(payload.metrics.interference.progressiveAspectCount >= 1);
  assert.ok(payload.metrics.interference.byPassiveCount >= 1);
  assert.ok(payload.metrics.interference.doublePassiveCount >= 1);
  assert.ok(payload.metrics.interference.connectiveCommaCount >= 1);
  assert.ok(payload.metrics.endings.idaCount >= 1);
  assert.ok(payload.metrics.rhythm.suffixMatchedCount > 0);
});

test('ko post-editese skipped payloads are stable and zero-valued', () => {
  const nonKo = koreanPostEditeseFeatures('This is plain English.', { lang: 'en' });
  const empty = koreanPostEditeseFeatures('   ', { lang: 'ko' });
  const punctuation = koreanPostEditeseFeatures('... !!!', { lang: 'ko' });
  const mixedNonKo = koreanPostEditeseFeatures('This English-labeled text mentions 그녀 and 그것.', { lang: 'en' });


  for (const [payload, reason] of [
    [nonKo, 'non-ko'],
    [empty, 'empty'],
    [punctuation, 'no-hangul-eojeols'],
    [mixedNonKo, 'non-ko'],
  ]) {
    assert.equal(payload.schema, 'koPostEditese.v1');
    assert.equal(payload.analyzed, false);
    assert.equal(payload.skipReason, reason);
    assert.equal(payload.paragraphCount, 0);
    assert.equal(payload.sentenceCount, 0);
    assert.equal(payload.eojeolCount, 0);
    assert.deepEqual(payload.paragraphs, []);
    assert.equal(payload.metrics.lexical.tokenCount, 0);
    assert.equal(payload.metrics.lexical.ttr, null);
    assert.equal(payload.metrics.endings.declarativeDaRatio, null);
    assert.equal(payload.metrics.rhythm.sentenceEojeolCV, null);
    assert.equal(payload.metrics.rhythm.suffixMatchedCount, 0);
  }
});

test('analyzeText surfaces ko post-editese without hot coupling or forbidden keys', () => {
  const text = '그녀는 회의에서의 결정을 검토하고 있다. 이 작업은 에이전트에 의해 처리되어진다.';
  const analysis = analyzeText(text, { lang: 'ko' });
  const expectedHot = analysis.markupLeakage.leaked ||
    analysis.structuralClassifier.hot === true ||
    analysis.paragraphs.some((p) => p.hot);

  assert.equal(analysis.koPostEditese.schema, 'koPostEditese.v1');
  assert.equal(analysis.koPostEditese.analyzed, true);
  assert.ok(analysis.koPostEditese.metrics.interference.pronounLiteralCount >= 1);
  assert.equal(analysis.hot, expectedHot);

  const keys = collectObjectKeys(analysis.koPostEditese);
  assert.deepEqual(keys.filter((key) => FORBIDDEN_KO_POST_EDITESE_KEYS.has(key)), []);
});

test('analyzeText returns skipped ko post-editese for non-ko without changing verdicts', () => {
  const analysis = analyzeText('A short plain English note.', { lang: 'en' });
  assert.equal(analysis.koPostEditese.schema, 'koPostEditese.v1');
  assert.equal(analysis.koPostEditese.analyzed, false);
  assert.equal(analysis.koPostEditese.skipReason, 'non-ko');
  assert.equal(
    analysis.hot,
    analysis.markupLeakage.leaked ||
      analysis.structuralClassifier.hot === true ||
      analysis.paragraphs.some((p) => p.hot),
  );
});
