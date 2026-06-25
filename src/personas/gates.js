function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

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
 * Evaluate persona hard gates.
 *
 * @param {object} input Gate inputs.
 * @returns {{pass: boolean, hardFailures: string[], personaMatch: number, mps: number|null, fidelity: number|null, churn: number, mpsEvaluated: boolean, fidelityEvaluated: boolean, thresholdSource: string|null}}
 */
export function evaluatePersonaGate({ personaMatch, mps, fidelity, churn, thresholds = {}, persona }) {
  const mpsFloor = Math.max(persona?.mps?.floor ?? 70, thresholds.mpsFloor ?? thresholds.mps_floor ?? 70);
  const fidelityFloor = Math.max(persona?.fidelity?.floor ?? 70, thresholds.fidelityFloor ?? thresholds.fidelity_floor ?? 70);
  const churnMax = thresholds.churnMax ?? thresholds.churn_max ?? 0.45;
  const personaMatchMin = thresholds.personaMatchMin ?? thresholds.persona_match_min ?? 70;
  const hardFailures = [];

  const mpsEvaluated = typeof mps === 'number' && Number.isFinite(mps);
  const fidelityEvaluated = typeof fidelity === 'number' && Number.isFinite(fidelity);

  if (mpsEvaluated && mps < mpsFloor) hardFailures.push('mps');
  if (fidelityEvaluated && fidelity < fidelityFloor) hardFailures.push('fidelity');
  if (typeof churn === 'number' && churn > churnMax) hardFailures.push('churn');
  if (typeof personaMatch === 'number' && personaMatch < personaMatchMin) hardFailures.push('personaMatch');

  return {
    pass: hardFailures.length === 0,
    hardFailures,
    personaMatch,
    mps,
    fidelity,
    churn,
    mpsEvaluated,
    fidelityEvaluated,
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
