import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { buildLowFprReport, renderMarkdown, NO_SIGNAL_SENTENCE } from '../../scripts/rebaseline-low-fpr-report.mjs';

// Build manifest-shaped rows: { language, register, expected_hot, patina_score }.
function rows(language, register, specs) {
  const out = [];
  for (const [score, expected, count] of specs) {
    for (let i = 0; i < count; i += 1) {
      out.push({ language, register, expected_hot: expected, patina_score: score });
    }
  }
  return out;
}

function find(metrics, target) {
  return metrics.find((m) => m.target_fpr === target);
}

test('buildLowFprReport: supported operating point at 1% FPR', () => {
  // 100 negatives (99@1, 1@9), 10 positives (8@10, 2@2): at 1% FPR (max_FP=1)
  // a threshold of 2 catches all positives with one false positive.
  const r = buildLowFprReport(rows('sup', 'r1', [[1, false, 99], [9, false, 1], [10, true, 8], [2, true, 2]]));
  const m = find(r.perLanguage.sup, 0.01);
  assert.equal(m.status, 'supported');
  assert.equal(m.negatives, 100);
  assert.equal(m.positives, 10);
  assert.equal(m.max_false_positives, 1);
  assert.equal(m.tpr, 1);
  assert.equal(m.actual_fpr, 0.01);
});

test('buildLowFprReport: perfect separation -> no_calibration_signal_yet', () => {
  const r = buildLowFprReport(rows('perf', 'r1', [[0, false, 100], [10, true, 10]]));
  const m = find(r.perLanguage.perf, 0.01);
  assert.equal(m.status, 'no_calibration_signal_yet');
  assert.equal(m.tpr, 1);
  assert.equal(m.actual_fpr, 0);
});

test('buildLowFprReport: <100 negatives -> insufficient_negatives_for_1pct at 1%, supported at 5%', () => {
  const r = buildLowFprReport(rows('few', 'r1', [[1, false, 20], [10, true, 5]]));
  assert.equal(find(r.perLanguage.few, 0.01).status, 'insufficient_negatives_for_1pct');
  assert.equal(find(r.perLanguage.few, 0.01).max_false_positives, 0);
  // at 5% FPR, floor(0.05*20)=1 -> a real budget exists.
  assert.equal(find(r.perLanguage.few, 0.05).max_false_positives, 1);
});

test('buildLowFprReport: no_negatives / no_positives diagnostics', () => {
  const noNeg = buildLowFprReport(rows('noneg', 'r1', [[10, true, 5]]));
  assert.equal(find(noNeg.perLanguage.noneg, 0.01).status, 'no_negatives');
  const noPos = buildLowFprReport(rows('nopos', 'r1', [[1, false, 5]]));
  assert.equal(find(noPos.perLanguage.nopos, 0.01).status, 'no_positives');
});

test('buildLowFprReport groups by language and language x register and is sorted', () => {
  const all = [
    ...rows('ko', 'blog', [[0, false, 100], [10, true, 5]]),
    ...rows('ko', 'product-doc', [[1, false, 100], [9, false, 1], [10, true, 8], [2, true, 2]]),
    ...rows('en', 'blog', [[0, false, 100], [10, true, 5]]),
  ];
  const r = buildLowFprReport(all);
  assert.deepEqual(Object.keys(r.perLanguage), ['en', 'ko']); // sorted
  assert.deepEqual(Object.keys(r.perLanguageRegister), ['en × blog', 'ko × blog', 'ko × product-doc']);
  assert.equal(r.rowCount, all.length);
  // overall + every group carries both targets.
  assert.deepEqual(r.overall.map((m) => m.target_fpr), [0.01, 0.05]);
});

test('renderMarkdown prints the exact stall sentence when a group is no_calibration_signal_yet', () => {
  const r = buildLowFprReport(rows('perf', 'r1', [[0, false, 100], [10, true, 10]]));
  const md = renderMarkdown(r);
  assert.ok(md.includes(NO_SIGNAL_SENTENCE));
  assert.equal(NO_SIGNAL_SENTENCE, 'no calibration signal yet — corpus not hard enough');
  assert.ok(md.includes('## By language × register'));
});
