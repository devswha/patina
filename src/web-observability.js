// @ts-check
// Private, aggregate-only observability for the web rewrite surface. The legacy
// metric helpers below remain for existing callers; new observers only emit a
// closed schema and never receive request content or credentials.

/** The complete set of fields a legacy rewrite metric may contain. */
export const METRIC_FIELDS = Object.freeze([
  'route', 'tier', 'provider', 'model', 'status', 'latencyBucket', 'quotaDecision', 'charBucket', 'outcome',
]);

/** Closed set of legacy stream outcomes. */
const OUTCOME_VALUES = Object.freeze(new Set(['ok', 'stream_failed', 'scoring_failed', 'floor_failed']));

/** Canonical closed descriptor for every patina.web.v1 event. */
export const WEB_OBSERVABILITY_SCHEMA = Object.freeze({
  schemaVersion: 'v1',
  schema: 'patina.web.v1',
  fields: Object.freeze([
    'schemaVersion', 'schema', 'channel', 'evidenceClass', 'tier', 'outcome', 'latencyBucket', 'statusClass', 'sampling',
  ]),
  values: Object.freeze({
    channel: Object.freeze(['production', 'staging', 'unknown']),
    evidenceClass: Object.freeze(['aggregate_only']),
    tier: Object.freeze(['free', 'byok', 'pro', 'unknown']),
    outcome: Object.freeze([
      'completed', 'terminal_failed', 'number_safety_failed', 'entitlement_denied', 'entitlement_unavailable',
      'quota_denied', 'service_disabled', 'monitor_drop', 'unknown',
    ]),
    latencyBucket: Object.freeze(['<=30s', '30-60s', '60-120s', '>120s', 'unknown']),
    statusClass: Object.freeze(['1xx', '2xx', '3xx', '4xx', '5xx', 'unknown']),
    sampling: Object.freeze(['full', 'sampled_1_of_20']),
  }),
});

/** Ordered fields used by patina.web.v1. */
export const WEB_OBSERVABILITY_FIELDS = WEB_OBSERVABILITY_SCHEMA.fields;
export const WEB_OUTCOMES = WEB_OBSERVABILITY_SCHEMA.values.outcome;
export const WEB_CHANNELS = Object.freeze(WEB_OBSERVABILITY_SCHEMA.values.channel.filter((channel) => channel !== 'unknown'));
export const WEB_TIERS = WEB_OBSERVABILITY_SCHEMA.values.tier;
const WEB_LATENCY_BUCKETS = WEB_OBSERVABILITY_SCHEMA.values.latencyBucket;
const WEB_SAMPLING_VALUES = WEB_OBSERVABILITY_SCHEMA.values.sampling;
const WEB_OUTCOME_SET = new Set(WEB_OUTCOMES);
const WEB_CHANNEL_SET = new Set(WEB_CHANNELS);
const WEB_TIER_SET = new Set(WEB_TIERS);
export const AGGREGATE_TTL_SECONDS = 7200;
export const OBSERVER_BUDGET_MS = 50;
const AGGREGATE_TIER_SET = new Set(WEB_TIERS.filter((tier) => tier !== 'unknown'));
const AGGREGATE_LATENCY_BUCKET_SET = new Set(WEB_LATENCY_BUCKETS.filter((bucket) => bucket !== 'unknown'));

/** Bucket a legacy latency (ms) into a coarse band. */
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
 * Build a sanitized legacy rewrite metric. Extra keys are deliberately ignored.
 * @param {{route?:string, tier?:string, provider?:string, model?:string, status?:number, latencyMs?:number, quotaDecision?:string, charCount?:number, outcome?:string}} [input]
 */
