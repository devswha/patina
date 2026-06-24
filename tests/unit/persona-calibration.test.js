import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { aggregateAblation, ablationDecision } from '../../src/personas/gates.js';
import { buildCalibrationArtifact, calibrationDecision, validateCalibrationArtifact } from '../../scripts/persona-calibration.mjs';

const thresholds = {
  source: 'placeholder',
  calibration_rounds_required: 2,
  persona_match_min: 70,
  mps_floor: 70,
  fidelity_floor: 70,
  churn_max: 0.45,
};

function row({ delta = 6, winner = 'treatment', treatmentPass = true } = {}) {
  return {
    fixture_id: 'fixture-1',
    persona_id: 'blog-essay',
    baseline: { persona_match: 65, mps: 90, fidelity: 90, churn: 0.2, passed: true, mps_passed: true, fidelity_passed: true, churn_passed: true },
    treatment: { persona_match: 65 + delta, mps: 90, fidelity: 90, churn: 0.22, passed: treatmentPass, mps_passed: true, fidelity_passed: true, churn_passed: true },
    winner,
    deltas: { persona_match: delta, mps: 0, fidelity: 0, churn: 0.02 },
  };
}

test('placeholder calibration report records threshold source before calibration', () => {
  const artifact = buildCalibrationArtifact({ round: 1, thresholds, rows: [row()] });

  assert.equal(artifact.schema, 'patina.persona.calibration.v1');
  assert.equal(artifact.threshold_source_before, 'placeholder');
  assert.deepEqual(validateCalibrationArtifact(artifact), { valid: true, errors: [] });
});

test('placeholder thresholds cannot be promoted without two round artifacts', () => {
  const aggregate = aggregateAblation([row(), row({ delta: 7 })]);

  assert.equal(aggregate.aggregatePass, true);
  assert.equal(ablationDecision([aggregate]), 'promote-thresholds');
  assert.equal(calibrationDecision({ round: 1, aggregate }), 'keep-placeholder');
});

test('calibration decision permits promotion only at round two with aggregate pass', () => {
  const aggregate = aggregateAblation([row(), row({ delta: 7 })]);

  assert.equal(calibrationDecision({ round: 2, aggregate }), 'promote-thresholds');
});

test('calibration context preserves ablation fail and reset decisions', () => {
  const fail = {
    aggregatePass: false,
    meanPersonaMatchDelta: 2,
    winRate: 0.5,
    safetyPassRateDrop: 0,
  };
  const pass = {
    aggregatePass: true,
    meanPersonaMatchDelta: 6,
    winRate: 0.6,
    safetyPassRateDrop: 0,
  };

  assert.equal(calibrationDecision({ round: 2, aggregate: fail, roundResults: [fail, fail] }), 'fallback-bridge-only');
  assert.equal(calibrationDecision({ round: 2, aggregate: pass, roundResults: [fail, pass, fail] }), 'promote-thresholds');
});
