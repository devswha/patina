import { clamp } from '../features/numeric.js';

function tokens(text) {
  return String(text ?? '').normalize('NFC').match(/[\p{L}\p{N}]+|[^\s\p{L}\p{N}]/gu) ?? [];
}

function lcsLength(a, b) {
  if (a.length === 0 || b.length === 0) return 0;
  const prev = new Array(b.length + 1).fill(0);
  const curr = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
    }
    prev.splice(0, prev.length, ...curr);
    curr.fill(0);
  }
  return prev[b.length];
}

/**
 * Compute deterministic token churn in the range 0..1 using LCS distance.
 *
 * @param {string} original Original text.
 * @param {string} rewritten Rewritten text.
 * @returns {number} Token-level churn.
 */
export function editChurn(original, rewritten) {
  const a = tokens(original);
  const b = tokens(rewritten);
  const denom = Math.max(a.length, b.length);
  if (denom === 0) return 0;
  return clamp(1 - (lcsLength(a, b) / denom), 0, 1);
}

/**
 * Evaluate persona-specific voice signals.
 *
 * Persona quality is advisory: persona-match and surface churn can warn, but
 * never block output. Meaning, numbers, and fidelity are enforced by the
 * global rewrite/verification path instead of this voice module.
 *
 * @param {object} input Gate inputs.
 * @param {number} [input.personaMatch] Deterministic persona-match score.
 * @param {number} [input.churn] Deterministic token churn 0..1.
 * @param {object} [input.thresholds] Persona-quality thresholds.
 * @returns {object} Advisory persona-quality result.
 */
export function evaluatePersonaGate({ personaMatch, churn, thresholds = {} }) {
  const churnMax = thresholds.churnMax ?? thresholds.churn_max ?? 0.45;
  const personaMatchMin = thresholds.personaMatchMin ?? thresholds.persona_match_min ?? 70;
  const personaMatchEvaluated = typeof personaMatch === 'number' && Number.isFinite(personaMatch);
  const personaMatchPass = !personaMatchEvaluated || personaMatch >= personaMatchMin;
  const churnEvaluated = typeof churn === 'number' && Number.isFinite(churn);
  const churnPass = !churnEvaluated || churn <= churnMax;
  const advisory = [];
  if (!personaMatchPass) advisory.push('personaMatch');
  if (!churnPass) advisory.push('churn');


  return {
    pass: true,
    hardFailures: [],
    safetyFailures: [],
    advisory,
    churnMax,
    churnEvaluated,
    churnPass,
    personaMatch,
    personaMatchMin,
    personaMatchEvaluated,
    personaMatchPass,
    churn,
    thresholdSource: thresholds.source ?? thresholds.thresholdSource ?? null,
  };
}

function boolPass(row, side, field) {
  const value = row?.[side]?.[field];
  if (typeof value === 'boolean') return value;
  if (field === 'mps_passed') return row?.[side]?.mps >= 70;
  if (field === 'fidelity_passed') return row?.[side]?.fidelity >= 70;
  if (field === 'churn_passed') return row?.[side]?.churn <= 0.45;
  return Boolean(value);
}

function rate(rows, side, field) {
  if (rows.length === 0) return 0;
  return rows.filter((row) => boolPass(row, side, field)).length / rows.length;
}

/**
 * Aggregate baseline-vs-treatment ablation rows using the v1 pass formula.
 *
 * @param {object[]} rows Fixture comparison rows.
 * @returns {object} Aggregate metrics and pass decision.
 */
export function aggregateAblation(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const meanPersonaMatchDelta = safeRows.length === 0 ? 0 : safeRows.reduce((sum, row) => {
    const delta = row?.deltas?.persona_match ?? ((row?.treatment?.persona_match ?? 0) - (row?.baseline?.persona_match ?? 0));
    return sum + delta;
  }, 0) / safeRows.length;
  const winRate = safeRows.length === 0 ? 0 : safeRows.filter((row) => row?.winner === 'treatment').length / safeRows.length;
  const treatmentMpsPassRate = rate(safeRows, 'treatment', 'mps_passed');
  const baselineMpsPassRate = rate(safeRows, 'baseline', 'mps_passed');
  const treatmentFidelityPassRate = rate(safeRows, 'treatment', 'fidelity_passed');
  const baselineFidelityPassRate = rate(safeRows, 'baseline', 'fidelity_passed');
  const treatmentChurnPassRate = rate(safeRows, 'treatment', 'churn_passed');
  const baselineChurnPassRate = rate(safeRows, 'baseline', 'churn_passed');
  const mpsPassRate = treatmentMpsPassRate;
  const fidelityPassRate = treatmentFidelityPassRate;
  const churnPassRate = treatmentChurnPassRate;
  const aggregatePass =
    meanPersonaMatchDelta >= 5 &&
    winRate >= 0.55 &&
    treatmentMpsPassRate >= baselineMpsPassRate - 0.01 &&
    treatmentFidelityPassRate >= baselineFidelityPassRate - 0.01 &&
    treatmentChurnPassRate >= baselineChurnPassRate - 0.03;

  return {
    meanPersonaMatchDelta,
    winRate,
    mpsPassRate,
    fidelityPassRate,
    churnPassRate,
    baselineMpsPassRate,
    baselineFidelityPassRate,
    baselineChurnPassRate,
    treatmentMpsPassRate,
    treatmentFidelityPassRate,
    treatmentChurnPassRate,
    safetyPassRateDrop: Math.max(
      baselineMpsPassRate - treatmentMpsPassRate,
      baselineFidelityPassRate - treatmentFidelityPassRate,
      baselineChurnPassRate - treatmentChurnPassRate,
      0
    ),
    aggregatePass,
  };
}

/**
 * Decide whether calibration rounds can promote thresholds or must fall back.
 *
 * @param {object[]} roundResults Aggregate round results or raw-row containers.
 * @returns {'promote-thresholds'|'keep-placeholder'|'fallback-bridge-only'} Decision.
 */
export function ablationDecision(roundResults) {
  let consecutiveFailures = 0;
  let sawPass = false;
  for (const round of Array.isArray(roundResults) ? roundResults : []) {
    const aggregate = Array.isArray(round?.rows) ? aggregateAblation(round.rows) : round;
    const safetyPassRateDrop = aggregate?.safetyPassRateDrop ?? Math.max(
      (aggregate?.baselineMpsPassRate ?? 0) - (aggregate?.treatmentMpsPassRate ?? aggregate?.mpsPassRate ?? 0),
      (aggregate?.baselineFidelityPassRate ?? 0) - (aggregate?.treatmentFidelityPassRate ?? aggregate?.fidelityPassRate ?? 0),
      0
    );
    const roundFail =
      aggregate?.aggregatePass === false ||
      (aggregate?.meanPersonaMatchDelta ?? 0) < 3 ||
      (aggregate?.winRate ?? 0) < 0.52 ||
      safetyPassRateDrop > 0.03;
    if (roundFail) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= 2) return 'fallback-bridge-only';
    } else {
      consecutiveFailures = 0;
      sawPass = true;
    }
  }
  return sawPass ? 'promote-thresholds' : 'keep-placeholder';
}
