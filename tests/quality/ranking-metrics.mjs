export function summarizeRanking(records = []) {
  const normalized = records
    .map((record) => ({
      score: Number(record.score),
      expected: Boolean(record.expected),
    }))
    .filter((record) => Number.isFinite(record.score));

  const positives = normalized.filter((record) => record.expected).length;
  const negatives = normalized.length - positives;
  const sweep = thresholdSweep(normalized);
  const best = bestF1Threshold(sweep);

  return {
    n: normalized.length,
    positives,
    negatives,
    scoreRange: scoreRange(normalized),
    roc_auc: round(rocAuc(normalized)),
    pr_auc: round(averagePrecision(normalized)),
    bestF1: best,
    sweep,
  };
}

export function thresholdSweep(records = []) {
  const thresholds = thresholdCandidates(records);
  return thresholds.map((threshold) => {
    const metrics = emptyMetrics();
    for (const record of records) {
      updateMetrics(metrics, record.score >= threshold, record.expected);
    }
    return { threshold, ...summarize(metrics) };
  });
}

export function bestF1Threshold(rows = []) {
  if (!rows.length) return null;
  return [...rows].sort((a, b) =>
    b.f1 - a.f1 ||
    b.recall - a.recall ||
    b.precision - a.precision ||
    b.accuracy - a.accuracy ||
    a.threshold - b.threshold
  )[0];
}

export function rocAuc(records = []) {
  const positives = records.filter((record) => record.expected);
  const negatives = records.filter((record) => !record.expected);
  if (!positives.length || !negatives.length) return null;

  let wins = 0;
  for (const positive of positives) {
    for (const negative of negatives) {
      if (positive.score > negative.score) wins += 1;
      else if (positive.score === negative.score) wins += 0.5;
    }
  }
  return wins / (positives.length * negatives.length);
}

export function averagePrecision(records = []) {
  const positives = records.filter((record) => record.expected).length;
  if (!positives) return null;

  const groups = scoreGroups(records);
  let seen = 0;
  let truePositives = 0;
  let area = 0;

  for (const group of groups) {
    seen += group.total;
    truePositives += group.positives;
    if (group.positives) area += group.positives * (truePositives / seen);
  }
  return area / positives;
}

function thresholdCandidates(records) {
  const uniqueScores = [...new Set(records.map((record) => record.score))]
    .filter((score) => Number.isFinite(score))
    .sort((a, b) => a - b);
  return [...new Set([0, ...uniqueScores, 101])].sort((a, b) => a - b);
}

function scoreGroups(records) {
  const map = new Map();
  for (const record of records) {
    const group = map.get(record.score) || { score: record.score, total: 0, positives: 0 };
    group.total += 1;
    if (record.expected) group.positives += 1;
    map.set(record.score, group);
  }
  return [...map.values()].sort((a, b) => b.score - a.score);
}

function scoreRange(records) {
  if (!records.length) return { min: 0, max: 0 };
  const scores = records.map((record) => record.score);
  return {
    min: round(Math.min(...scores)),
    max: round(Math.max(...scores)),
  };
}

function emptyMetrics() {
  return { tp: 0, fp: 0, fn: 0, tn: 0, total: 0 };
}

function updateMetrics(metrics, predicted, expected) {
  metrics.total += 1;
  if (predicted && expected) metrics.tp += 1;
  else if (predicted && !expected) metrics.fp += 1;
  else if (!predicted && expected) metrics.fn += 1;
  else metrics.tn += 1;
}

function summarize(metrics) {
  const accuracy = metrics.total ? (metrics.tp + metrics.tn) / metrics.total : 0;
  const precision = metrics.tp + metrics.fp ? metrics.tp / (metrics.tp + metrics.fp) : 0;
  const recall = metrics.tp + metrics.fn ? metrics.tp / (metrics.tp + metrics.fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    ...metrics,
    accuracy: round(accuracy),
    precision: round(precision),
    recall: round(recall),
    f1: round(f1),
  };
}

function round(value, digits = 3) {
  if (value === null || value === undefined) return null;
  return Math.round(value * 10 ** digits) / 10 ** digits;
}
