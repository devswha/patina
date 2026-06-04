import { strict as assert } from 'node:assert';
import test from 'node:test';

import { detectTranslationese, TRANSLATIONESE_RULES } from '../../src/features/translationese.js';
import { analyzeText } from '../../src/features/index.js';

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
  // hot is driven only by leakage / discourse / paragraph stylometry
  assert.equal(r.hot, r.markupLeakage.leaked || r.discourseTells.hot || r.paragraphs.some((p) => p.hot));
});
