// @ts-check
// Aggregate-only log-query core for the external Pro monitor service.
//
// This module is deliberately dependency-free and side-effect-free. It turns
// Vercel log-drain deliveries into closed per-quarter outcome counters and
// answers the monitor's aggregate query with the exact integer shapes that
// `api/pro-monitor.js#parseAggregate` accepts. Raw log text, identifiers, and
// any non-closed dimension are dropped at the parsing boundary and never
// stored or returned.

export const LOGQ_KEY_PREFIX = 'patina:logq:v1';
export const LOGQ_TTL_SECONDS = 7200;

export const LOGQ_CHANNELS = Object.freeze(['production', 'staging']);
export const LOGQ_TIERS = Object.freeze(['free', 'byok', 'pro']);
export const LOGQ_OUTCOMES = Object.freeze([
  'completed', 'terminal_failed', 'number_safety_failed', 'entitlement_denied',
  'entitlement_unavailable', 'quota_denied', 'service_disabled', 'monitor_drop',
]);

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

/**
 * Extract closed patina.web.v1 events from one log message. Handles both
 * JSON-serialized events and Node's `console.info(object)` inspect rendering
 * (single-quoted keys/values, arbitrary whitespace). Only the closed
 * channel/tier/outcome dimensions are read; everything else in the message is
 * ignored and never returned.
 * @param {unknown} message
 * @returns {Array<{channel: string, tier: string, outcome: string}>}
 */
export function extractWebEvents(message) {
  if (typeof message !== 'string' || message.length === 0 || message.length > 65536) return [];
  if (!message.includes('patina.web.v1')) return [];
  const events = [];
  const pattern = /schema['"]?\s*:\s*['"]patina\.web\.v1['"][\s\S]{0,600}?sampling['"]?\s*:\s*['"](?:full|sampled_1_of_20)['"]/g;
  const segments = message.match(pattern) ?? [];
  for (const segment of segments) {
    const channel = segment.match(/channel['"]?\s*:\s*['"]([a-z_]+)['"]/)?.[1];
    const tier = segment.match(/tier['"]?\s*:\s*['"]([a-z_]+)['"]/)?.[1];
    const outcome = segment.match(/outcome['"]?\s*:\s*['"]([a-z_]+)['"]/)?.[1];
    const evidenceClass = segment.match(/evidenceClass['"]?\s*:\s*['"]([a-z_]+)['"]/)?.[1];
    if (evidenceClass !== 'aggregate_only') continue;
    if (!channel || !tier || !outcome) continue;
    if (!LOGQ_CHANNELS.includes(channel) || !LOGQ_TIERS.includes(tier) || !LOGQ_OUTCOMES.includes(outcome)) continue;
    events.push({ channel, tier, outcome });
  }
  return events;
}

/**
 * Parse one Vercel log-drain delivery body (JSON array or NDJSON) into closed
 * counter increments keyed by quarter. Entries without a parseable
 * patina.web.v1 event are dropped. Timestamps outside the retention horizon
 * (TTL) are dropped rather than resurrecting expired quarters.
 * @param {string} body
 * @param {{now?: number}} [options]
 * @returns {Array<{key: string, count: number}>}
 */
export function parseDrainDelivery(body, { now = Date.now() } = {}) {
  if (typeof body !== 'string' || body.length === 0) return [];
  /** @type {unknown[]} */
  let entries = [];
  const trimmed = body.trim();
  if (trimmed.startsWith('[')) {
    try { const parsed = JSON.parse(trimmed); entries = Array.isArray(parsed) ? parsed : []; } catch { entries = []; }
  } else {
    for (const line of trimmed.split('\n')) {
      const candidate = line.trim();
      if (!candidate) continue;
      try { entries.push(JSON.parse(candidate)); } catch { /* skip malformed line */ }
    }
  }
  /** @type {Map<string, number>} */
  const counts = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const { message, timestamp } = /** @type {{message?: unknown, timestamp?: unknown}} */ (entry);
    const time = Number(timestamp);
    const at = Number.isFinite(time) && time > 0 ? time : now;
    if (now - at > LOGQ_TTL_SECONDS * 1000 || at - now > QUARTER_MS) continue;
    for (const event of extractWebEvents(message)) {
      const key = logqKey({ channel: event.channel, tier: event.tier, bucket: utc15mBucket(at), outcome: event.outcome });
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([key, count]) => ({ key, count }));
}

/**
 * Answer the monitor query with the exact closed shape for the window.
 * @param {{channel: string, tier: string, window: '15m'|'30m', readCounter: (key: string) => Promise<unknown>, now?: number}} input
 */
export async function answerQuery({ channel, tier, window, readCounter, now = Date.now() }) {
  if (!LOGQ_CHANNELS.includes(channel)) throw new TypeError('channel must be a closed drain channel');
  if (tier !== 'pro') throw new TypeError('tier must be "pro"');
  if (window !== '15m' && window !== '30m') throw new TypeError('window must be "15m" or "30m"');
  if (typeof readCounter !== 'function') throw new TypeError('readCounter is required');
  const buckets = windowBuckets(window, now);
  /** @param {readonly string[]} outcomes */
  const sum = async (outcomes) => {
    let total = 0;
    for (const bucket of buckets) {
      for (const outcome of outcomes) {
        const value = Number(await readCounter(logqKey({ channel, tier, bucket, outcome })));
        if (Number.isFinite(value) && value > 0) total += Math.floor(value);
      }
    }
    if (!Number.isSafeInteger(total) || total < 0) throw new Error('counter overflow');
    return total;
  };
  if (window === '30m') return { monitorDrop: await sum(['monitor_drop']) };
  return {
    numberSafety: await sum(['number_safety_failed']),
    entitlementNonOk: await sum(ENTITLEMENT_NON_OK),
    entitlementTotal: await sum(ENTITLEMENT_TOTAL),
  };
}
