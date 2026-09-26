/** Private, aggregate-only health monitor for the hosted rewrite path. */
import { timingSafeEqual } from 'node:crypto';
import { buildAggregateKey, utcQuarterStart, WEB_OBSERVABILITY_SCHEMA } from './web-observability.js';

const CONTROL_KEY_PREFIX = 'patina:monctl:v1';
const LATENCY_BUCKETS = WEB_OBSERVABILITY_SCHEMA.values.latencyBucket.filter((bucket) => bucket !== 'unknown');
// The web observer only logs `monitor_drop`; it never writes it to the
// aggregate store, so the snapshot does not read it.
const OBSERVED_OUTCOMES = WEB_OBSERVABILITY_SCHEMA.values.outcome.filter((outcome) => outcome !== 'monitor_drop');
const CHANNELS = ['staging', 'production'];
export const SYNTHETIC_TEXT = 'Patina monitor health check.';
const QUARTER_MS = 15 * 60 * 1000;
const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * ONE_HOUR_MS;
// The paid probe runs at most once per hour, and the failure streak is only
// persisted on a run that probed. Its TTL must therefore outlive the worst-case
// gap between two probes (60m budget + 15m cron tick + 55s deadline). Three
// intervals also survive one probe skipped by the blind-adapter guard, while
// still expiring after two consecutive misses so a stale streak cannot carry
// into a later incident.
const SYNTHETIC_PROBE_INTERVAL_MS = ONE_HOUR_MS;
const SYNTHETIC_STREAK_TTL_MS = 3 * SYNTHETIC_PROBE_INTERVAL_MS;
const SNAPSHOT_DEADLINE_MS = 30_000;
// Free and BYOK successful rewrites are emitted once per twenty requests.
// Failures remain census events, so their observed count is never expanded.
const LOW_TIER_SUCCESS_SAMPLE_SIZE = 20;
const RECEIPT_ID_PATTERN = /^[a-z0-9._-]+$/i;

function dimension(value, allowed) {
  return typeof value === 'string' && allowed.includes(value);
}

function asDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('A valid clock value is required');
  return date;
}

