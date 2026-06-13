import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  STRUCTURAL_FEATURE_NAMES,
  analyzeText,
  extractStructuralFeatures,
  structuralFeatureRecord,
  structuralModelVerdict,
  normalizeStructuralModel,
  trainLogReg,
  predictStructuralScore,
  thresholdForMaxFpr,
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
  // Rows use the real feature width: predictStructuralScore normalizes the
  // model, and normalizeStructuralModel rejects any other dimension (#436).
  const row = (v) => [v, ...new Array(STRUCTURAL_FEATURE_NAMES.length - 1).fill(0)];
  const X = [row(0), row(0.1), row(1), row(1.1)];
  const y = [0, 0, 1, 1];
  const model = trainLogReg(X, y, { lr: 0.2, epochs: 400, l2: 0 });

  assert.deepEqual(model.featureNames, STRUCTURAL_FEATURE_NAMES);
  assert.ok(predictStructuralScore(model, row(0)) < 0.5);
  assert.ok(predictStructuralScore(model, row(1.1)) > 0.5);
});

test('trainLogReg does not stamp featureNames onto models of another width (#436)', () => {
  const model = trainLogReg([[0], [1]], [0, 1], { lr: 0.2, epochs: 50, l2: 0 });
  assert.equal('featureNames' in model, false);
});

test('normalizeStructuralModel rejects models not trained at this feature width (#436)', () => {
  // Self-consistent (weights match scaler) but 8-wide and without the
  // optional featureNames field — the exact shape of a stale model trained
  // against an older feature set. Must fail at load time, not at predict
  // time inside analyzeText.
  const stale = {
    lang: 'ko',
    weights: new Array(8).fill(0.5),
    bias: 0,
    threshold: 0.5,
    scaler: { mu: new Array(8).fill(0), sigma: new Array(8).fill(1) },
  };
  assert.throws(
    () => normalizeStructuralModel(stale),
    /expects 8 features but this patina version extracts 12/,
  );
  assert.throws(
    () => structuralModelVerdict('오늘은 날씨가 좋았다. 점심을 먹었다.', { lang: 'ko', model: stale }),
    /expects 8 features/,
  );
});

test('normalizeStructuralModel rejects non-positive sigma (#443)', () => {
  const zero = constantModel();
  zero.scaler.sigma = new Array(STRUCTURAL_FEATURE_NAMES.length).fill(1);
  zero.scaler.sigma[0] = 0;
  assert.throws(() => normalizeStructuralModel(zero), /sigma values must be positive/);
  const negative = constantModel();
  negative.scaler.sigma = new Array(STRUCTURAL_FEATURE_NAMES.length).fill(1);
  negative.scaler.sigma[0] = -2;
  assert.throws(() => normalizeStructuralModel(negative), /sigma values must be positive/);
});

test('structuralModelVerdict treats a truthy non-object model as unavailable (#443)', () => {
  assert.deepEqual(
    structuralModelVerdict('오늘은 날씨가 좋았다. 점심을 먹었다.', { lang: 'ko', model: 'not-a-model' }),
    { available: false, hot: null, score: null },
  );
});

test('thresholdForMaxFpr keeps the realized FPR within maxFpr (ceil, #443)', () => {
  const feat0 = (v) => [v, ...new Array(STRUCTURAL_FEATURE_NAMES.length - 1).fill(0)];
  const model = {
    lang: 'ko',
    weights: [1, ...new Array(STRUCTURAL_FEATURE_NAMES.length - 1).fill(0)],
    bias: 0,
    threshold: 0.5,
    scaler: {
      mu: new Array(STRUCTURAL_FEATURE_NAMES.length).fill(0),
      sigma: new Array(STRUCTURAL_FEATURE_NAMES.length).fill(1),
    },
    featureNames: STRUCTURAL_FEATURE_NAMES,
  };
  // 15 negatives with strictly increasing scores (the finding's worked case
  // where floor() let realized FPR reach 13.3% > 10%).
  const X = [];
  const y = [];
  for (let v = -7; v <= 7; v++) { X.push(feat0(v)); y.push(0); }
  const threshold = thresholdForMaxFpr(model, X, y, 0.1);
  const flagged = X.filter((row) => predictStructuralScore(model, row) >= threshold).length;
  assert.ok(flagged / X.length <= 0.1, `realized FPR ${flagged}/${X.length} exceeds 0.1`);
});
