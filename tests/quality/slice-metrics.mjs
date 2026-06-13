// Additive slice aggregation for the deterministic benchmark (B2).
//
// Groups the per-fixture confusion outcomes by metadata dimension and reports
// counts + accuracy/precision/recall/F1, or an explicit insufficient-data state
// when a slice has fewer than `minCount` records. This is REPORT-ONLY: it never
// changes a detector threshold or the hot/cold decision. Dimensions absent from
// fixture frontmatter (domain/register/generator/edited) collapse to a single
// `unspecified` bucket until the corpus carries that metadata.

export const DEFAULT_MIN_SLICE_COUNT = 5;
export const UNSPECIFIED = 'unspecified';

// Slice dimensions, in stable report order. `language`, `class`, and
// `lengthBucket` are always derivable from current fixtures; the rest depend on
// frontmatter that may not exist yet (then `unspecified`).
export const SLICE_DIMENSIONS = Object.freeze([
  'language',
  'class',
  'lengthBucket',
  'domain',
  'register',
  'generator',
  'edited',
]);

// Deterministic length bucket from a code-point count. Documented + tested so
// the buckets are stable across Node versions and platforms.
export function lengthBucket(charCount) {
  if (typeof charCount !== 'number' || !Number.isFinite(charCount) || charCount <= 0) return 'empty';
  if (charCount <= 400) return 'short';
  if (charCount <= 1200) return 'medium';
  return 'long';
}

function round(n, digits = 3) {
  return Math.round(n * 10 ** digits) / 10 ** digits;
}

function confusion(records) {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (const r of records) {
    const predicted = Boolean(r.predicted_hot);
    const expected = Boolean(r.expected_hot);
    if (predicted && expected) tp += 1;
    else if (predicted && !expected) fp += 1;
    else if (!predicted && expected) fn += 1;
    else tn += 1;
  }
  return { tp, fp, fn, tn };
}

// One slice's metrics. Below `minCount` records, metrics are null with
// supported:false / reason:'insufficient_data' but counts are still reported.
export function sliceMetric(records, minCount = DEFAULT_MIN_SLICE_COUNT) {
  const n = records.length;
  const { tp, fp, fn, tn } = confusion(records);
  if (n < minCount) {
    return { n, tp, fp, fn, tn, accuracy: null, precision: null, recall: null, f1: null, supported: false, reason: 'insufficient_data' };
  }
  const accuracy = (tp + tn) / n;
  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = tp + fn > 0 ? tp / (tp + fn) : null;
  const f1 = precision != null && recall != null && precision + recall > 0
    ? (2 * precision * recall) / (precision + recall)
    : null;
  return {
    n,
    tp,
    fp,
    fn,
    tn,
    accuracy: round(accuracy),
    precision: precision == null ? null : round(precision),
    recall: recall == null ? null : round(recall),
    f1: f1 == null ? null : round(f1),
    supported: true,
    reason: null,
  };
}

// Build the full slice report. `records` carry the slice dimension fields plus
// predicted_hot / expected_hot. Output is deterministic (dimensions in
// SLICE_DIMENSIONS order; values sorted by key).
export function summarizeSlices(records, { minCount = DEFAULT_MIN_SLICE_COUNT, dimensions = SLICE_DIMENSIONS } = {}) {
  const list = Array.isArray(records) ? records : [];
  const out = {};
  for (const dimension of dimensions) {
    const groups = new Map();
    for (const record of list) {
      const key = record[dimension] ?? UNSPECIFIED;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(record);
    }
    const values = {};
    for (const key of [...groups.keys()].sort()) {
      values[key] = sliceMetric(groups.get(key), minCount);
    }
    out[dimension] = { minCount, values };
  }
  return out;
}
