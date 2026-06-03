// Deterministic paired-sample statistics for the ko baseline-vs-hosted compare
// harness. Pure functions only — no I/O, no Date, no Math.random. The bootstrap
// uses a seeded PRNG so reports and the regression-guard unit test are exactly
// reproducible across runs and machines.
//
// A "pair" is one held-out sample scored by both detectors:
//   { gold: boolean, baselineHot: boolean, hostedHot: boolean }
// where `gold` is the human label (true = AI/hot), and `*Hot` is each
// detector's prediction.

/**
 * mulberry32 seeded PRNG. Deterministic uniform draws in [0, 1).
 *
 * @param {number} seed 32-bit unsigned seed.
 * @returns {() => number} Generator returning the next uniform draw.
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Arithmetic mean.
 *
 * @param {number[]} values Numeric samples.
 * @returns {number} Mean, or 0 for an empty array.
 */
export function mean(values) {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/**
 * Linear-interpolation percentile of a sorted array.
 *
 * @param {number[]} sorted Ascending-sorted samples.
 * @param {number} p Quantile in [0, 1].
 * @returns {number} Interpolated percentile, or NaN for an empty array.
 */
export function percentile(sorted, p) {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0];
  const idx = p * (n - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

/**
 * Percentile bootstrap CI of a statistic over resampled observations.
 *
 * @param {Array<unknown>} samples Observations to resample with replacement.
 * @param {(resample: Array<unknown>) => number} statFn Statistic computed per resample and on the full sample.
 * @param {object} [opts] Bootstrap options.
 * @param {number} [opts.iterations=2000] Bootstrap resample count.
 * @param {number} [opts.alpha=0.05] Two-sided significance level (95% CI by default).
 * @param {number} [opts.seed=1] PRNG seed for reproducibility.
 * @returns {{point: number, lower: number, upper: number, iterations: number, alpha: number, excludesZero: boolean}} CI summary.
 */
export function bootstrapCI(samples, statFn, { iterations = 2000, alpha = 0.05, seed = 1 } = {}) {
  const n = samples.length;
  const point = n ? statFn(samples) : NaN;
  if (n === 0) {
    return { point, lower: NaN, upper: NaN, iterations, alpha, excludesZero: false };
  }
  const rng = mulberry32(seed);
  const stats = new Array(iterations);
  const resample = new Array(n);
  for (let i = 0; i < iterations; i++) {
    for (let j = 0; j < n; j++) {
      resample[j] = samples[Math.floor(rng() * n)];
    }
    stats[i] = statFn(resample);
  }
  stats.sort((a, b) => a - b);
  const lower = percentile(stats, alpha / 2);
  const upper = percentile(stats, 1 - alpha / 2);
  return {
    point,
    lower,
    upper,
    iterations,
    alpha,
    excludesZero: lower > 0 || upper < 0,
  };
}

function rateForGold(pairs, gold, key) {
  const subset = pairs.filter((p) => p.gold === gold);
  if (subset.length === 0) return { rate: NaN, n: 0 };
  const hits = subset.reduce((acc, p) => acc + (p[key] ? 1 : 0), 0);
  return { rate: hits / subset.length, n: subset.length };
}

/**
 * Catch (true-positive) rate delta CI: hosted minus baseline over gold-hot samples.
 *
 * @param {Array<{gold: boolean, baselineHot: boolean, hostedHot: boolean}>} pairs Paired predictions.
 * @param {object} [opts] Bootstrap options (see bootstrapCI).
 * @returns {{baselineRate: number, hostedRate: number, delta: number, ci: ReturnType<typeof bootstrapCI>, n: number}} Catch comparison.
 */
export function catchRateDeltaCI(pairs, opts = {}) {
  const positives = pairs.filter((p) => p.gold === true);
  const baseline = rateForGold(pairs, true, 'baselineHot');
  const hosted = rateForGold(pairs, true, 'hostedHot');
  const diffs = positives.map((p) => (p.hostedHot ? 1 : 0) - (p.baselineHot ? 1 : 0));
  const ci = bootstrapCI(diffs, mean, opts);
  return {
    baselineRate: baseline.rate,
    hostedRate: hosted.rate,
    delta: hosted.rate - baseline.rate,
    ci,
    n: positives.length,
  };
}

/**
 * False-positive rate delta CI: hosted minus baseline over gold-cold samples.
 *
 * @param {Array<{gold: boolean, baselineHot: boolean, hostedHot: boolean}>} pairs Paired predictions.
 * @param {object} [opts] Bootstrap options (see bootstrapCI).
 * @returns {{baselineRate: number, hostedRate: number, delta: number, ci: ReturnType<typeof bootstrapCI>, n: number, regressed: boolean}} FP comparison; `regressed` is true when the CI lower bound is strictly positive (hosted FP significantly worse).
 */
export function fpRateDeltaCI(pairs, opts = {}) {
  const negatives = pairs.filter((p) => p.gold === false);
  const baseline = rateForGold(pairs, false, 'baselineHot');
  const hosted = rateForGold(pairs, false, 'hostedHot');
  const diffs = negatives.map((p) => (p.hostedHot ? 1 : 0) - (p.baselineHot ? 1 : 0));
  const ci = bootstrapCI(diffs, mean, opts);
  return {
    baselineRate: baseline.rate,
    hostedRate: hosted.rate,
    delta: hosted.rate - baseline.rate,
    ci,
    n: negatives.length,
    regressed: Number.isFinite(ci.lower) && ci.lower > 0,
  };
}

// Abramowitz & Stegun 7.1.26 error-function approximation (max error ~1.5e-7).
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

/**
 * Survival function of the chi-square distribution with 1 degree of freedom.
 *
 * @param {number} stat Chi-square statistic (>= 0).
 * @returns {number} Two-sided p-value P(X >= stat).
 */
export function chiSquare1dfPValue(stat) {
  if (!Number.isFinite(stat) || stat <= 0) return 1;
  return 1 - erf(Math.sqrt(stat / 2));
}

/**
 * McNemar's test on paired correctness (baseline vs hosted) with continuity correction.
 *
 * @param {Array<{gold: boolean, baselineHot: boolean, hostedHot: boolean}>} pairs Paired predictions.
 * @returns {{b: number, c: number, n: number, statistic: number, pValue: number}} McNemar result.
 *   `b` = baseline correct & hosted wrong; `c` = baseline wrong & hosted correct.
 */
export function mcnemar(pairs) {
  let b = 0;
  let c = 0;
  for (const p of pairs) {
    const baselineCorrect = p.baselineHot === p.gold;
    const hostedCorrect = p.hostedHot === p.gold;
    if (baselineCorrect && !hostedCorrect) b++;
    else if (!baselineCorrect && hostedCorrect) c++;
  }
  const discordant = b + c;
  const statistic = discordant === 0 ? 0 : (Math.abs(b - c) - 1) ** 2 / discordant;
  return { b, c, n: discordant, statistic, pValue: chiSquare1dfPValue(statistic) };
}
