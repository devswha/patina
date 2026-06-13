import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  averagePrecision,
  bestF1Threshold,
  lowFprMetric,
  lowFprSummaries,
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

test('lowFprMetric reaches full TPR within the 1% FP budget on separable signal', () => {
  const records = [];
  for (let i = 0; i < 10; i++) records.push({ score: 90, expected: true });
  records.push({ score: 95, expected: false }); // one risky negative
  for (let i = 0; i < 99; i++) records.push({ score: 0, expected: false }); // 100 negatives total
  const m = lowFprMetric(records, 0.01);
  assert.equal(m.negatives, 100);
  assert.equal(m.max_false_positives, 1); // floor(0.01 * 100)
  assert.equal(m.tpr, 1);
  assert.equal(m.actual_fpr, 0.01);
  assert.equal(m.supported, true);
});

test('lowFprMetric keeps a strict zero-FP operating point when the budget floors to 0', () => {
  const records = [{ score: 90, expected: true }, { score: 80, expected: false }];
  for (let i = 0; i < 19; i++) records.push({ score: 0, expected: false }); // 20 negatives
  const m = lowFprMetric(records, 0.01); // floor(0.01 * 20) = 0
  assert.equal(m.max_false_positives, 0);
  assert.equal(m.tpr, 1); // a threshold above 80 catches the positive with zero FP
  assert.equal(m.actual_fpr, 0);
  assert.equal(m.supported, true);
});

test('lowFprMetric is unsupported with no negatives and tpr-null with no positives', () => {
  const noNeg = lowFprMetric([{ score: 80, expected: true }, { score: 90, expected: true }], 0.01);
  assert.equal(noNeg.supported, false);
  assert.equal(noNeg.reason, 'no_negatives');
  assert.equal(noNeg.actual_fpr, null);
  assert.equal(noNeg.tpr, null);

  const noPos = lowFprMetric([{ score: 10, expected: false }, { score: 0, expected: false }], 0.05);
  assert.equal(noPos.supported, false);
  assert.equal(noPos.reason, 'no_positives');
  assert.equal(noPos.tpr, null);
});

test('summarizeRanking includes low_fpr at the default 1% and 5% targets', () => {
  const summary = summarizeRanking([
    { score: 90, expected: true },
    { score: 70, expected: true },
    { score: 10, expected: false },
    { score: 0, expected: false },
  ]);
  assert.equal(Array.isArray(summary.low_fpr), true);
  assert.deepEqual(summary.low_fpr.map((m) => m.target_fpr), [0.01, 0.05]);
  for (const m of summary.low_fpr) {
    for (const k of ['target_fpr', 'negatives', 'max_false_positives']) assert.ok(k in m);
  }
  assert.equal(lowFprSummaries([]).length, 2);
});
