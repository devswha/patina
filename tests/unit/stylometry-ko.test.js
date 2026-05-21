import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { analyzeText } from '../../src/features/index.js';
import {
  classifyKoreanDiagnostics,
  commaDensity,
  koreanPosDiversityProxy,
  koreanSpacingFeatures,
} from '../../src/features/stylometry.js';

const KO_COMPOSITE_TEXT =
  '아침 회의는 기록을 확인합니다. 담당자는 오늘 진행할 항목을 차례대로 검토합니다. ' +
  '화면은 변경된 값을 보여주고 팀은 같은 절차를 다시 확인합니다. 마지막으로 결과는 공유합니다.';

test('koreanSpacingFeatures reports dependency-free eojeol length regularity', () => {
  const spacing = koreanSpacingFeatures('이 도구는 결과를 보여준다. 이 도구는 문장을 다듬는다.');

  assert.equal(spacing.eojeolCount, 8);
  assert.equal(spacing.meanEojeolLength, 2.75);
  assert.equal(spacing.singleSyllableRatio, 0.25);
  assert.equal(spacing.longEojeolRatio, 0);
  assert.ok(spacing.eojeolLengthCV > 0);
});

test('commaDensity reports Korean comma use per sentence and per 100 chars', () => {
  const comma = commaDensity('첫째, 이 도구는 기록한다. 둘째, 결과를 보여준다.', 2);

  assert.equal(comma.count, 2);
  assert.equal(comma.perSentence, 1);
  assert.ok(comma.per100Chars > 0);
});

test('koreanPosDiversityProxy uses suffix classes without a morphology dependency', () => {
  const proxy = koreanPosDiversityProxy(
    '이 도구는 결과를 사용자에게 제공합니다. 문장은 자연스럽고 의미를 보존합니다.'
  );

  assert.equal(proxy.proxy, 'suffix');
  assert.equal(proxy.eojeolCount, 9);
  assert.equal(proxy.matchedCount, 7);
  assert.equal(proxy.distinctClassCount, 4);
  assert.equal(proxy.classDiversity, 4 / 7);
  assert.deepEqual(proxy.classes, ['formal_ending', 'location', 'object', 'topic']);
});

test('classifyKoreanDiagnostics requires the conservative three-signal composite', () => {
  const spacing = koreanSpacingFeatures(KO_COMPOSITE_TEXT);
  const comma = commaDensity(KO_COMPOSITE_TEXT, 4);
  const posDiversity = koreanPosDiversityProxy(KO_COMPOSITE_TEXT);

  const hot = classifyKoreanDiagnostics({ sentenceCount: 4, spacing, comma, posDiversity });
  assert.equal(hot.hot, true);
  assert.ok(hot.strength > 0);
  assert.deepEqual(hot.reasons, [
    'regular-eojeol-length',
    'low-comma-density',
    'low-suffix-class-diversity',
  ]);

  const commaOnly = classifyKoreanDiagnostics({
    sentenceCount: 4,
    spacing: { ...spacing, eojeolLengthCV: 0.55 },
    comma,
    posDiversity,
  });
  assert.equal(commaOnly.hot, false);
});

test('analyzeText attaches Korean diagnostics and only hot-classifies the calibrated composite', () => {
  const text = '이 문장은 테스트를 위한 짧은 예시입니다. 쉼표는 없고 의미는 단순합니다.';
  const ko = analyzeText(text, { lang: 'ko' });
  const en = analyzeText(text, { lang: 'en' });

  assert.equal(ko.paragraphs[0].sentenceCount, 2);
  assert.equal(ko.paragraphs[0].burstiness.band, null);
  assert.equal(ko.paragraphs[0].hot, false);
  assert.equal(ko.hot, false);
  assert.equal(typeof ko.paragraphs[0].spacing.eojeolLengthCV, 'number');
  assert.equal(ko.paragraphs[0].comma.count, 0);
  assert.equal(ko.paragraphs[0].posDiversity.proxy, 'suffix');
  assert.equal(ko.paragraphs[0].koDiagnostics.hot, false);

  const composite = analyzeText(
    KO_COMPOSITE_TEXT,
    { lang: 'ko' }
  );
  assert.equal(composite.paragraphs[0].burstiness.band, 'mid');
  assert.equal(composite.paragraphs[0].mattr.band, 'high');
  assert.equal(composite.paragraphs[0].lexicon.hot, false);
  assert.equal(composite.paragraphs[0].koDiagnostics.hot, true);
  assert.equal(composite.paragraphs[0].hot, true);

  const disabled = analyzeText(
    KO_COMPOSITE_TEXT,
    { lang: 'ko', koDiagnosticsEnabled: false }
  );
  assert.equal(disabled.paragraphs[0].koDiagnostics.hot, false);
  assert.equal(disabled.paragraphs[0].hot, false);

  assert.equal(en.paragraphs[0].spacing, undefined);
  assert.equal(en.paragraphs[0].comma, undefined);
  assert.equal(en.paragraphs[0].posDiversity, undefined);
});