export function buildRewriteMetric({ route = '/api/rewrite', tier, provider, model, status, latencyMs, quotaDecision, charCount, outcome } = {}) {
  return {
    route: String(route),
    tier: tier === 'free' || tier === 'byok' || tier === 'pro' ? tier : 'unknown',
    provider: provider ? String(provider) : 'unknown',
    model: model ? String(model) : 'unknown',
    status: Number.isFinite(Number(status)) ? Number(status) : 0,
    latencyBucket: latencyBucket(latencyMs),
    quotaDecision: quotaDecision ? String(quotaDecision) : 'n/a',
    charBucket: charBucket(charCount),
    outcome: OUTCOME_VALUES.has(String(outcome)) ? String(outcome) : 'n/a',
  };
}

/** Defense-in-depth sanitizer for the legacy metric shape. */
export function sanitizeMetric(metric) {
  /** @type {Record<string, unknown>} */
  const out = {};
  const src = metric && typeof metric === 'object' ? metric : {};
  for (const key of METRIC_FIELDS) {
    if (key in src) out[key] = /** @type {any} */ (src)[key];
  }
  return out;
}

/** @param {unknown} ms */
export function monitorLatencyBucket(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return 'unknown';
  if (n <= 30_000) return '<=30s';
  if (n <= 60_000) return '30-60s';
  if (n <= 120_000) return '60-120s';
  return '>120s';
}

/** @param {unknown} status */
export function statusClass(status) {
  const n = Number(status);
  if (!Number.isInteger(n) || n < 100 || n > 599) return 'unknown';
  return `${Math.floor(n / 100)}xx`;
}

/** @param {Date|number|string} value */
export function utcQuarterStart(value) {
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  if (!Number.isFinite(ms)) return null;
  return new Date(Math.floor(ms / 900_000) * 900_000).toISOString()
    .slice(0, 16)
    .replace(/[-:]/g, '') + 'Z';
}

/** @param {{channel?:unknown, tier?:unknown, outcome?:unknown, latencyMs?:unknown, status?:unknown, sampling?:unknown}} [input] */
export function buildWebObservabilityEvent(input = {}) {
  const channel = typeof input.channel === 'string' && WEB_CHANNEL_SET.has(input.channel) ? input.channel : 'unknown';
  const tier = typeof input.tier === 'string' && WEB_TIER_SET.has(input.tier) ? input.tier : 'unknown';
  const outcome = typeof input.outcome === 'string' && WEB_OUTCOME_SET.has(input.outcome) ? input.outcome : 'unknown';
  const sampling = input.sampling === WEB_SAMPLING_VALUES[1] ? WEB_SAMPLING_VALUES[1] : WEB_SAMPLING_VALUES[0];
  return {
    schemaVersion: WEB_OBSERVABILITY_SCHEMA.schemaVersion,
    schema: WEB_OBSERVABILITY_SCHEMA.schema,
    channel,
    evidenceClass: WEB_OBSERVABILITY_SCHEMA.values.evidenceClass[0],
    tier,
    outcome,
    latencyBucket: monitorLatencyBucket(input.latencyMs),
    statusClass: statusClass(input.status),
    sampling,
  };
}

/** @param {Record<string, unknown>} event */
export function sanitizeWebObservabilityEvent(event) {
  return buildWebObservabilityEvent(event);
}

/**
 * Produce the sole aggregate namespace. Invalid channels are rejected rather
 * than silently mixing staging and production counters.
 * @param {{channel?:unknown, tier?:unknown, outcome?:unknown, latencyBucket?:unknown}} event
 * @param {Date|number|string} now
 */
export function buildAggregateKey(event, now = new Date()) {
  const { channel, tier, outcome } = event;
  if (typeof channel !== 'string' || typeof tier !== 'string' || typeof outcome !== 'string'
    || !WEB_CHANNEL_SET.has(channel) || !AGGREGATE_TIER_SET.has(tier) || !WEB_OUTCOME_SET.has(outcome)) return null;
  const quarter = utcQuarterStart(now);
  const bucket = event.latencyBucket;
  if (!quarter || !AGGREGATE_LATENCY_BUCKET_SET.has(String(bucket))) return null;
  return `patina:mon:v1:${channel}:${tier}:${quarter}:${outcome}:${bucket}`;
}

