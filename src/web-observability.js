// @ts-check
// Private, aggregate-only observability for the web rewrite surface. Observers
// emit only a closed schema and never receive request content or credentials.

/** Canonical closed descriptor for every patina.web.v2 event. */
export const WEB_OBSERVABILITY_SCHEMA = Object.freeze({
  schemaVersion: 'v2',
  schema: 'patina.web.v2',
  fields: Object.freeze([
    'schemaVersion', 'schema', 'channel', 'evidenceClass', 'tier', 'outcome', 'latencyBucket', 'statusClass', 'sampling',
    'tokenBucket', 'llmCalls',
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
    // Cost buckets: the margin model assumes 3 LLM calls per paid request, and
    // number-safety, transport or schema retries push a request above that.
    // Coarse buckets only — never raw tokens per call.
    tokenBucket: Object.freeze(['0', '1-2k', '2k-10k', '10k-30k', '30k-60k', '>60k', 'unknown']),
    llmCalls: Object.freeze(['1', '2', '3', '4', '5+', 'unknown']),
  }),
});

const { values } = WEB_OBSERVABILITY_SCHEMA;
const WEB_SAMPLING_VALUES = values.sampling;
const WEB_OUTCOME_SET = new Set(values.outcome);
const WEB_CHANNEL_SET = new Set(values.channel.filter((channel) => channel !== 'unknown'));
const WEB_TIER_SET = new Set(values.tier);
export const AGGREGATE_TTL_SECONDS = 7200;
const OBSERVER_BUDGET_MS = 50;
const AGGREGATE_TIER_SET = new Set(values.tier.filter((tier) => tier !== 'unknown'));
const AGGREGATE_LATENCY_BUCKET_SET = new Set(values.latencyBucket.filter((bucket) => bucket !== 'unknown'));

/**
 * Start a stopwatch on an injectable telemetry clock. The returned function
 * gives the elapsed milliseconds, or undefined when a clock read fails, so a
 * broken clock never reports an epoch-sized latency.
 *
 * @param {() => unknown} now
 * @returns {() => number|undefined}
 */
export function startTelemetryClock(now) {
  const read = () => {
    try {
      const value = Number(now());
      return Number.isFinite(value) ? value : undefined;
    } catch {
      return undefined;
    }
  };
  const startedAt = read();
  return () => {
    if (startedAt === undefined) return undefined;
    const endedAt = read();
    return endedAt === undefined ? undefined : Math.max(0, endedAt - startedAt);
  };
}

/**
 * Hand one event to a telemetry sink. Telemetry must never alter a customer
 * response, so a throw or a rejected promise from the sink is absorbed.
 *
 * @param {Function} observe
 * @param {Record<string, unknown>} event
 */
export function emitTelemetry(observe, event) {
  try {
    const result = observe(event);
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch {
    // Absorbed: see above.
  }
}

/** @param {unknown} ms */
function monitorLatencyBucket(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n < 0) return 'unknown';
  if (n <= 30_000) return '<=30s';
  if (n <= 60_000) return '30-60s';
  if (n <= 120_000) return '60-120s';
  return '>120s';
}

/** @param {unknown} status */
function statusClass(status) {
  const n = Number(status);
  if (!Number.isInteger(n) || n < 100 || n > 599) return 'unknown';
  return `${Math.floor(n / 100)}xx`;
}

/**
 * Bucket a request's TOTAL LLM token usage (all attempts, all stages) into a
 * coarse band for cost observability. Aggregates only — the bucket never
 * carries per-call tokens or any content.
 * @param {unknown} totalTokens
 */
function tokenBucket(totalTokens) {
  if (typeof totalTokens !== 'number' || !Number.isSafeInteger(totalTokens) || totalTokens < 0) return 'unknown';
  const n = totalTokens;
  if (n === 0) return '0';
  if (n < 2_000) return '1-2k';
  if (n < 10_000) return '2k-10k';
  if (n < 30_000) return '10k-30k';
  if (n < 60_000) return '30k-60k';
  return '>60k';
}

/**
 * Bucket the number of paid LLM transport calls a request spent (all attempts
 * in rewrite and scoring). The margin model assumes 3; anything above says a
 * number-safety, schema, or transport retry fired.
 * @param {unknown} calls
 */
function llmCallsBucket(calls) {
  if (typeof calls !== 'number' || !Number.isSafeInteger(calls) || calls < 1) return 'unknown';
  const n = calls;
  return n >= 5 ? '5+' : String(n);
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

/** @param {{channel?:unknown, tier?:unknown, outcome?:unknown, latencyMs?:unknown, latencyBucket?:unknown, status?:unknown, statusClass?:unknown, sampling?:unknown, totalTokens?:unknown, tokenBucket?:unknown, llmCalls?:unknown}} [input] */
export function buildWebObservabilityEvent(input = {}) {
  const channel = typeof input.channel === 'string' && WEB_CHANNEL_SET.has(input.channel) ? input.channel : 'unknown';
  const tier = typeof input.tier === 'string' && WEB_TIER_SET.has(input.tier) ? input.tier : 'unknown';
  const outcome = typeof input.outcome === 'string' && WEB_OUTCOME_SET.has(input.outcome) ? input.outcome : 'unknown';
  const sampling = input.sampling === WEB_SAMPLING_VALUES[1] ? WEB_SAMPLING_VALUES[1] : WEB_SAMPLING_VALUES[0];
  const inputTokenBucket = typeof input.tokenBucket === 'string'
    && WEB_OBSERVABILITY_SCHEMA.values.tokenBucket.includes(input.tokenBucket)
    ? input.tokenBucket
    : null;
  const inputLlmCalls = typeof input.llmCalls === 'string'
    && WEB_OBSERVABILITY_SCHEMA.values.llmCalls.includes(input.llmCalls)
    ? input.llmCalls
    : null;
  return {
    schemaVersion: WEB_OBSERVABILITY_SCHEMA.schemaVersion,
    schema: WEB_OBSERVABILITY_SCHEMA.schema,
    channel,
    evidenceClass: WEB_OBSERVABILITY_SCHEMA.values.evidenceClass[0],
    tier,
    outcome,
    latencyBucket: typeof input.latencyBucket === 'string'
      && WEB_OBSERVABILITY_SCHEMA.values.latencyBucket.includes(input.latencyBucket)
      ? input.latencyBucket
      : monitorLatencyBucket(input.latencyMs),
    statusClass: typeof input.statusClass === 'string'
      && WEB_OBSERVABILITY_SCHEMA.values.statusClass.includes(input.statusClass)
      ? input.statusClass
      : statusClass(input.status),
    sampling,
    tokenBucket: inputTokenBucket ?? tokenBucket(input.totalTokens),
    llmCalls: inputLlmCalls ?? llmCallsBucket(input.llmCalls),
  };
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

/** Process-local 1-in-20 sampler for low-tier successes. */
let sampleCount = 0;
function defaultSample() {
  sampleCount += 1;
  return sampleCount % 20 === 0;
}

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

  return { observe };
}
