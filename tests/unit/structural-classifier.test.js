import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  STRUCTURAL_FEATURE_NAMES,
  analyzeText,
  extractStructuralFeatures,
  structuralFeatureRecord,
  structuralModelVerdict,
  trainLogReg,
  predictStructuralScore,
} from '../../src/features/index.js';

function constantModel({ bias = 10, threshold = 0.5, lang = 'ko' } = {}) {
  return {
    lang,
    weights: new Array(STRUCTURAL_FEATURE_NAMES.length).fill(0),
    bias,
    threshold,
    scaler: {
      mu: new Array(STRUCTURAL_FEATURE_NAMES.length).fill(0),
      sigma: new Array(STRUCTURAL_FEATURE_NAMES.length).fill(1),
    },
    featureNames: STRUCTURAL_FEATURE_NAMES,
  };
}

test('extractStructuralFeatures returns a stable named vector', () => {
  const vector = extractStructuralFeatures('첫 문장입니다. 두 번째 문장은 조금 더 깁니다.', { lang: 'ko' });
  assert.equal(vector.length, STRUCTURAL_FEATURE_NAMES.length);
  assert.ok(vector.every(Number.isFinite));

  const record = structuralFeatureRecord(vector);
  assert.deepEqual(Object.keys(record), [...STRUCTURAL_FEATURE_NAMES]);
  assert.ok(record.mean_sent_len > 0);
  assert.ok(record.ttr > 0);
});

test('structuralModelVerdict is explicitly unavailable without supplied weights', () => {
  const verdict = structuralModelVerdict('오늘은 날씨가 좋았다. 점심을 먹었다.', { lang: 'ko' });
  assert.deepEqual(verdict, { available: false, hot: null, score: null });

  const analysis = analyzeText('오늘은 날씨가 좋았다. 점심을 먹었다.', { lang: 'ko' });
  assert.deepEqual(analysis.structuralClassifier, { available: false, hot: null, score: null });
  assert.equal(
    analysis.hot,
    analysis.markupLeakage.leaked ||
      analysis.structuralClassifier.hot === true ||
      analysis.paragraphs.some((p) => p.hot),
  );
});

test('analyzeText can opt into a supplied structural model as a document-level OR signal', () => {
  const text = '오늘은 날씨가 좋았다. 점심을 먹었다.';
  const baseline = analyzeText(text, { lang: 'ko' });
  assert.equal(baseline.hot, false);

  const modeled = analyzeText(text, { lang: 'ko', structuralModel: constantModel() });
  assert.equal(modeled.structuralClassifier.available, true);
  assert.equal(modeled.structuralClassifier.hot, true);
  assert.ok(modeled.structuralClassifier.score > 0.99);
  assert.equal(modeled.hot, true);
});

test('structural model refuses the wrong language instead of scoring silently', () => {
  const verdict = structuralModelVerdict('Plain English text.', {
    lang: 'en',
    model: constantModel({ lang: 'ko' }),
  });
  assert.deepEqual(verdict, { available: false, hot: null, score: null });
});

test('logistic helper trains and scores a simple separable toy model', () => {
  const X = [[0], [0.1], [1], [1.1]];
  const y = [0, 0, 1, 1];
  const model = trainLogReg(X, y, { lr: 0.2, epochs: 400, l2: 0 });

  assert.ok(predictStructuralScore(model, [0]) < 0.5);
  assert.ok(predictStructuralScore(model, [1.1]) > 0.5);
});