/** Parse a compact `YYYYMMDDTHHmmZ` quarter bucket, or null when it is not a real quarter start. */
function compactBucket(value) {
  if (typeof value !== 'string' || !/^\d{8}T\d{4}Z$/.test(value)) return null;
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:00.000Z`;
  const date = new Date(iso);
  return !Number.isNaN(date.getTime()) && date.toISOString() === iso && date.getUTCMinutes() % 15 === 0 ? date : null;
}

function bucketTime(value) {
  if (typeof value !== 'string') return asDate(value);
  const date = compactBucket(value);
  if (!date) throw new TypeError('A real UTC quarter-minute bucket is required');
  return date;
}

/** Return the UTC start of the enclosing fifteen-minute bucket. */
export function utc15mBucket(value = new Date()) {
  return utcQuarterStart(bucketTime(value));
}

/** Build the aggregate key the web observer writes, rejecting any open dimension. */
export function aggregateKey({ channel, tier, at = new Date(), outcome, latencyBucket }) {
  const key = buildAggregateKey({ channel, tier, outcome, latencyBucket }, bucketTime(at));
  if (!key) throw new TypeError('channel, tier, outcome and latencyBucket must be closed aggregate dimensions');
  return key;
}

function safeAdd(left, right) {
  return Number.isSafeInteger(left) && left >= 0 && Number.isSafeInteger(right) && right >= 0
    && left <= Number.MAX_SAFE_INTEGER - right
    ? left + right
    : null;
}

/** Conservative p95: the first latency bucket whose cumulative count reaches rank ceil(0.95 n). */
export function latencyHistogram(values = {}) {
  const counts = {};
  let n = 0;
  let overflow = false;
  for (const bucket of LATENCY_BUCKETS) {
    const count = Number(values[bucket]);
    counts[bucket] = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
    const next = safeAdd(n, counts[bucket]);
    if (next === null) overflow = true;
    else n = next;
  }
  if (overflow) {
    for (const bucket of LATENCY_BUCKETS) counts[bucket] = 0;
    n = 0;
  }
  const rank = n === 0 ? 0 : Math.ceil(n * 0.95);
  let cumulative = 0;
  let selectedBucket = null;
  for (const bucket of LATENCY_BUCKETS) {
    cumulative += counts[bucket];
    if (rank && cumulative >= rank) {
      selectedBucket = bucket;
      break;
    }
  }
  const upperBound = { '<=30s': '30s', '30-60s': '60s', '60-120s': '120s', '>120s': '>120s' }[selectedBucket] ?? null;
  return { counts, n, rank, selectedBucket, upperBound, over120Ratio: n ? counts['>120s'] / n : 0 };
}

/** Quarter buckets that overlap the trailing thirty minutes, oldest first. */
export function overlappingQuarterBuckets(now = new Date()) {
  const date = asDate(now);
  const current = Math.floor(date.getTime() / QUARTER_MS) * QUARTER_MS;
  const cutoff = date.getTime() - THIRTY_MINUTES_MS;
  const buckets = [];
  for (let start = current - 2 * QUARTER_MS; start <= current; start += QUARTER_MS) {
    if (start + QUARTER_MS > cutoff) buckets.push(utcQuarterStart(start));
  }
  return buckets;
}

/** Compare the cron bearer in constant time; a length mismatch is rejected before the compare. */
export function isCronAuthorized(authorization, expectedToken) {
  if (typeof expectedToken !== 'string' || expectedToken.length === 0 || typeof authorization !== 'string') return false;
  const provided = Buffer.from(authorization, 'utf8');
  const wanted = Buffer.from(`Bearer ${expectedToken}`, 'utf8');
  return provided.length === wanted.length && timingSafeEqual(provided, wanted);
}

function countBand(count) {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (n === 0) return '0';
  if (n === 1) return '1';
  if (n < 5) return '2-4';
  if (n < 10) return '5-9';
  if (n < 20) return '10-19';
  return '20+';
}

function safeEvidence(evidence = {}) {
  const output = {};
  for (const [key, value] of Object.entries(evidence)) {
    if (['ratioBand', 'latencyBound', 'rankBand', 'reason'].includes(key)
      && typeof value === 'string' && /^[a-z0-9><=._-]+$/i.test(value)) output[key] = value;
  }
  return output;
}

/** The only Discord payload shape: closed labels and a count band, never raw counts or content. */
export function discordPayload({ trigger, count = 0, window, channel, evidence }) {
  if (typeof trigger !== 'string' || !dimension(channel, CHANNELS) || typeof window !== 'string') {
    throw new TypeError('Discord alert dimensions must be aggregate-only');
  }
  return { trigger, countBand: countBand(count), window, channel, evidence: safeEvidence(evidence) };
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function snapshotCount(value) {
  if (value === null) return 0;
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value)) {
    const count = Number(value);
    return Number.isSafeInteger(count) ? count : null;
  }
  return null;
}

function persistedStreak(value) {
  if (value === undefined || value === null) return 0;
  return snapshotCount(value);
}

function activeReceiptIds(value) {
  if (value === undefined || value === null) return Object.freeze([]);
  if (!Array.isArray(value)) throw new Error('invalid active receipt state');
  const seen = new Set();
  for (const id of value) {
    if (typeof id !== 'string' || !RECEIPT_ID_PATTERN.test(id) || seen.has(id)) throw new Error('invalid active receipt state');
    seen.add(id);
  }
  return Object.freeze([...value]);
}

function requiredControl(store, method) {
  if (!store || typeof store[method] !== 'function') throw new TypeError(`controlStore must expose ${method}`);
  return store[method].bind(store);
}

async function acquire(store, key, value, ttl) {
  const result = await requiredControl(store, 'acquire')(key, value, ttl);
  if (result === true || result === false) return result;
  throw new Error('ambiguous control lease acquisition');
}

async function release(store, key, value) {
  if (await requiredControl(store, 'release')(key, value) !== true) throw new Error('control lease release failed');
}

function controlKey(channel, tier, suffix) {
  return `${CONTROL_KEY_PREFIX}:${channel}:${tier}:${suffix}`;
}

function snapshotMethod(reader) {
  if (reader && typeof reader.snapshot === 'function') return reader.snapshot.bind(reader);
  if (reader && typeof reader.mget === 'function') return (keys, options) => reader.mget(keys, options);
  throw new TypeError('aggregateReader must expose snapshot or mget');
}

/** Read every key in one snapshot; any missing or malformed counter makes the whole snapshot unavailable. */
async function aggregateSnapshot(reader, keys, deadlineMs) {
  let timer;
  try {
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('deadline')), deadlineMs); });
    const snapshot = await Promise.race([snapshotMethod(reader)(keys, { deadlineMs }), timeout]);
    if (!snapshot || (Array.isArray(snapshot) && snapshot.length !== keys.length)) throw new Error('incomplete');
    const values = Object.create(null);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      let present;
      let value;
      if (snapshot instanceof Map) {
        present = snapshot.has(key);
        value = snapshot.get(key);
      } else if (Array.isArray(snapshot)) {
        present = index in snapshot;
        value = snapshot[index];
      } else {
        present = Object.prototype.hasOwnProperty.call(snapshot, key);
        value = snapshot[key];
      }
      if (!present || value === undefined) throw new Error('invalid');
      const count = snapshotCount(value);
      if (count === null) throw new Error('invalid');
      values[key] = count;
    }
    return { available: true, values };
  } catch {
    return { available: false, values: Object.create(null) };
  } finally {
    clearTimeout(timer);
  }
}

/** Snapshot every outcome and latency counter for one channel and tier over the trailing thirty minutes. */
async function readAggregate({ channel, tier, now, aggregateReader, deadlineMs }) {
  const buckets = overlappingQuarterBuckets(now);
  const entries = [];
  for (const bucket of buckets) {
    for (const outcome of OBSERVED_OUTCOMES) {
      for (const latencyBucket of LATENCY_BUCKETS) {
        entries.push({ key: aggregateKey({ channel, tier, at: bucket, outcome, latencyBucket }), outcome, latencyBucket });
      }
    }
  }
  const budget = Math.max(1, Math.min(Number(deadlineMs) || SNAPSHOT_DEADLINE_MS, SNAPSHOT_DEADLINE_MS));
  const aggregate = await aggregateSnapshot(aggregateReader, entries.map(({ key }) => key), budget);
  return { buckets, entries, aggregate };
}

async function queryLogs(logQuery, channel, tier, window) {
  const expected = window === '15m' ? ['numberSafety', 'entitlementNonOk', 'entitlementTotal'] : ['monitorDrop'];
  try {
    const result = await logQuery({ channel, tier, window, aggregateOnly: true, readOnly: true });
    const values = result?.values && typeof result.values === 'object' && !Array.isArray(result.values) ? result.values : result;
    if (!values || typeof values !== 'object' || Array.isArray(values) || result.available === false
      || Object.keys(values).length !== expected.length
      || expected.some((key) => !Object.hasOwn(values, key) || !Number.isSafeInteger(values[key]) || values[key] < 0)) {
      return { available: false, values: {} };
    }
    return { available: true, values };
  } catch {
    return { available: false, values: {} };
  }
}

/** A delivery counts only as a 2xx that returns a safe Discord message id. */
async function sendWithRetry(send, payload, sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay))) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await send(payload);
      const status = typeof response === 'number' ? response : response?.status;
      const receiptId = response?.receiptId ?? response?.id;
      if (Number.isInteger(status) && status >= 200 && status < 300
        && typeof receiptId === 'string' && RECEIPT_ID_PATTERN.test(receiptId)) {
        return { ok: true, attempts: attempt, receiptId };
      }
    } catch {}
    if (attempt < 3) await sleep(attempt * 1000);
  }
  return { ok: false, attempts: 3 };
}

/**
 * Send each trigger to Discord at most once per hour per channel, tier and
 * trigger. A failed delivery releases its dedup lease so the next tick retries.
 * `onDelivered` runs while the lease is still held.
 */
async function deliverAlerts({ channel, tier, now, triggers, controlStore, discordSender, sleep, onDelivered }) {
  const alerts = [];
  for (const item of triggers) {
    const leaseKey = controlKey(channel, tier, `dedup:${item.trigger}`);
    const leaseValue = `${now.getTime()}-${item.trigger}`;
    if (!await acquire(controlStore, leaseKey, leaseValue, ONE_HOUR_MS)) {
      alerts.push({ trigger: item.trigger, sent: false, deduped: true });
      continue;
    }
    const delivered = await sendWithRetry(discordSender, discordPayload({ ...item, channel }), sleep);
    if (!delivered.ok) {
      await release(controlStore, leaseKey, leaseValue);
      alerts.push({ trigger: item.trigger, sent: false, attempts: delivered.attempts });
      continue;
    }
    if (onDelivered) await onDelivered(leaseKey, leaseValue, delivered.receiptId);
    alerts.push({ trigger: item.trigger, sent: true, attempts: delivered.attempts, receiptId: delivered.receiptId });
  }
  return alerts;
}

/** Evaluate Pro monitor signals without exposing customer data or raw collaborator errors. */
export async function evaluateProMonitor(deps) {
  const {
    channel = 'production', tier = 'pro', aggregateReader, logQuery, syntheticRequest, discordSender, controlStore,
    clock = () => new Date(), sleep, deadlineMs = SNAPSHOT_DEADLINE_MS,
  } = deps || {};
  if (!dimension(channel, CHANNELS) || !dimension(tier, ['free', 'byok', 'pro'])) {
    throw new TypeError('channel and tier are required closed dimensions');
  }
  const now = asDate(clock());
  const { buckets, entries, aggregate } = await readAggregate({ channel, tier, now, aggregateReader, deadlineMs });

  // Unknown classifications cannot establish a known production denominator.
  const histogramCounts = Object.fromEntries(LATENCY_BUCKETS.map((bucket) => [bucket, 0]));
  let productionAggregate = 0;
  let unknownAggregate = 0;
  let aggregateOverflow = false;
  if (aggregate.available) {
    for (const { key, outcome, latencyBucket } of entries) {
      const value = aggregate.values[key];
      if (outcome === 'unknown') unknownAggregate = safeAdd(unknownAggregate, value);
      else productionAggregate = safeAdd(productionAggregate, value);
      if (outcome === 'completed') histogramCounts[latencyBucket] = safeAdd(histogramCounts[latencyBucket], value);
      if (productionAggregate === null || unknownAggregate === null
        || Object.values(histogramCounts).some((count) => count === null)) {
        aggregateOverflow = true;
        break;
      }
    }
  }
  if (aggregateOverflow) {
    productionAggregate = 0;
    unknownAggregate = 0;
    for (const bucket of LATENCY_BUCKETS) histogramCounts[bucket] = 0;
  }
  const classificationUnavailable = productionAggregate > 0 && unknownAggregate > 0;
  if (classificationUnavailable) {
    productionAggregate = 0;
    for (const bucket of LATENCY_BUCKETS) histogramCounts[bucket] = 0;
  }
  const aggregateAvailable = aggregate.available && !aggregateOverflow;
  const histogram = latencyHistogram(histogramCounts);

  const safetyLogs = await queryLogs(logQuery, channel, tier, '15m');
  const dropLogs = await queryLogs(logQuery, channel, tier, '30m');
  const numberSafety = number(safetyLogs.values.numberSafety);
  const entitlementNonOk = number(safetyLogs.values.entitlementNonOk);
  const entitlementTotal = number(safetyLogs.values.entitlementTotal);
  const monitorDrop = number(dropLogs.values.monitorDrop);

  // The synthetic probe is a real paid rewrite. A run whose adapters are blind
  // can only end as monitor_blind + 503, so it skips the probe; otherwise the
  // probe is budgeted to one per hour. A skipped probe reports 'failed' but
  // neither grows nor resets the persisted streak, so it can never fabricate
  // a synthetic_failure alert.
  const adaptersBlind = !aggregateAvailable || !safetyLogs.available || !dropLogs.available;
  let syntheticTerminal = 'failed';
  let syntheticRan = false;
  if (!adaptersBlind && await acquire(controlStore, controlKey(channel, tier, 'synthetic-probe-budget'), `${now.getTime()}`, SYNTHETIC_PROBE_INTERVAL_MS)) {
    syntheticRan = true;
    try {
      const response = await syntheticRequest({ channel, tier, text: SYNTHETIC_TEXT, timeoutMs: 60_000 });
      syntheticTerminal = response?.terminal === 'done' && response?.ok === true ? 'done' : 'failed';
    } catch {}
  }
  const streakKey = controlKey(channel, tier, 'synthetic-streak');
  const previousStreak = persistedStreak(await requiredControl(controlStore, 'get')(streakKey));
  if (previousStreak === null) throw new Error('invalid synthetic streak state');
  if (syntheticRan && syntheticTerminal !== 'done' && previousStreak === Number.MAX_SAFE_INTEGER) {
    throw new Error('synthetic streak overflow');
  }
  const syntheticStreak = syntheticRan ? (syntheticTerminal === 'done' ? 0 : previousStreak + 1) : previousStreak;
  if (syntheticRan && await requiredControl(controlStore, 'set')(streakKey, syntheticStreak, SYNTHETIC_STREAK_TTL_MS) !== true) {
    throw new Error('synthetic streak persistence failed');
  }

  const triggers = [];
  if (numberSafety >= 1) triggers.push({ trigger: 'number_safety', count: numberSafety, window: '15m' });
  if (entitlementTotal >= 20 && entitlementNonOk >= 5) triggers.push({ trigger: 'entitlement_pro', count: entitlementNonOk, window: '15m' });
  // `window` is the probe cadence: the count is consecutive failed hourly probes.
  if (syntheticStreak >= 3) triggers.push({ trigger: 'synthetic_failure', count: syntheticStreak, window: '1h' });
  if (histogram.n >= 10 && histogram.selectedBucket === '>120s') {
    triggers.push({ trigger: 'p95_latency', count: histogram.n, window: '30m', evidence: { latencyBound: '>120s', rankBand: 'p95' } });
  }
  if (histogram.n >= 10 && histogram.over120Ratio > 0.05) {
    triggers.push({ trigger: 'latency_tail', count: histogram.counts['>120s'], window: '30m', evidence: { ratioBand: '>5pct' } });
  }
  if (adaptersBlind || productionAggregate === 0 || monitorDrop >= 3) {
    const unavailable = !aggregate.available || !safetyLogs.available || !dropLogs.available;
    let reason;
    if (!aggregateAvailable) reason = aggregateOverflow ? 'aggregate_overflow' : 'aggregate_unavailable';
    else if (!safetyLogs.available || !dropLogs.available) reason = 'log_unavailable';
    else if (monitorDrop >= 3) reason = 'monitor_drop';
    else if (classificationUnavailable) reason = 'aggregate_classification_unavailable';
    else if (unknownAggregate > 0) reason = 'unknown_aggregate';
    else reason = 'no_production_aggregate';
    // The count stays the log-derived drop count; unknown classifications are
    // reported through the reason only.
    triggers.push({ trigger: 'monitor_blind', count: unavailable ? 1 : monitorDrop, window: '30m', evidence: { reason } });
  }

  // A delivered alert joins the active list, which the recovery message links.
  const activeKey = controlKey(channel, tier, 'active');
  const alerts = await deliverAlerts({
    channel, tier, now, triggers, controlStore, discordSender, sleep,
    onDelivered: async (leaseKey, leaseValue, receiptId) => {
      const acknowledged = await requiredControl(controlStore, 'acknowledge')(leaseKey, leaseValue, activeKey, receiptId, TWO_HOURS_MS);
      if (acknowledged !== true) throw new Error('alert acknowledgement failed');
    },
  });

  let recovery = null;
  if (!triggers.length) {
    const active = activeReceiptIds(await requiredControl(controlStore, 'get')(activeKey));
    const recoveryKey = controlKey(channel, tier, 'recovery');
    const recoveryValue = `${now.getTime()}-recovery`;
    if (active.length && await acquire(controlStore, recoveryKey, recoveryValue, ONE_HOUR_MS)) {
      const delivered = await sendWithRetry(discordSender, discordPayload({
        trigger: 'monitor_recovered', count: active.length, window: '30m', channel, evidence: { reason: 'recovered' },
      }), sleep);
      if (!delivered.ok) {
        await release(controlStore, recoveryKey, recoveryValue);
      } else {
        recovery = Object.freeze({ receiptId: delivered.receiptId, linkedAlertReceiptIds: active, attempts: delivered.attempts });
        if (await requiredControl(controlStore, 'completeRecovery')(activeKey, recoveryKey, recoveryValue, active) !== true) {
          throw new Error('recovery completion failed');
        }
      }
    }
  }

  return {
    channel, tier, buckets, aggregateAvailable, histogram,
    denominators: { productionAggregate, entitlementTotal, entitlementNonOk, histogram: histogram.n, numberSafety, monitorDrop },
    adapters: { aggregate: aggregateAvailable, safetyEntitlementLogs: safetyLogs.available, monitorDropLogs: dropLogs.available },
    syntheticTerminal, syntheticStreak, triggers, alerts, recovery,
  };
}

/**
 * Watch the free (or BYOK) tier, which the Pro aggregate cannot see.
 *
 * Two layers, because either alone has a blind spot:
 * - aggregate: catches failures whenever real users are hitting the service,
 *   costs nothing, runs every cron tick.
 * - canary: a real HTTP rewrite, for when traffic is zero and the aggregate
 *   cannot distinguish "healthy and idle" from "down". It consumes the free
 *   IP quota (20/day), so it is budgeted by a lease.
 *
 * @param {object} deps
 * @param {'production'|'staging'} [deps.channel]
 * @param {'free'|'byok'} [deps.tier] Tier to evaluate; defaults to free.
 * @param {object} [deps.aggregateReader] KV reader exposing snapshot/mget.
 * @param {() => Promise<{ok?: boolean, terminal?: string}>} [deps.canaryRequest] Real rewrite probe.
 * @param {(payload: object) => Promise<unknown>} deps.discordSender
 * @param {object} deps.controlStore
 * @param {() => Date} [deps.clock]
 * @param {(ms: number) => Promise<void>} [deps.sleep]
 * @param {number} [deps.canaryIntervalMs] Minimum spacing between canary probes.
 * @param {number} [deps.deadlineMs]
 */
export async function evaluateFreeTierHealth(deps) {
  const {
    channel = 'production', tier = 'free', aggregateReader, canaryRequest,
    discordSender, controlStore, clock = () => new Date(), sleep,
    canaryIntervalMs = TWO_HOURS_MS, deadlineMs = SNAPSHOT_DEADLINE_MS,
  } = deps || {};
  if (!dimension(channel, CHANNELS) || !dimension(tier, ['free', 'byok'])) {
    throw new TypeError('channel and tier are required closed dimensions');
  }
  const now = asDate(clock());
  const { buckets, entries, aggregate } = await readAggregate({ channel, tier, now, aggregateReader, deadlineMs });

  let failed = 0;
  let sampledSuccess = 0;
  let quotaDenied = 0;
  let unknownOutcomes = 0;
  let aggregateOverflow = false;
  if (aggregate.available) {
    for (const { key, outcome } of entries) {
      const value = number(aggregate.values[key]);
      if (!value) continue;
      if (outcome === 'completed') sampledSuccess = safeAdd(sampledSuccess, value);
      else if (outcome === 'quota_denied') quotaDenied = safeAdd(quotaDenied, value);
      else if (outcome === 'unknown') unknownOutcomes = safeAdd(unknownOutcomes, value);
      else failed = safeAdd(failed, value);
      if ([sampledSuccess, failed, quotaDenied, unknownOutcomes].some((count) => count === null)) {
        aggregateOverflow = true;
        break;
      }
    }
  }
  const aggregateAvailable = aggregate.available && !aggregateOverflow;
  if (aggregateOverflow) {
    sampledSuccess = 0;
    failed = 0;
    quotaDenied = 0;
    unknownOutcomes = 0;
  }

  // A sampled success is an estimate of the twenty-request stratum, while a
  // failure is a full-census event. Keep the raw sample and its expansion
  // visible so callers cannot mistake the observed success count for a census.
  const sampledSuccessEstimate = sampledSuccess <= Number.MAX_SAFE_INTEGER / LOW_TIER_SUCCESS_SAMPLE_SIZE
    ? sampledSuccess * LOW_TIER_SUCCESS_SAMPLE_SIZE
    : null;
  const totalAvailable = sampledSuccessEstimate !== null && failed <= Number.MAX_SAFE_INTEGER - sampledSuccessEstimate;
  const total = aggregateAvailable && totalAvailable ? sampledSuccessEstimate + failed : 0;
  const rateAvailable = aggregateAvailable && totalAvailable && total > 0 && unknownOutcomes === 0;
  const rate = {
    available: rateAvailable,
    window: '30m',
    numerator: rateAvailable ? failed : null,
    denominator: rateAvailable ? total : null,
    success: { observed: sampledSuccess, estimate: sampledSuccessEstimate, probability: 1 / LOW_TIER_SUCCESS_SAMPLE_SIZE },
    failures: { observed: failed, probability: 1 },
    excluded: { quotaDenied, unknown: unknownOutcomes },
  };

  let canaryTerminal = null;
  if (typeof canaryRequest === 'function'
    && await acquire(controlStore, controlKey(channel, tier, 'canary-budget'), `${now.getTime()}`, canaryIntervalMs)) {
    try {
      const response = await canaryRequest({ channel, tier });
      canaryTerminal = response?.terminal === 'done' && response?.ok === true ? 'done' : 'failed';
    } catch {
      canaryTerminal = 'failed';
    }
  }

  const triggers = [];
  if (canaryTerminal === 'failed') {
    triggers.push({ trigger: 'free_canary_failure', count: 1, window: '30m', evidence: { tier } });
  }
  // A ratio needs a denominator; below 5 requests a single blip is not signal.
  if (rateAvailable && total >= 5 && failed / total > 0.5) {
    triggers.push({ trigger: 'free_failure_ratio', count: failed, window: '30m', evidence: { ratioBand: '>50pct', tier } });
  }
  const alerts = await deliverAlerts({ channel, tier, now, triggers, controlStore, discordSender, sleep });

  return {
    channel, tier, buckets,
    aggregateAvailable,
    denominators: { total, failed },
    rate,
    canaryTerminal,
    triggers,
    alerts,
  };
}
