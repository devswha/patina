// @ts-check
// Aggregate-only log-query core for the external Pro monitor service.
//
// This module is deliberately dependency-free and side-effect-free. It turns
// Vercel log-drain deliveries into closed per-quarter outcome counters and
// answers the monitor's aggregate query with the exact integer shapes that
// `api/pro-monitor.js#parseAggregate` accepts. Raw log text, identifiers, and
// any non-closed dimension are dropped at the parsing boundary and never
// stored or returned. Every ambiguity is a rejection, never a guess: a
// malformed delivery, timestamp, or persisted counter fails the request so
// the monitor observes `log_unavailable` instead of a fabricated count.

export const LOGQ_KEY_PREFIX = 'patina:logq:v1';
export const LOGQ_TTL_SECONDS = 7200;

export const LOGQ_CHANNELS = Object.freeze(['production', 'staging']);
export const LOGQ_TIERS = Object.freeze(['free', 'byok', 'pro']);
export const LOGQ_OUTCOMES = Object.freeze([
  'completed', 'terminal_failed', 'number_safety_failed', 'entitlement_denied',
  'entitlement_unavailable', 'quota_denied', 'service_disabled', 'monitor_drop',
]);
const LATENCY_BUCKETS = ['<=30s', '30-60s', '60-120s', '>120s', 'unknown'];
const STATUS_CLASSES = ['1xx', '2xx', '3xx', '4xx', '5xx', 'unknown'];

const QUARTER_MS = 15 * 60 * 1000;
const WINDOW_MS = Object.freeze({ '15m': 15 * 60 * 1000, '30m': 30 * 60 * 1000 });

/** Outcomes that mean the entitlement boundary answered non-OK. */
const ENTITLEMENT_NON_OK = Object.freeze(['entitlement_denied', 'entitlement_unavailable']);
/**
 * Outcomes that prove a request reached (or was refused by) the entitlement
 * boundary. Every terminal request outcome participates; `monitor_drop` is a
 * telemetry-delivery signal, not a request, and is deliberately excluded.
 */
const ENTITLEMENT_TOTAL = Object.freeze([
  'completed', 'terminal_failed', 'number_safety_failed', 'entitlement_denied',
  'entitlement_unavailable', 'quota_denied', 'service_disabled',
]);

/** @param {Date|number} value */
function asTime(value) {
  const time = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(time)) throw new TypeError('A valid clock value is required');
  return time;
}

/** UTC start of the enclosing 15-minute quarter, compact form (YYYYMMDDTHHmmZ). */
export function utc15mBucket(value = Date.now()) {
  const start = Math.floor(asTime(value) / QUARTER_MS) * QUARTER_MS;
  return new Date(start).toISOString().slice(0, 16).replace(/[-:]/g, '') + 'Z';
}

/**
 * Quarter buckets whose end lies strictly after `now - window`, plus the
 * current quarter — mirrors the monitor's overlapping-quarter selection.
 * @param {'15m'|'30m'} window
 * @param {Date|number} [now]
 */
export function windowBuckets(window, now = Date.now()) {
  const windowMs = WINDOW_MS[window];
  if (!windowMs) throw new TypeError('window must be "15m" or "30m"');
  const time = asTime(now);
  const current = Math.floor(time / QUARTER_MS) * QUARTER_MS;
  const cutoff = time - windowMs;
  const buckets = [];
  for (let start = current - Math.ceil(windowMs / QUARTER_MS) * QUARTER_MS; start <= current; start += QUARTER_MS) {
    if (start + QUARTER_MS > cutoff) buckets.push(utc15mBucket(start));
  }
  return buckets;
}

/** The only counter key shape this service reads or writes. */
export function logqKey({ channel, tier, bucket, outcome }) {
  if (!LOGQ_CHANNELS.includes(channel)) throw new TypeError('channel must be a closed drain channel');
  if (!LOGQ_TIERS.includes(tier)) throw new TypeError('tier must be a closed drain tier');
  if (!LOGQ_OUTCOMES.includes(outcome)) throw new TypeError('outcome must be a closed drain outcome');
  if (typeof bucket !== 'string' || !/^\d{8}T\d{4}Z$/.test(bucket)) throw new TypeError('bucket must be a compact UTC quarter');
  return `${LOGQ_KEY_PREFIX}:${channel}:${tier}:${bucket}:${outcome}`;
}

// One event pattern for both renderings emitLog produces: JSON.stringify
// (`"schema":"patina.web.v1"`) and Node console-inspect (`schema: 'patina...'`).
// Both preserve buildWebObservabilityEvent's insertion order, so the full
// nine-field envelope is required in canonical order with boundary guards.
// A fragment that omits any field, reorders fields, or glues an event name
// onto another identifier is rejected rather than counted.
const FIELD = (name, values) => `[{,\\s"']${name}["']?\\s*:\\s*["'](${values})["']\\s*`;
const EVENT_PATTERN = new RegExp(
  FIELD('schemaVersion', 'v1') + ',?\\s*'
  + FIELD('schema', 'patina\\.web\\.v1') + ',?\\s*'
  + FIELD('channel', '[a-z_]+') + ',?\\s*'
  + FIELD('evidenceClass', 'aggregate_only') + ',?\\s*'
  + FIELD('tier', '[a-z_]+') + ',?\\s*'
  + FIELD('outcome', '[a-z_]+') + ',?\\s*'
  + FIELD('latencyBucket', LATENCY_BUCKETS.map((b) => b.replace(/[<>=-]/g, '\\$&')).join('|')) + ',?\\s*'
  + FIELD('statusClass', STATUS_CLASSES.join('|')) + ',?\\s*'
  + FIELD('sampling', 'full|sampled_1_of_20'),
  'g',
);

