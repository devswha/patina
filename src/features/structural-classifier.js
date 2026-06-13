// Small, dependency-free logistic classifier helpers for optional structural
// stylometry models. The public package ships the code path, not trained private
// weights; callers must provide a model explicitly.
import { extractStructuralFeatures, STRUCTURAL_FEATURE_NAMES } from './structural-features.js';

export const DEFAULT_STRUCTURAL_THRESHOLD = 0.5;

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function assertMatrix(X) {
  if (!Array.isArray(X) || X.length === 0 || !Array.isArray(X[0]) || X[0].length === 0) {
    throw new TypeError('training features must be a non-empty matrix');
  }
  const width = X[0].length;
  for (const row of X) {
    if (!Array.isArray(row) || row.length !== width || row.some((value) => !Number.isFinite(value))) {
      throw new TypeError('training features must be rectangular finite-number rows');
    }
  }
}

function assertLabels(y, expectedLength) {
  if (!Array.isArray(y) || y.length !== expectedLength || y.some((value) => value !== 0 && value !== 1)) {
    throw new TypeError('training labels must be 0/1 values aligned to features');
  }
}

export function fitScaler(X) {
  assertMatrix(X);
  const width = X[0].length;
  const mu = new Array(width).fill(0);
  const sigma = new Array(width).fill(0);

  for (const row of X) {
    for (let j = 0; j < width; j++) mu[j] += row[j];
  }
  for (let j = 0; j < width; j++) mu[j] /= X.length;

  for (const row of X) {
    for (let j = 0; j < width; j++) sigma[j] += (row[j] - mu[j]) ** 2;
  }
  for (let j = 0; j < width; j++) sigma[j] = Math.sqrt(sigma[j] / X.length) || 1;

  return { mu, sigma };
}

export function applyScaler({ mu, sigma }, row) {
  if (!Array.isArray(mu) || !Array.isArray(sigma) || !Array.isArray(row)) {
    throw new TypeError('scaler and row must be arrays');
  }
  if (mu.length !== sigma.length || row.length !== mu.length) {
    throw new TypeError('scaler dimensions must match row dimensions');
  }
  return row.map((value, index) => (value - mu[index]) / sigma[index]);
}

export function trainLogReg(X, y, { lr = 0.1, epochs = 2000, l2 = 0.01 } = {}) {
  assertMatrix(X);
  assertLabels(y, X.length);
  if (!Number.isFinite(lr) || lr <= 0) throw new TypeError('lr must be a positive finite number');
  if (!Number.isInteger(epochs) || epochs <= 0) throw new TypeError('epochs must be a positive integer');
  if (!Number.isFinite(l2) || l2 < 0) throw new TypeError('l2 must be a non-negative finite number');

  const scaler = fitScaler(X);
  const Z = X.map((row) => applyScaler(scaler, row));
  const width = Z[0].length;
  const w = new Array(width).fill(0);
  let b = 0;

  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradientW = new Array(width).fill(0);
    let gradientB = 0;

    for (let i = 0; i < Z.length; i++) {
      const probability = sigmoid(Z[i].reduce((sum, value, index) => sum + value * w[index], b));
      const error = probability - y[i];
      for (let j = 0; j < width; j++) gradientW[j] += error * Z[i][j];
      gradientB += error;
    }

    for (let j = 0; j < width; j++) w[j] -= lr * (gradientW[j] / Z.length + l2 * w[j]);
    b -= lr * (gradientB / Z.length);
  }

  // Only stamp this patina version's feature names onto models actually
  // trained at that width; a toy/experimental model must not masquerade as a
  // STRUCTURAL_FEATURE_NAMES-compatible model (normalizeStructuralModel
  // rejects non-matching widths at load time, issue #436).
  return width === STRUCTURAL_FEATURE_NAMES.length
    ? { weights: w, bias: b, scaler, featureNames: STRUCTURAL_FEATURE_NAMES }
    : { weights: w, bias: b, scaler };
}

