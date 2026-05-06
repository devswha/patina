// Burstiness CV + MATTR per core/stylometry.md §4 §5.
// Pure functions over token arrays; no I/O.

export const DEFAULT_BURSTINESS_BANDS = { low: 0.30, high: 0.50 };
export const DEFAULT_MATTR_BANDS = { low: 0.55, high: 0.70 };
export const DEFAULT_MATTR_WINDOW = 50;

// Coefficient of variation of sentence token counts.
// Returns null when the paragraph has fewer than 2 sentences or mean is 0.
export function burstinessCV(sentenceTokenCounts) {
  if (!Array.isArray(sentenceTokenCounts) || sentenceTokenCounts.length < 2) return null;
  const n = sentenceTokenCounts.length;
  const mean = sentenceTokenCounts.reduce((a, b) => a + b, 0) / n;
  if (mean === 0) return null;
  const variance =
    sentenceTokenCounts.reduce((acc, x) => acc + (x - mean) ** 2, 0) / n;
  return Math.sqrt(variance) / mean;
}

// Moving Average Type-Token Ratio (window default 50).
// Falls back to simple TTR when token count < window.
export function mattr(tokens, window = DEFAULT_MATTR_WINDOW) {
  if (!Array.isArray(tokens) || tokens.length === 0) return null;
  const lower = tokens.map((t) => t.toLowerCase());
  if (lower.length < window) {
    return new Set(lower).size / lower.length;
  }
  let sum = 0;
  let count = 0;
  for (let i = 0; i + window <= lower.length; i++) {
    const slice = lower.slice(i, i + window);
    sum += new Set(slice).size / window;
    count++;
  }
  return sum / count;
}

export function classifyBurstiness(cv, bands = DEFAULT_BURSTINESS_BANDS) {
  if (cv == null) return null;
  if (cv < bands.low) return 'low';
  if (cv > bands.high) return 'high';
  return 'mid';
}

export function classifyMattr(value, bands = DEFAULT_MATTR_BANDS) {
  if (value == null) return null;
  if (value < bands.low) return 'low';
  if (value > bands.high) return 'high';
  return 'mid';
}
