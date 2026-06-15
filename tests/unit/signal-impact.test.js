import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { signalImpact, recomputeHot, ALL_SIGNALS } from '../../scripts/signal-impact.mjs';
import { analyzeText } from '../../src/features/index.js';

// Uniform plain-다, 2 sentences, >= 20 tokens: hot ONLY via ko_ending_monotony
// (the 3-sentence burstiness gate is inert at 2 sentences).
const AI_ENDING = '주말에 집안일을 한꺼번에 몰아서 처리하면 평일에 쉬는 시간이 크게 줄어든다. ' +
  '작은 루틴을 미리 정해 두면 오후 시간이 한결 가벼워지고 일정도 정리된다.';

// Formal plain-다 but varied sentence lengths (high CV): cold.
const HUMAN_VARIED =
  '비가 내렸다. 우산도 없이 한참을 걷다가 결국 근처 카페로 들어가 따뜻한 커피를 한 잔 시켜 놓고 창밖을 멍하니 바라보며 비가 그치기를 기다렸다.';

test('recomputeHot reconstructs analyzeText.hot and supports ablation', () => {
  const a = analyzeText(AI_ENDING, { lang: 'ko' });
  assert.equal(a.hot, true);
  assert.equal(recomputeHot(a), true);
  // Ablating the only firing signal makes it cold.
  assert.equal(recomputeHot(a, new Set(['ko_ending_monotony'])), false);
  // Ablating an unrelated signal leaves it hot.
  assert.equal(recomputeHot(a, new Set(['lexicon_hot'])), true);

  const cold = analyzeText(HUMAN_VARIED, { lang: 'ko' });
  assert.equal(cold.hot, false);
  assert.equal(recomputeHot(cold), false);
});

test('signalImpact reports baseline confusion and per-signal marginal contribution', () => {
  const rows = [
    { sample_id: 'ai1', expected_hot: true, model_family: 'gpt-family', language: 'ko' },
    { sample_id: 'h1', expected_hot: false, language: 'ko' },
  ];
  const textById = { ai1: AI_ENDING, h1: HUMAN_VARIED };
  const report = signalImpact({ rows, textById, lang: 'ko' });

  assert.equal(report.matched, 2);
  assert.equal(report.total, 2);
  assert.equal(report.baseline.TP, 1);
  assert.equal(report.baseline.FP, 0);
  assert.equal(report.baseline.FN, 0);
  assert.equal(report.baseline.TN, 1);
  assert.equal(report.baseline.recall, 100);
  assert.equal(report.baseline.fpr, 0);

  const em = report.ablation.find((e) => e.signal === 'ko_ending_monotony');
  assert.ok(em, 'ko_ending_monotony should appear in ablation');
  assert.equal(em.attributableTP, 1); // the AI row is hot solely because of this signal
  assert.equal(em.attributableFP, 0);
  assert.equal(em.deltaRecall, 100); // removing it drops recall from 100 to 0

  // Catch-by-family only counts AI (expected_hot) rows.
  assert.deepEqual(report.catchByFamily, [{ family: 'gpt-family', n: 1, catch: 100 }]);
});

test('signalImpact skips rows without local text and reports coverage', () => {
  const rows = [
    { sample_id: 'ai1', expected_hot: true, language: 'ko' },
    { sample_id: 'missing', expected_hot: true, language: 'ko' },
  ];
  const report = signalImpact({ rows, textById: { ai1: AI_ENDING }, lang: 'ko' });
  assert.equal(report.total, 2);
  assert.equal(report.matched, 1);
});

test('ALL_SIGNALS lists every hot disjunct used by analyzeText', () => {
  for (const name of [
    'burstiness_low',
    'mattr_low',
    'lexicon_hot',
    'ko_diagnostics',
    'candor',
    'thematic_break',
    'ko_ending_monotony',
    'markup_leakage',
    'structural_model',
  ]) {
    assert.ok(ALL_SIGNALS.includes(name), `${name} should be a known signal`);
  }
});
