// Shared harness-only Wilson score interval (95% by default).
// Measurement utility for quality/benchmark harnesses; deterministic, no deps.
// Returns the raw {low, high} interval — callers round/label as needed.
export function wilsonInterval(successes, n, z = 1.959963984540054) {
  if (!n) return { low: 0, high: 0 };
  const phat = successes / n;
  const denom = 1 + (z ** 2) / n;
  const center = (phat + (z ** 2) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((phat * (1 - phat) + (z ** 2) / (4 * n)) / n)) / denom;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}
