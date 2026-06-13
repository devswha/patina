import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  lengthBucket,
  sliceMetric,
  summarizeSlices,
  DEFAULT_MIN_SLICE_COUNT,
  UNSPECIFIED,
  SLICE_DIMENSIONS,
} from '../quality/slice-metrics.mjs';

test('lengthBucket maps documented code-point thresholds deterministically', () => {
  assert.equal(lengthBucket(0), 'empty');
  assert.equal(lengthBucket(-5), 'empty');
  assert.equal(lengthBucket(1), 'short');
  assert.equal(lengthBucket(400), 'short');
  assert.equal(lengthBucket(401), 'medium');
  assert.equal(lengthBucket(1200), 'medium');
  assert.equal(lengthBucket(1201), 'long');
  assert.equal(lengthBucket(Number.NaN), 'empty');
});

test('sliceMetric reports an insufficient-data state below minCount but keeps counts', () => {
  const records = [
    { predicted_hot: true, expected_hot: true },
    { predicted_hot: false, expected_hot: false },
  ];
  const m = sliceMetric(records, DEFAULT_MIN_SLICE_COUNT);
  assert.equal(m.n, 2);
  assert.equal(m.tp, 1);
  assert.equal(m.tn, 1);
  assert.equal(m.supported, false);
  assert.equal(m.reason, 'insufficient_data');
  assert.equal(m.accuracy, null);
  assert.equal(m.precision, null);
  assert.equal(m.recall, null);
  assert.equal(m.f1, null);
});

test('sliceMetric computes confusion metrics at or above minCount', () => {
  // 3 AI flagged (tp), 2 natural not flagged (tn) -> perfect.
  const records = [
    { predicted_hot: true, expected_hot: true },
    { predicted_hot: true, expected_hot: true },
    { predicted_hot: true, expected_hot: true },
    { predicted_hot: false, expected_hot: false },
    { predicted_hot: false, expected_hot: false },
  ];
  const m = sliceMetric(records, 5);
  assert.equal(m.supported, true);
  assert.equal(m.reason, null);
  assert.equal(m.n, 5);
  assert.equal(m.accuracy, 1);
  assert.equal(m.precision, 1);
  assert.equal(m.recall, 1);
  assert.equal(m.f1, 1);

  // One false negative drops recall but not precision.
  const withMiss = sliceMetric([...records, { predicted_hot: false, expected_hot: true }], 5);
  assert.equal(withMiss.n, 6);
  assert.equal(withMiss.fn, 1);
  assert.equal(withMiss.precision, 1);
  assert.equal(withMiss.recall, 0.75);
});

test('summarizeSlices groups every dimension, defaults missing metadata to unspecified, and is deterministic', () => {
  const records = [
    { language: 'ko', class: 'ai', lengthBucket: 'short', predicted_hot: true, expected_hot: true },
    { language: 'ko', class: 'natural', lengthBucket: 'short', predicted_hot: false, expected_hot: false },
    { language: 'en', class: 'ai', lengthBucket: 'medium', domain: 'news', predicted_hot: true, expected_hot: true },
  ];
  const slices = summarizeSlices(records, { minCount: 2 });
  // Every dimension present in stable order.
  assert.deepEqual(Object.keys(slices), [...SLICE_DIMENSIONS]);
  // language: ko has 2 (supported at minCount 2), en has 1 (insufficient).
  assert.equal(slices.language.values.ko.n, 2);
  assert.equal(slices.language.values.ko.supported, true);
  assert.equal(slices.language.values.en.supported, false);
  assert.equal(slices.language.minCount, 2);
  // Missing dimensions collapse to a single `unspecified` bucket.
  assert.deepEqual(Object.keys(slices.register.values), [UNSPECIFIED]);
  assert.equal(slices.register.values[UNSPECIFIED].n, 3);
  // domain: one `news` (insufficient) + two `unspecified`; keys sorted.
  assert.deepEqual(Object.keys(slices.domain.values), ['news', UNSPECIFIED]);
});

test('summarizeSlices tolerates empty input', () => {
  const slices = summarizeSlices([]);
  assert.deepEqual(Object.keys(slices), [...SLICE_DIMENSIONS]);
  assert.deepEqual(slices.language.values, {});
});
