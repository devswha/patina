import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { ablationDecision, evaluatePersonaGate } from '../../src/personas/gates.js';

const contentPersona = {
  id: 'content-test',
  depth: 'content',
  mps: { enforce: true, floor: 70 },
  fidelity: { enforce: true, floor: 70 },
};

test('persona gate keeps a low persona-match ADVISORY (does not fail the gate)', () => {
  const result = evaluatePersonaGate({
    persona: contentPersona,
    personaMatch: 30,
    mps: 90,
    fidelity: 90,
    churn: 0.1,
    thresholds: { personaMatchMin: 70, mpsFloor: 70, fidelityFloor: 70, churnMax: 0.45 },
  });
  assert.equal(result.pass, true, 'low voice-match must not block output');
  assert.deepEqual(result.safetyFailures, []);
  assert.deepEqual(result.hardFailures, []);
  assert.equal(result.personaMatchPass, false);
  assert.deepEqual(result.advisory, ['personaMatch']);
});

test('persona gate hard-fails on dropped source numbers (deterministic safety)', () => {
  const result = evaluatePersonaGate({
    persona: contentPersona,
    personaMatch: 90,
    mps: null,
    fidelity: null,
    churn: 0.1,
    droppedNumbers: ['2026', '30'],
    thresholds: { personaMatchMin: 70, mpsFloor: 70, fidelityFloor: 70, churnMax: 0.45 },
  });
  assert.equal(result.pass, false);
  assert.ok(result.safetyFailures.includes('numbers'));
  assert.deepEqual(result.droppedNumbers, ['2026', '30']);
});

test('persona gate: safety passes while voice-match is advisory-only, in one report', () => {
  const result = evaluatePersonaGate({
    persona: contentPersona,
    personaMatch: 40,
    mps: 85,
    fidelity: 88,
    churn: 0.2,
    droppedNumbers: [],
    thresholds: { personaMatchMin: 70, mpsFloor: 70, fidelityFloor: 70, churnMax: 0.45 },
  });
  assert.equal(result.pass, true);
  assert.equal(result.personaMatchPass, false);
  assert.equal(result.personaMatchMin, 70);
  assert.deepEqual(result.advisory, ['personaMatch']);
});

test('persona gate hard-fails mps below floor even for content persona', () => {
  const result = evaluatePersonaGate({
    persona: contentPersona,
    personaMatch: 90,
    mps: 69,
    fidelity: 90,
    churn: 0.1,
    thresholds: { personaMatchMin: 70, mpsFloor: 70, fidelityFloor: 70, churnMax: 0.45 },
  });
  assert.equal(result.pass, false);
  assert.ok(result.hardFailures.includes('mps'));
});

test('persona gate hard-fails fidelity below floor', () => {
  const result = evaluatePersonaGate({
    persona: contentPersona,
    personaMatch: 90,
    mps: 90,
    fidelity: 69,
    churn: 0.1,
    thresholds: { personaMatchMin: 70, mpsFloor: 70, fidelityFloor: 70, churnMax: 0.45 },
  });
  assert.equal(result.pass, false);
  assert.ok(result.hardFailures.includes('fidelity'));
});

test('persona gate hard-fails churn above max', () => {
  const result = evaluatePersonaGate({
    persona: contentPersona,
    personaMatch: 90,
    mps: 90,
    fidelity: 90,
    churn: 0.5,
    thresholds: { personaMatchMin: 70, mpsFloor: 70, fidelityFloor: 70, churnMax: 0.45 },
  });
  assert.equal(result.pass, false);
  assert.ok(result.hardFailures.includes('churn'));
});

test('persona gate treats null mps and fidelity as not evaluated', () => {
  const result = evaluatePersonaGate({
    persona: contentPersona,
    personaMatch: 80,
    mps: null,
    fidelity: null,
    churn: 0.2,
    thresholds: { personaMatchMin: 70, mpsFloor: 70, fidelityFloor: 70, churnMax: 0.45 },
  });
  assert.equal(result.pass, true);
  assert.equal(result.mps, null);
  assert.equal(result.fidelity, null);
  assert.equal(result.mpsEvaluated, false);
  assert.equal(result.fidelityEvaluated, false);
  assert.deepEqual(result.hardFailures, []);
});

test('persona gate hard-fails numeric mps below floor', () => {
  const result = evaluatePersonaGate({
    persona: contentPersona,
    personaMatch: 80,
    mps: 50,
    fidelity: null,
    churn: 0.2,
    thresholds: { personaMatchMin: 70, mpsFloor: 70, fidelityFloor: 70, churnMax: 0.45 },
  });
  assert.equal(result.pass, false);
  assert.equal(result.mpsEvaluated, true);
  assert.ok(result.hardFailures.includes('mps'));
});

test('persona gate ignores null mps when churn hard-fails', () => {
  const result = evaluatePersonaGate({
    persona: contentPersona,
    personaMatch: 80,
    mps: null,
    fidelity: null,
    churn: 0.9,
    thresholds: { personaMatchMin: 70, mpsFloor: 70, fidelityFloor: 70, churnMax: 0.45 },
  });
  assert.equal(result.pass, false);
  assert.equal(result.mpsEvaluated, false);
  assert.deepEqual(result.hardFailures, ['churn']);
});

test('ablation decision falls back on two consecutive failed rounds', () => {
  const fail = {
    aggregatePass: false,
    meanPersonaMatchDelta: 2,
    winRate: 0.5,
    safetyPassRateDrop: 0,
  };
  assert.equal(ablationDecision([fail, fail]), 'fallback-bridge-only');
});

test('ablation decision resets failure count after a passing round', () => {
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
  assert.equal(ablationDecision([fail, pass, fail]), 'promote-thresholds');
});