/** Creates an injectable process-local monotonic sampler. */
export function createSamplingCounter() {
  let count = 0;
  return () => {
    count += 1;
    return count % 20 === 0;
  };
}
const defaultSample = createSamplingCounter();

/** @param {unknown} logger @param {Record<string, unknown>} event */
function emitLog(logger, event) {
  try {
    const result = typeof logger === 'function'
      ? logger(event)
      : logger && typeof /** @type {any} */ (logger).info === 'function'
        ? /** @type {any} */ (logger).info(event)
        : undefined;
    if (result && typeof /** @type {any} */ (result).catch === 'function') /** @type {Promise<unknown>} */ (result).catch(() => {});
  } catch {
    // Logging cannot alter the rewrite result or aggregate delivery.
  }
}

/**
 * Creates a nonblocking fan-out observer. The KV adapter contract is
 * increment(key, { ttlSeconds }) and must be an atomic integer increment.
 * Event channel is owned by this factory and intentionally cannot be supplied
 * to observe(), preventing staging/production counter contamination.
 * @param {{channel: 'production'|'staging', logger?: unknown, kv?: {increment: (key:string, options:{ttlSeconds:number}) => unknown}, now?: () => Date|number|string, setTimer?: typeof setTimeout, clearTimer?: typeof clearTimeout, sample?: () => boolean}} options
 */
export function createWebObserver(options) {
  const channel = options && WEB_CHANNEL_SET.has(options.channel) ? options.channel : null;
  const logger = options && options.logger;
  const kv = options && options.kv;
  const now = options && options.now ? options.now : () => new Date();
  const setTimer = options && options.setTimer ? options.setTimer : setTimeout;
  const clearTimer = options && options.clearTimer ? options.clearTimer : clearTimeout;
  const sample = options && options.sample ? options.sample : defaultSample;

  /** @param {{tier?:unknown, outcome?:unknown, latencyMs?:unknown, status?:unknown}} [input] */
  function observe(input = {}) {
    const event = buildWebObservabilityEvent({ ...input, channel });
    const lowTierSuccess = event.outcome === 'completed' && (event.tier === 'free' || event.tier === 'byok');
    let selected = true;
    try {
      if (lowTierSuccess) selected = sample();
    } catch {
      emitLog(logger, { ...event, outcome: 'monitor_drop' });
      return event;
    }
    if (lowTierSuccess && !selected) return { ...event, sampling: 'sampled_1_of_20' };
    const emitted = lowTierSuccess ? { ...event, sampling: 'sampled_1_of_20' } : event;
    emitLog(logger, emitted);
    if (!channel) return emitted;
    if (!kv || typeof kv.increment !== 'function') {
      emitLog(logger, { ...emitted, outcome: 'monitor_drop', sampling: 'full' });
      return emitted;
    }

    let key;
    try {
      key = buildAggregateKey(emitted, now());
    } catch {
      emitLog(logger, { ...emitted, outcome: 'monitor_drop', sampling: 'full' });
      return emitted;
    }
    if (!key) return emitted;
    let settled = false;
    const drop = () => {
      if (settled) return;
      settled = true;
      emitLog(logger, { ...emitted, outcome: 'monitor_drop', sampling: 'full' });
    };
    let timer;
    try {
      timer = setTimer(drop, OBSERVER_BUDGET_MS);
      Promise.resolve(kv.increment(key, { ttlSeconds: AGGREGATE_TTL_SECONDS })).then(
        () => { if (!settled) { settled = true; clearTimer(timer); } },
        () => { clearTimer(timer); drop(); },
      );
    } catch {
      if (timer !== undefined) clearTimer(timer);
      drop();
    }
    return emitted;
  }

  return Object.freeze({ observe });
}