/**
 * Extract closed patina.web.v1 events from one log message. Only complete
 * nine-field envelopes in canonical order are accepted; only the closed
 * channel/tier/outcome dimensions are returned. Everything else in the
 * message is ignored and never returned.
 * @param {unknown} message
 * @returns {Array<{channel: string, tier: string, outcome: string}>}
 */
export function extractWebEvents(message) {
  if (typeof message !== 'string' || message.length === 0 || message.length > 65536) return [];
  if (!message.includes('patina.web.v1')) return [];
  const events = [];
  EVENT_PATTERN.lastIndex = 0;
  let match;
  while ((match = EVENT_PATTERN.exec(message)) !== null) {
    const [, , , channel, , tier, outcome] = match;
    if (!LOGQ_CHANNELS.includes(channel) || !LOGQ_TIERS.includes(tier) || !LOGQ_OUTCOMES.includes(outcome)) continue;
    events.push({ channel, tier, outcome });
  }
  return events;
}

/**
 * Parse one Vercel log-drain delivery body (JSON array or NDJSON) into closed
 * counter increments keyed by quarter. Fail-closed: a malformed body, a
 * malformed NDJSON line, a non-object entry, or an event-bearing entry
 * without a valid finite timestamp rejects the whole delivery so the drain
 * redelivers instead of silently losing evidence. Event-bearing entries with
 * valid timestamps outside the retention horizon are explicitly dropped
 * (expired quarters are never resurrected).
 * @param {string} body
 * @param {{now?: number}} [options]
 * @returns {{ok: true, increments: Array<{key: string, count: number}>} | {ok: false, reason: string}}
 */
export function parseDrainDelivery(body, { now = Date.now() } = {}) {
  if (typeof body !== 'string' || body.length === 0) return { ok: false, reason: 'empty_body' };
  /** @type {unknown[]} */
  let entries = [];
  const trimmed = body.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) return { ok: false, reason: 'not_an_array' };
      entries = parsed;
    } catch { return { ok: false, reason: 'malformed_json' }; }
  } else {
    for (const line of trimmed.split('\n')) {
      const candidate = line.trim();
      if (!candidate) continue;
      try { entries.push(JSON.parse(candidate)); } catch { return { ok: false, reason: 'malformed_ndjson_line' }; }
    }
  }
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return { ok: false, reason: 'malformed_entry' };
    const { message, timestamp } = /** @type {{message?: unknown, timestamp?: unknown}} */ (entry);
    const events = extractWebEvents(message);
    if (events.length === 0) continue;
    const time = typeof timestamp === 'number' ? timestamp : NaN;
    if (!Number.isSafeInteger(time) || time <= 0) return { ok: false, reason: 'invalid_event_timestamp' };
    if (now - time > LOGQ_TTL_SECONDS * 1000 || time - now > QUARTER_MS) continue;
    for (const event of events) {
      const key = logqKey({ channel: event.channel, tier: event.tier, bucket: utc15mBucket(time), outcome: event.outcome });
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return { ok: true, increments: [...counts.entries()].map(([key, count]) => ({ key, count })) };
}

/**
 * Strictly interpret one persisted counter value. Only absence (null) means
 * zero; every present value must be a canonical non-negative safe integer.
 * @param {unknown} value
 */
export function strictCounterValue(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('malformed_counter');
    return value;
  }
  if (typeof value === 'string') {
    if (!/^(0|[1-9]\d*)$/.test(value)) throw new Error('malformed_counter');
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) throw new Error('malformed_counter');
    return parsed;
  }
  throw new Error('malformed_counter');
}

/**
 * Answer the monitor query with the exact closed shape for the window. All
 * counters for the window are read in ONE snapshot via `readCounters(keys)`
 * and validated strictly; any malformed persisted value throws so the caller
 * answers 503 instead of a fabricated count.
 * @param {{channel: string, tier: string, window: '15m'|'30m', readCounters: (keys: string[]) => Promise<unknown[]>, now?: number}} input
 */
export async function answerQuery({ channel, tier, window, readCounters, now = Date.now() }) {
  if (!LOGQ_CHANNELS.includes(channel)) throw new TypeError('channel must be a closed drain channel');
  if (tier !== 'pro') throw new TypeError('tier must be "pro"');
  if (window !== '15m' && window !== '30m') throw new TypeError('window must be "15m" or "30m"');
  if (typeof readCounters !== 'function') throw new TypeError('readCounters is required');
  const buckets = windowBuckets(window, now);
  const outcomes = window === '30m' ? ['monitor_drop'] : [...new Set([...ENTITLEMENT_TOTAL, 'number_safety_failed'])];
  const keys = [];
  for (const bucket of buckets) for (const outcome of outcomes) keys.push(logqKey({ channel, tier, bucket, outcome }));
  const raw = await readCounters(keys);
  if (!Array.isArray(raw) || raw.length !== keys.length) throw new Error('snapshot_shape');
  /** @type {Map<string, number>} */
  const snapshot = new Map();
  for (let i = 0; i < keys.length; i += 1) snapshot.set(keys[i], strictCounterValue(raw[i]));
  /** @param {readonly string[]} wanted */
  const sum = (wanted) => {
    let total = 0;
    for (const bucket of buckets) for (const outcome of wanted) total += snapshot.get(logqKey({ channel, tier, bucket, outcome })) ?? 0;
    if (!Number.isSafeInteger(total) || total < 0) throw new Error('counter_overflow');
    return total;
  };
  if (window === '30m') return { monitorDrop: sum(['monitor_drop']) };
  return {
    numberSafety: sum(['number_safety_failed']),
    entitlementNonOk: sum(ENTITLEMENT_NON_OK),
    entitlementTotal: sum(ENTITLEMENT_TOTAL),
  };
}
