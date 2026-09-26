// Numeric helpers shared by the deterministic features and the persona code.

export function finiteOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
