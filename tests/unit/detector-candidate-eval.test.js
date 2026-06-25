// Phase B: tests for the attributable detector-candidate evaluation harness.
// Verifies the promotion rule, the current-evidence "no promotion" outcome, and
// the advisory boundary (translationese is NOT folded into the hot decision).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateCandidates, decidePromotion } from '../../scripts/detector-candidate-eval.mjs';
import { analyzeText } from '../../src/features/index.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('decidePromotion promotes only when attributable TP beats FP with no new FP', () => {
  assert.equal(decidePromotion({ attributableTP: 5, attributableFP: 2, newBenchmarkNaturalFP: 0, newHumanControlFP: 0 }).promote, true);
  // ties / losses do not promote
  assert.equal(decidePromotion({ attributableTP: 2, attributableFP: 2, newBenchmarkNaturalFP: 0, newHumanControlFP: 0 }).promote, false);
  assert.equal(decidePromotion({ attributableTP: 1, attributableFP: 3, newBenchmarkNaturalFP: 0, newHumanControlFP: 0 }).promote, false);
  // any new benchmark-natural or human-control FP blocks promotion even if TP>FP
  assert.equal(decidePromotion({ attributableTP: 9, attributableFP: 0, newBenchmarkNaturalFP: 1, newHumanControlFP: 0 }).promote, false);
  assert.equal(decidePromotion({ attributableTP: 9, attributableFP: 0, newBenchmarkNaturalFP: 0, newHumanControlFP: 1 }).promote, false);
});

test('current evidence promotes no candidate (detector stays unchanged, FP-safe)', () => {
  const a = evaluateCandidates();
  const b = evaluateCandidates();
  assert.deepEqual(a.promoted, b.promoted, 'evaluation is deterministic');
  assert.deepEqual(a.promoted, [], 'no candidate clears attributable TP > FP without new FP on committed evidence');
  for (const c of Object.values(a.candidates)) {
    assert.equal(c.decision, 'HOLD');
  }
});

test('evaluation exposes pre-registered denominators with benchmark recall intact', () => {
  const r = evaluateCandidates();
  for (const slice of ['sycophancy', 'lexical_tells', 'structural_tells', 'human_controls', 'benchmark_ai', 'benchmark_natural']) {
    assert.ok(slice in r.denominators, `missing denominator ${slice}`);
  }
  // The benchmark fixtures must stay perfectly classified (no regression headroom).
  assert.equal(r.denominators.benchmark_ai.currentRecall, 1);
  assert.equal(r.denominators.benchmark_natural.currentFP, 0);
  // human-controls are negatives; their existing FP is the burstiness-driven smoke signal.
  assert.equal(r.denominators.human_controls.expectedHot, false);
});

test('advisory boundary: translationese does not force the hot decision', () => {
  // Varied sentence lengths + diverse vocabulary keep burstiness/MATTR cold, but
  // the text carries Korean calque connectives that translationese flags.
  const text = [
    '이 문제에 대한 접근은 생각보다 단순했다.',
    '우리는 사용자 인터뷰를 통해 실제 불편을 확인했고, 그 과정에서 예상하지 못한 패턴 몇 가지를 새로 발견하게 되었다.',
    '결국 핵심은 속도였다.',
    '성능 측면에 있어서 개선의 여지가 분명히 남아 있었지만, 당장은 가장 자주 쓰이는 경로부터 손보기로 했다.',
    '작은 변화였다.',
    '그렇지만 체감은 컸다.',
  ].join('\n\n');
  const r = analyzeText(text, { lang: 'ko', repoRoot: REPO_ROOT });
  assert.ok(Array.isArray(r.translationese.hits) && r.translationese.hits.length > 0, 'translationese should flag calques');
  assert.equal(r.hot, false, 'translationese hits alone must not make the document hot');
});
