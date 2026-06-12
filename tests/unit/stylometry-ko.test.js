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

// --- detectKoreanRegister (document-brief stage) ---

test('detectKoreanRegister identifies the dominant register per ending class', async () => {
  const { detectKoreanRegister } = await import('../../src/features/stylometry.js');

  const formal = detectKoreanRegister('주제만 주면 한 세트가 나옵니다. 직접 디자인할 필요가 없습니다. 캐러셀을 완성합니다. 바로 시작합니까?');
  assert.equal(formal.register, 'formal');
  assert.equal(formal.label, '합쇼체(-습니다)');

  // High-recall polite endings: -세요/-나요/-죠 count, not just -어요/-네요.
  const polite = detectKoreanRegister('막막하게 느껴지셨나요? 주제만 알려주세요. 한 세트가 뚝딱 나와요. 비용도 필요 없죠.');
  assert.equal(polite.register, 'polite');
  assert.equal(polite.shares.polite, 1);

  const plain = detectKoreanRegister('이 글은 평서체로 쓴다. 어미가 다로 끝난다. 그래서 평서체이다. 자연스럽게 이어진다.');
  assert.equal(plain.register, 'plain');
});

test('detectKoreanRegister reports mixed registers and refuses thin samples', async () => {
  const { detectKoreanRegister } = await import('../../src/features/stylometry.js');

  const mixed = detectKoreanRegister('어떤 글은 해요체예요. 다른 문장은 평서체다. 또 어떤 건 합니다. 이렇게 섞이면 어색해요. 그렇지만 다양하다. 혼합이다.');
  assert.equal(mixed.register, 'mixed');
  assert.equal(mixed.label, '혼합');
  assert.equal(mixed.classified, 6);

  // Fewer than three classified endings is noise, not a register.
  assert.equal(detectKoreanRegister('짧다.'), null);
  assert.equal(detectKoreanRegister('Hello world. This is English text only.'), null);
});
