// @ts-check
// Sanitized observability for the web rewrite surface. Emits ONLY non-sensitive
// metadata: route, tier, provider, model, status, bucketed latency, quota
// decision, and a bucketed character count. It NEVER emits the request text,
// prompt, model output, Authorization header, API key, or a full client IP.
//
// buildRewriteMetric destructures only allowlisted inputs, so a caller cannot
// accidentally leak text/keys through it; sanitizeMetric is a second allowlist
// pass for any metric assembled elsewhere.

/** The complete set of fields a rewrite metric may contain. */
export const METRIC_FIELDS = Object.freeze([
  'route', 'tier', 'provider', 'model', 'status', 'latencyBucket', 'quotaDecision', 'charBucket', 'outcome',
]);

/** Closed set of stream outcomes; anything else normalizes to 'n/a' so the field can never carry free-form text. */
const OUTCOME_VALUES = Object.freeze(new Set(['ok', 'stream_failed', 'scoring_failed', 'floor_failed']));

/** Bucket a latency (ms) into a coarse band so timings are not individually identifying. */
export function latencyBucket(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return 'unknown';
  if (n < 250) return '<250ms';
  if (n < 1000) return '250ms-1s';
  if (n < 3000) return '1s-3s';
  if (n < 10000) return '3s-10s';
  return '>10s';
}

/** Bucket a character count so input size is coarse, never the text itself. */
export function charBucket(count) {
  const n = Number(count);
  if (!Number.isFinite(n) || n < 0) return 'unknown';
  if (n < 500) return '<500';
  if (n < 2000) return '500-2k';
  if (n < 4000) return '2k-4k';
  if (n < 20000) return '4k-20k';
  return '>20k';
}

/**
 * Build a sanitized rewrite metric. Only the allowlisted, non-sensitive fields
 * are read; any extra keys passed in are ignored, so text/prompt/key/IP can
 * never flow through.
 *
 * @param {{route?:string, tier?:string, provider?:string, model?:string, status?:number, latencyMs?:number, quotaDecision?:string, charCount?:number, outcome?:string}} [input]
 * @returns {{route:string, tier:string, provider:string, model:string, status:number, latencyBucket:string, quotaDecision:string, charBucket:string, outcome:string}}
 */
export function buildRewriteMetric({ route = '/api/rewrite', tier, provider, model, status, latencyMs, quotaDecision, charCount, outcome } = {}) {
  return {
    route: String(route),
    tier: tier === 'free' || tier === 'byok' ? tier : 'unknown',
    provider: provider ? String(provider) : 'unknown',
    model: model ? String(model) : 'unknown',
    status: Number.isFinite(Number(status)) ? Number(status) : 0,
    latencyBucket: latencyBucket(latencyMs),
    quotaDecision: quotaDecision ? String(quotaDecision) : 'n/a',
    charBucket: charBucket(charCount),
    outcome: OUTCOME_VALUES.has(String(outcome)) ? String(outcome) : 'n/a',
  };
}

/**
 * Defense-in-depth: drop any field not on the metric allowlist before emit.
 * @param {Record<string, unknown>} metric
 * @returns {Record<string, unknown>}
 */
export function sanitizeMetric(metric) {
  /** @type {Record<string, unknown>} */
  const out = {};
  const src = metric && typeof metric === 'object' ? metric : {};
  for (const key of METRIC_FIELDS) {
    if (key in src) out[key] = /** @type {any} */ (src)[key];
  }
  return out;
}
