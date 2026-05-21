import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  averagePrecision,
  bestF1Threshold,
  rocAuc,
  summarizeRanking,
  thresholdSweep,
} from '../quality/ranking-metrics.mjs';

test('ranking metrics report perfect separation', () => {
  const records = [
    { score: 90, expected: true },
    { score: 70, expected: true },
    { score: 10, expected: false },
    { score: 0, expected: false },
  ];

  const summary = summarizeRanking(records);
  assert.equal(summary.roc_auc, 1);
  assert.equal(summary.pr_auc, 1);
  assert.equal(summary.bestF1.f1, 1);
  assert.equal(summary.bestF1.threshold, 70);
  assert.equal(summary.bestF1.tp, 2);
  assert.equal(summary.bestF1.fp, 0);
});

test('ranking metrics handle ties without hidden authorship claims', () => {
  const records = [
    { score: 50, expected: true },
    { score: 50, expected: false },
  ];

  assert.equal(rocAuc(records), 0.5);
  assert.equal(averagePrecision(records), 0.5);
});

test('ranking metrics handle degenerate class mixes', () => {
  assert.equal(rocAuc([{ score: 10, expected: true }]), null);
  assert.equal(averagePrecision([{ score: 10, expected: false }]), null);
  assert.equal(averagePrecision([{ score: 10, expected: true }]), 1);
});

test('threshold sweep includes all-cold candidate and deterministic best-F1 tie break', () => {
  const rows = thresholdSweep([
    { score: 100, expected: true },
    { score: 0, expected: false },
  ]);

  assert.ok(rows.some((row) => row.threshold === 101 && row.recall === 0));
  assert.equal(bestF1Threshold(rows).threshold, 100);
});