export function normalizeStructuralModel(model) {
  if (!model || typeof model !== 'object') return null;
  const weights = model.weights ?? model.w;
  const bias = model.bias ?? model.b;
  const scaler = model.scaler;
  const threshold = model.threshold ?? DEFAULT_STRUCTURAL_THRESHOLD;

  if (!Array.isArray(weights) || !Number.isFinite(bias) || !scaler || !Number.isFinite(threshold)) {
    throw new TypeError('structural model requires weights, bias, scaler, and optional threshold');
  }
  if (!Array.isArray(scaler.mu) || !Array.isArray(scaler.sigma)) {
    throw new TypeError('structural model scaler requires mu and sigma arrays');
  }
  if (weights.length !== scaler.mu.length || weights.length !== scaler.sigma.length) {
    throw new TypeError('structural model dimensions must match scaler dimensions');
  }
  // Dimension must match THIS patina version's feature extractor, even when
  // the optional featureNames field is absent (issue #436). Otherwise a
  // self-consistent model trained against an older feature set loads cleanly
  // and only explodes at predict time, deep inside analyzeText — past the
  // call sites that handle load errors (audit aborts untyped; scoring.js
  // silently zeroes the whole deterministic shadow score, including the
  // markup-leakage floor).
  if (weights.length !== STRUCTURAL_FEATURE_NAMES.length) {
    throw new TypeError(
      `structural model expects ${weights.length} features but this patina version extracts ${STRUCTURAL_FEATURE_NAMES.length} (${STRUCTURAL_FEATURE_NAMES.join(', ')}); retrain the model against the current feature set`,
    );
  }
  if (weights.some((value) => !Number.isFinite(value)) || scaler.mu.some((value) => !Number.isFinite(value)) || scaler.sigma.some((value) => !Number.isFinite(value))) {
    throw new TypeError('structural model values must be finite numbers');
  }
  // Sigma must be strictly positive: a hand-written or truncated model with a
  // zero/negative sigma passes the finite check but makes applyScaler emit
  // NaN/±Infinity, which sigmoid turns into a silent NaN verdict (#443).
  if (scaler.sigma.some((value) => !(value > 0))) {
    throw new TypeError('structural model scaler sigma values must be positive');
  }
  if (Array.isArray(model.featureNames) && model.featureNames.join('\0') !== STRUCTURAL_FEATURE_NAMES.join('\0')) {
    throw new TypeError('structural model featureNames do not match this patina version');
  }

  return {
    ...model,
    weights,
    bias,
    scaler,
    threshold,
    featureNames: STRUCTURAL_FEATURE_NAMES,
  };
}

export function predictStructuralScore(model, row) {
  const normalized = normalizeStructuralModel(model);
  if (!normalized) throw new TypeError('structural model is required');
  const scaled = applyScaler(normalized.scaler, row);
  const score = sigmoid(scaled.reduce((sum, value, index) => sum + value * normalized.weights[index], normalized.bias));
  return score;
}

export function thresholdForMaxFpr(model, Xtrain, ytrain, maxFpr = 0.1) {
  const normalized = normalizeStructuralModel(model);
  assertMatrix(Xtrain);
  assertLabels(ytrain, Xtrain.length);
  if (!Number.isFinite(maxFpr) || maxFpr < 0 || maxFpr > 1) {
    throw new TypeError('maxFpr must be a finite number between 0 and 1');
  }
  const negativeScores = Xtrain
    .filter((_, index) => ytrain[index] === 0)
    .map((row) => predictStructuralScore(normalized, row))
    .sort((a, b) => a - b);
  if (negativeScores.length === 0) return DEFAULT_STRUCTURAL_THRESHOLD;
  // ceil (not floor) so the realized FPR never exceeds maxFpr: floor would keep
  // an extra negative above the threshold (#443).
  const index = Math.min(negativeScores.length - 1, Math.ceil((1 - maxFpr) * negativeScores.length));
  return Math.max(DEFAULT_STRUCTURAL_THRESHOLD, negativeScores[index]);
}

export function structuralModelVerdict(text, { lang = 'ko', model = null } = {}) {
  if (!model) return { available: false, hot: null, score: null };
  const normalized = normalizeStructuralModel(model);
  // A truthy non-object model normalizes to null; treat as unavailable rather
  // than null-derefing normalized.lang (#443).
  if (!normalized || (normalized.lang && normalized.lang !== lang)) {
    return { available: false, hot: null, score: null };
  }
  const row = extractStructuralFeatures(text, { lang });
  const score = predictStructuralScore(normalized, row);
  return {
    available: true,
    hot: score >= normalized.threshold,
    score: Number(score.toFixed(4)),
  };
}
