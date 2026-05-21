import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { analyzeText } from '../../src/features/index.js';
import {
  commaDensity,
  koreanPosDiversityProxy,
  koreanSpacingFeatures,
} from '../../src/features/stylometry.js';

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

test('analyzeText attaches Korean diagnostic signals without making them hot signals yet', () => {
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

  assert.equal(en.paragraphs[0].spacing, undefined);
  assert.equal(en.paragraphs[0].comma, undefined);
  assert.equal(en.paragraphs[0].posDiversity, undefined);
});
