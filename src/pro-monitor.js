/** Private, aggregate-only health monitor for the Pro rewrite path. */
export const MONITOR_KEY_PREFIX = 'patina:mon:v1';
const CONTROL_KEY_PREFIX = 'patina:monctl:v1';
export const LATENCY_BUCKETS = Object.freeze(['<=30s', '30-60s', '60-120s', '>120s']);
export const OBSERVED_OUTCOMES = Object.freeze([
  'completed', 'terminal_failed', 'number_safety_failed', 'entitlement_denied',
  'entitlement_unavailable', 'quota_denied', 'service_disabled', 'monitor_drop', 'unknown',
]);
const OBSERVED_LATENCY_BUCKETS = LATENCY_BUCKETS;
export const SYNTHETIC_TEXT = 'Patina monitor health check.';
const QUARTER_MS = 15 * 60 * 1000;
const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * ONE_HOUR_MS;
const SNAPSHOT_DEADLINE_MS = 30_000;
// Free and BYOK successful rewrites are emitted once per twenty requests.
// Failures remain census events, so their observed count is never expanded.
const LOW_TIER_SUCCESS_SAMPLE_SIZE = 20;
const LOW_TIER_SUCCESS_SAMPLE_PROBABILITY = 1 / LOW_TIER_SUCCESS_SAMPLE_SIZE;

function dimension(value, allowed) { return typeof value === 'string' && allowed.includes(value); }
function asDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('A valid clock value is required');
  return date;
}
function compactBucket(value) {
  if (typeof value !== 'string' || !/^\d{8}T\d{4}Z$/.test(value)) return null;
  const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(9, 11)}:${value.slice(11, 13)}:00.000Z`;
  const date = new Date(iso);
  return !Number.isNaN(date.getTime()) && date.toISOString() === iso && date.getUTCMinutes() % 15 === 0 ? date : null;
}
/** Return the UTC start of the enclosing fifteen-minute bucket. */
export function utc15mBucket(value = new Date()) {
  if (typeof value === 'string') {
    const parsed = compactBucket(value);
    if (!parsed) throw new TypeError('A real UTC quarter-minute bucket is required');
    return value;
  }
  const date = asDate(value);
  return new Date(Math.floor(date.getTime() / QUARTER_MS) * QUARTER_MS).toISOString().slice(0, 16).replace(/[-:]/g, '') + 'Z';
}
/** Build the only key shape accepted by the aggregate monitor. */
export function aggregateKey({ channel, tier, at = new Date(), outcome, latencyBucket }) {
  if (!dimension(channel, ['staging', 'production']) || !dimension(tier, ['free', 'byok', 'pro'])) throw new TypeError('channel and tier must be closed aggregate dimensions');
  if (!OBSERVED_OUTCOMES.includes(outcome) || !OBSERVED_LATENCY_BUCKETS.includes(latencyBucket)) throw new TypeError('outcome and latencyBucket must be allowlisted aggregate dimensions');
  return `${MONITOR_KEY_PREFIX}:${channel}:${tier}:${utc15mBucket(at)}:${outcome}:${latencyBucket}`;
}
export const buildAggregateKey = aggregateKey;
function safeAdd(left, right) {
  return Number.isSafeInteger(left) && left >= 0 && Number.isSafeInteger(right) && right >= 0 && left <= Number.MAX_SAFE_INTEGER - right
    ? left + right
    : null;
}
export function latencyHistogram(values = {}) {
  const counts = {}; let n = 0; let overflow = false;
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
  const rank = n === 0 ? 0 : Math.ceil(n * 0.95); let cumulative = 0; let selectedBucket = null;
  for (const bucket of LATENCY_BUCKETS) { cumulative += counts[bucket]; if (rank && cumulative >= rank) { selectedBucket = bucket; break; } }
  const upperBound = selectedBucket === '<=30s' ? '30s' : selectedBucket === '30-60s' ? '60s' : selectedBucket === '60-120s' ? '120s' : selectedBucket === '>120s' ? '>120s' : null;
  return { counts, n, rank, selectedBucket, upperBound, over120Ratio: n ? counts['>120s'] / n : 0 };
}
export const conservativeP95 = latencyHistogram;
export function overlappingQuarterBuckets(now = new Date()) {
  const date = asDate(now); const current = Math.floor(date.getTime() / QUARTER_MS) * QUARTER_MS; const cutoff = date.getTime() - THIRTY_MINUTES_MS; const buckets = [];
  for (let start = current - 2 * QUARTER_MS; start <= current; start += QUARTER_MS) if (start + QUARTER_MS > cutoff) buckets.push(utc15mBucket(start));
  return buckets;
}
export function isCronAuthorized(authorization, expectedToken) { return typeof expectedToken === 'string' && expectedToken.length > 0 && !Array.isArray(authorization) && authorization === `Bearer ${expectedToken}`; }
export const verifyCronAuthorization = isCronAuthorized;
function countBand(count) { const n = Math.max(0, Math.floor(Number(count) || 0)); return n === 0 ? '0' : n === 1 ? '1' : n < 5 ? '2-4' : n < 10 ? '5-9' : n < 20 ? '10-19' : '20+'; }
function safeEvidence(evidence = {}) { const output = {}; for (const [key, value] of Object.entries(evidence)) if (['ratioBand', 'latencyBound', 'rankBand', 'reason'].includes(key) && typeof value === 'string' && /^[a-z0-9><=._-]+$/i.test(value)) output[key] = value; return output; }
export function discordPayload({ trigger, count = 0, window, channel, evidence }) { if (typeof trigger !== 'string' || !dimension(channel, ['staging', 'production']) || typeof window !== 'string') throw new TypeError('Discord alert dimensions must be aggregate-only'); return { trigger, countBand: countBand(count), window, channel, evidence: safeEvidence(evidence) }; }
function number(value) { const n = Number(value); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0; }
function persistedStreak(value) {
  if (value === undefined || value === null) return 0;
  return snapshotCount(value);
}
const RECEIPT_ID_PATTERN = /^[a-z0-9._-]+$/i;
function safeReceiptIds(value) {
  const seen = new Set();
  const ids = [];
  for (const id of Array.isArray(value) ? value : []) if (typeof id === 'string' && RECEIPT_ID_PATTERN.test(id) && !seen.has(id)) { seen.add(id); ids.push(id); }
  return Object.freeze(ids);
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
function snapshotCount(value) {
  if (value === null) return 0;
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value)) {
    const count = Number(value);
    return Number.isSafeInteger(count) ? count : null;
  }
  return null;
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
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
function closedTrigger(item) {
  return deepFreeze({ trigger: item.trigger, count: item.count, window: item.window, ...(item.evidence ? { evidence: safeEvidence(item.evidence) } : {}) });
}
function closedMonitorFact({ channel, tier, buckets, histogram, denominators, adapters, logWindows, syntheticTerminal, syntheticStreak, realPath, trigger, alert, recovery }) {
  return deepFreeze({
    channel, tier, buckets: [...buckets],
    histogram: { ...histogram, counts: { ...histogram.counts } },
    denominators: { ...denominators }, adapters: { ...adapters },
    logWindows: { safetyEntitlement: { ...logWindows.safetyEntitlement }, monitorDrop: { ...logWindows.monitorDrop } },
    syntheticTerminal, syntheticStreak, realPath,
    ...(trigger ? { trigger: closedTrigger(trigger) } : {}),
    ...(alert ? { alert: { receiptId: alert.receiptId, attempts: alert.attempts } } : {}),
    ...(recovery ? { recovery: { receiptId: recovery.receiptId, attempts: recovery.attempts, linkedAlertReceiptIds: [...recovery.linkedAlertReceiptIds] } } : {}),
  });
}
function plainObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function validPreparedEvidence(value) {
  if (!plainObject(value)) return false;
  const visit = (candidate, key = '') => {
    if (candidate === null || typeof candidate !== 'object') return !/receipt.*id|id.*receipt/i.test(key) || (typeof candidate === 'string' && RECEIPT_ID_PATTERN.test(candidate));
    if (Array.isArray(candidate)) {
      if (/receipt.*ids|ids.*receipt/i.test(key)) return candidate.every((id) => typeof id === 'string' && RECEIPT_ID_PATTERN.test(id)) && new Set(candidate).size === candidate.length;
      return candidate.every((item) => visit(item));
    }
    if (!plainObject(candidate)) return false;
    return Object.entries(candidate).every(([childKey, child]) => visit(child, childKey));
  };
  return visit(value);
}
async function prepareEvidence(hook, fact, store, leaseKey, leaseValue) {
  if (hook === undefined) return null;
  try {
    if (typeof hook !== 'function') throw new TypeError('invalid evidence preparation hook');
    const prepared = await hook(fact);
    if (!validPreparedEvidence(prepared)) throw new TypeError('invalid prepared evidence');
    return prepared;
  } catch {
    await release(store, leaseKey, leaseValue);
    throw new Error('evidence preparation failed');
  }
}
function controlKey(channel, tier, suffix) { return `${CONTROL_KEY_PREFIX}:${channel}:${tier}:${suffix}`; }
function snapshotMethod(reader) { if (reader && typeof reader.snapshot === 'function') return reader.snapshot.bind(reader); if (reader && typeof reader.mget === 'function') return (keys, options) => reader.mget(keys, options); throw new TypeError('aggregateReader must expose snapshot or mget'); }
function snapshotValue(snapshot, key, index) { return snapshot instanceof Map ? snapshot.get(key) : Array.isArray(snapshot) ? snapshot[index] : snapshot?.[key]; }
async function aggregateSnapshot(reader, keys, deadlineMs) {
  let timer;
  try {
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('deadline')), deadlineMs); });
    const snapshot = await Promise.race([snapshotMethod(reader)(keys, { deadlineMs }), timeout]);
    if (!snapshot || (Array.isArray(snapshot) && snapshot.length !== keys.length)) throw new Error('incomplete');
    const values = Object.create(null);
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      const present = snapshot instanceof Map ? snapshot.has(key) : Array.isArray(snapshot) ? index in snapshot : Object.prototype.hasOwnProperty.call(snapshot, key);
      const value = snapshotValue(snapshot, key, index);
      if (!present || value === undefined) throw new Error('invalid');
      const count = snapshotCount(value);
      if (count === null) throw new Error('invalid');
      values[key] = count;
    }
    return { available: true, values: Object.freeze(values) };
  } catch { return { available: false, values: Object.freeze(Object.create(null)) }; } finally { clearTimeout(timer); }
}
async function queryLogs(logQuery, channel, tier, window) {
  try {
    const result = await logQuery({ channel, tier, window, aggregateOnly: true, readOnly: true });
    const values = result?.values && typeof result.values === 'object' && !Array.isArray(result.values) ? result.values : result;
    const expected = window === '15m'
      ? ['numberSafety', 'entitlementNonOk', 'entitlementTotal']
      : ['monitorDrop'];
    if (!values || typeof values !== 'object' || Array.isArray(values) || result.available === false
      || Object.keys(values).length !== expected.length || expected.some((key) => !Object.hasOwn(values, key)
        || !Number.isSafeInteger(values[key]) || values[key] < 0)) return { available: false, values: {} };
    return { available: true, values };
  } catch { return { available: false, values: {} }; }
}
async function sendWithRetry(send, payload, sleep = (delay) => new Promise((resolve) => setTimeout(resolve, delay))) { for (let attempt = 1; attempt <= 3; attempt += 1) { try { const response = await send(payload); const status = typeof response === 'number' ? response : response?.status; const receiptId = response?.receiptId ?? response?.id; if (Number.isInteger(status) && status >= 200 && status < 300 && typeof receiptId === 'string' && RECEIPT_ID_PATTERN.test(receiptId)) return { ok: true, attempts: attempt, receiptId }; } catch {} if (attempt < 3) await sleep(attempt * 1000); } return { ok: false, attempts: 3 }; }
/** Evaluate monitor signals without exposing customer data or raw collaborator errors. */
export async function evaluateProMonitor(deps) {
  const { channel = 'production', tier = 'pro', aggregateReader, snapshot, logQuery, syntheticRequest, discordSender, controlStore, prepareAlertEvidence, prepareRecoveryEvidence, clock = () => new Date(), sleep, deadlineMs = SNAPSHOT_DEADLINE_MS } = deps || {};
  if (!dimension(channel, ['staging', 'production']) || !dimension(tier, ['free', 'byok', 'pro'])) throw new TypeError('channel and tier are required closed dimensions');
  const now = asDate(clock()); const buckets = overlappingQuarterBuckets(now); const keys = [];
  for (const bucket of buckets) for (const outcome of OBSERVED_OUTCOMES) for (const latencyBucket of OBSERVED_LATENCY_BUCKETS) keys.push(aggregateKey({ channel, tier, at: bucket, outcome, latencyBucket }));
  const aggregate = await aggregateSnapshot(snapshot ? { snapshot } : aggregateReader, keys, Math.max(1, Math.min(Number(deadlineMs) || SNAPSHOT_DEADLINE_MS, SNAPSHOT_DEADLINE_MS)));
  const histogramCounts = Object.fromEntries(LATENCY_BUCKETS.map((bucket) => [bucket, 0]));
  let productionAggregate = 0; let unknownAggregate = 0; let monitorDropAggregate = 0; let aggregateOverflow = false;
  if (aggregate.available) for (const key of keys) {
    const value = aggregate.values[key];
    const parts = key.split(':');
    // Unknown classifications and observer delivery drops are evidence that
    // cannot establish a known production request denominator.
    if (parts[6] === 'unknown') unknownAggregate = safeAdd(unknownAggregate, value);
    else if (parts[6] === 'monitor_drop') monitorDropAggregate = safeAdd(monitorDropAggregate, value);
    else productionAggregate = safeAdd(productionAggregate, value);
    if (parts[6] === 'completed' && LATENCY_BUCKETS.includes(parts[7])) histogramCounts[parts[7]] = safeAdd(histogramCounts[parts[7]], value);
    if (productionAggregate === null || unknownAggregate === null || monitorDropAggregate === null
      || Object.values(histogramCounts).some((count) => count === null)) aggregateOverflow = true;
  }
  if (aggregateOverflow) {
    productionAggregate = 0; unknownAggregate = 0; monitorDropAggregate = 0;
    for (const bucket of LATENCY_BUCKETS) histogramCounts[bucket] = 0;
  }
  const aggregateClassificationUnavailable = productionAggregate > 0
    && (unknownAggregate > 0 || monitorDropAggregate > 0);
  if (aggregateClassificationUnavailable) {
    productionAggregate = 0;
    for (const bucket of LATENCY_BUCKETS) histogramCounts[bucket] = 0;
  }
  const aggregateAvailable = aggregate.available && !aggregateOverflow;
  const aggregateUnavailableReason = aggregateOverflow
    ? 'aggregate_overflow'
    : aggregateClassificationUnavailable
      ? 'aggregate_classification_unavailable'
      : null;
  const histogram = latencyHistogram(histogramCounts);
  const safetyLogs = await queryLogs(logQuery, channel, tier, '15m'); const dropLogs = await queryLogs(logQuery, channel, tier, '30m');
  const safety = safetyLogs.values; const drops = dropLogs.values;
  const numberSafety = number(safety.numberSafety); const entitlementNonOk = number(safety.entitlementNonOk); const entitlementTotal = number(safety.entitlementTotal); const monitorDrop = number(drops.monitorDrop);
  // Paid-probe guard (2026-07-23 incident): the synthetic probe is a real pro
  // rewrite (three provider calls with the full catalog prompt). A run whose
  // cheap adapters are already blind can only terminate as monitor_blind +
  // 503, so its probe outcome would be discarded while the provider bill is
  // real — an overnight cron burned ~82 probes exactly this way. Skip the
  // probe when blind, and budget it to one per hour otherwise. A skipped
  // probe reports 'failed' (conservative) but neither grows nor resets the
  // persisted streak, so it can never fabricate a synthetic_failure alert.
  const adaptersBlind = !aggregateAvailable || !safetyLogs.available || !dropLogs.available;
  let syntheticTerminal = 'failed'; let syntheticRan = false;
  if (!adaptersBlind && await acquire(controlStore, controlKey(channel, tier, 'synthetic-probe-budget'), `${now.getTime()}`, ONE_HOUR_MS)) {
    syntheticRan = true;
    try { const response = await syntheticRequest({ channel, tier, text: SYNTHETIC_TEXT, timeoutMs: 60_000 }); syntheticTerminal = response?.terminal === 'done' && response?.ok === true ? 'done' : 'failed'; } catch {}
  }
  const streakKey = controlKey(channel, tier, 'synthetic-streak');
  const storedStreak = persistedStreak(await requiredControl(controlStore, 'get')(streakKey));
  if (storedStreak === null) throw new Error('invalid synthetic streak state');
  const previousStreak = storedStreak;
  if (syntheticRan && syntheticTerminal !== 'done' && previousStreak === Number.MAX_SAFE_INTEGER) throw new Error('synthetic streak overflow');
  const syntheticStreak = syntheticRan ? (syntheticTerminal === 'done' ? 0 : previousStreak + 1) : previousStreak;
  if (syntheticRan && await requiredControl(controlStore, 'set')(streakKey, syntheticStreak, THIRTY_MINUTES_MS) !== true) throw new Error('synthetic streak persistence failed');
  const triggers = [];
  if (numberSafety >= 1) triggers.push({ trigger: 'number_safety', count: numberSafety, window: '15m' });
  if (entitlementTotal >= 20 && entitlementNonOk >= 5) triggers.push({ trigger: 'entitlement_pro', count: entitlementNonOk, window: '15m' });
  if (syntheticStreak >= 3) triggers.push({ trigger: 'synthetic_failure', count: syntheticStreak, window: '30m' });
  if (histogram.n >= 10 && histogram.selectedBucket === '>120s') triggers.push({ trigger: 'p95_latency', count: histogram.n, window: '30m', evidence: { latencyBound: '>120s', rankBand: 'p95' } });
  if (histogram.n >= 10 && histogram.over120Ratio > 0.05) triggers.push({ trigger: 'latency_tail', count: histogram.counts['>120s'], window: '30m', evidence: { ratioBand: '>5pct' } });
  if (!aggregateAvailable || !safetyLogs.available || !dropLogs.available || productionAggregate === 0 || monitorDrop >= 3) {
    const unavailable = !aggregate.available || !safetyLogs.available || !dropLogs.available;
    const unknownOnly = productionAggregate === 0 && (unknownAggregate > 0 || monitorDropAggregate > 0);
    const reason = !aggregateAvailable ? (aggregateOverflow ? 'aggregate_overflow' : 'aggregate_unavailable')
      : !safetyLogs.available || !dropLogs.available ? 'log_unavailable'
        : monitorDrop >= 3 ? 'monitor_drop'
          : aggregateUnavailableReason ?? (unknownOnly ? 'unknown_aggregate' : 'no_production_aggregate');
    // Keep the receipt contract's monitor-blind count tied to the
    // log-derived monitorDrop value; unknown aggregate classifications are
    // exposed through the reason but cannot masquerade as delivery drops.
    const count = unavailable ? 1 : monitorDrop;
    triggers.push({ trigger: 'monitor_blind', count, window: '30m', evidence: { reason } });
  }
  const denominators = { productionAggregate, entitlementTotal, entitlementNonOk, histogram: histogram.n, numberSafety, monitorDrop };
  const adapters = { aggregate: aggregateAvailable, safetyEntitlementLogs: safetyLogs.available, monitorDropLogs: dropLogs.available };
  const logWindows = { safetyEntitlement: { window: '15m', available: safetyLogs.available, denominator: entitlementTotal }, monitorDrop: { window: '30m', available: dropLogs.available, denominator: productionAggregate } };
  const realPath = aggregateAvailable === true && productionAggregate > 0;
  const alerts = []; const ackedReceiptIds = []; const activeKey = controlKey(channel, tier, 'active');
  for (const item of triggers) {
    const leaseKey = controlKey(channel, tier, `dedup:${item.trigger}`); const leaseValue = `${now.getTime()}-${item.trigger}`;
    if (!await acquire(controlStore, leaseKey, leaseValue, ONE_HOUR_MS)) { alerts.push({ trigger: item.trigger, sent: false, deduped: true }); continue; }
    const delivered = await sendWithRetry(discordSender, discordPayload({ ...item, channel }), sleep);
    if (!delivered.ok) { await release(controlStore, leaseKey, leaseValue); alerts.push({ trigger: item.trigger, sent: false, attempts: delivered.attempts }); continue; }
    const prepared = await prepareEvidence(prepareAlertEvidence, closedMonitorFact({ channel, tier, buckets, histogram, denominators, adapters, logWindows, syntheticTerminal, syntheticStreak, realPath, trigger: item, alert: delivered }), controlStore, leaseKey, leaseValue);
    if (await requiredControl(controlStore, 'acknowledge')(leaseKey, leaseValue, activeKey, delivered.receiptId, TWO_HOURS_MS, prepared) !== true) throw new Error('alert acknowledgement failed');
    ackedReceiptIds.push(delivered.receiptId); alerts.push({ trigger: item.trigger, sent: true, attempts: delivered.attempts, receiptId: delivered.receiptId });
  }
  let recovery = null;
  if (!triggers.length) {
    const active = activeReceiptIds(await requiredControl(controlStore, 'get')(activeKey));
    if (active.length) {
      const recoveryKey = controlKey(channel, tier, 'recovery');
      const recoveryValue = `${now.getTime()}-recovery`;
      if (await acquire(controlStore, recoveryKey, recoveryValue, ONE_HOUR_MS)) {
        const delivered = await sendWithRetry(discordSender, discordPayload({ trigger: 'monitor_recovered', count: active.length, window: '30m', channel, evidence: { reason: 'recovered' } }), sleep);
        if (!delivered.ok) await release(controlStore, recoveryKey, recoveryValue);
        else {
          recovery = Object.freeze({ receiptId: delivered.receiptId, linkedAlertReceiptIds: active, attempts: delivered.attempts });
          const prepared = await prepareEvidence(prepareRecoveryEvidence, closedMonitorFact({ channel, tier, buckets, histogram, denominators, adapters, logWindows, syntheticTerminal, syntheticStreak, realPath, recovery }), controlStore, recoveryKey, recoveryValue);
          if (await requiredControl(controlStore, 'completeRecovery')(activeKey, recoveryKey, recoveryValue, active, recovery, ONE_HOUR_MS, prepared) !== true) throw new Error('recovery completion failed');
        }
      }
    }
  }
  return { channel, tier, buckets, keys: Object.freeze([...keys]), aggregateAvailable, histogram, denominators, adapters, logWindows, syntheticTerminal, syntheticStreak, triggers, alerts, recovery, alertReceiptIds: safeReceiptIds(ackedReceiptIds), recoveryReceiptId: recovery?.receiptId ?? null };
}

/**
 * Watch the tier that actually serves users.
 *
 * The paid monitor above evaluates `tier: 'pro'`, which has no users while
 * checkout is disabled, so its aggregate is permanently zero and its one live
 * signal — `monitor_blind` — fires constantly. On 2026-07-27 the free tier
 * returned provider 429s to real users three times and nothing alerted,
 * because nothing was looking at it. The counters were being written the whole
 * time (`patina:mon:v1:<channel>:free:...`); only the reader was missing.
 *
 * Two layers, because either alone has a blind spot:
 * - aggregate: catches failures whenever real users are hitting the service,
 *   costs nothing, runs every cron tick.
 * - canary: a real HTTP rewrite, for when traffic is zero and the aggregate
 *   cannot distinguish "healthy and idle" from "down". It consumes the free
 *   IP quota (20/day), so it is budgeted by a lease — twice per hour would
 *   exhaust the quota and manufacture its own alerts.
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
    channel = 'production', tier = 'free', aggregateReader, snapshot, canaryRequest,
    discordSender, controlStore, clock = () => new Date(), sleep,
    canaryIntervalMs = TWO_HOURS_MS, deadlineMs = SNAPSHOT_DEADLINE_MS,
  } = deps || {};
  if (!dimension(channel, ['staging', 'production']) || !dimension(tier, ['free', 'byok'])) {
    throw new TypeError('channel and tier are required closed dimensions');
  }

  const now = asDate(clock());
  const buckets = overlappingQuarterBuckets(now);
  const keys = [];
  for (const bucket of buckets) {
    for (const outcome of OBSERVED_OUTCOMES) {
      for (const latencyBucket of OBSERVED_LATENCY_BUCKETS) {
        keys.push(aggregateKey({ channel, tier, at: bucket, outcome, latencyBucket }));
      }
    }
  }
  const aggregate = await aggregateSnapshot(snapshot ? { snapshot } : aggregateReader, keys, Math.max(1, Math.min(Number(deadlineMs) || SNAPSHOT_DEADLINE_MS, SNAPSHOT_DEADLINE_MS)));

  let failed = 0;
  let sampledSuccess = 0;
  let quotaDenied = 0;
  let monitorDrops = 0;
  let unknownOutcomes = 0;
  let aggregateOverflow = false;
  if (aggregate.available) {
    for (const key of keys) {
      const value = number(aggregate.values[key]);
      if (!value) continue;
      const outcome = key.split(':')[6];
      if (outcome === 'completed') sampledSuccess = safeAdd(sampledSuccess, value);
      else if (outcome === 'quota_denied') quotaDenied = safeAdd(quotaDenied, value);
      else if (outcome === 'monitor_drop') monitorDrops = safeAdd(monitorDrops, value);
      else if (outcome === 'unknown') unknownOutcomes = safeAdd(unknownOutcomes, value);
      else failed = safeAdd(failed, value);
      if ([sampledSuccess, failed, quotaDenied, monitorDrops, unknownOutcomes].some((count) => count === null)) aggregateOverflow = true;
    }
  }

  const aggregateAvailable = aggregate.available && !aggregateOverflow;
  if (aggregateOverflow) {
    sampledSuccess = 0;
    failed = 0;
    quotaDenied = 0;
    monitorDrops = 0;
    unknownOutcomes = 0;
  }

  // A sampled success is an estimate of the twenty-request stratum, while a
  // failure is a full-census event. Keep the raw sample and its expansion
  // visible so callers cannot mistake the observed success count for a census.
  const sampledSuccessEstimate = Number.isSafeInteger(sampledSuccess)
    && sampledSuccess <= Number.MAX_SAFE_INTEGER / LOW_TIER_SUCCESS_SAMPLE_SIZE
    ? sampledSuccess * LOW_TIER_SUCCESS_SAMPLE_SIZE
    : null;
  const totalAvailable = sampledSuccessEstimate !== null
    && Number.isSafeInteger(failed)
    && failed <= Number.MAX_SAFE_INTEGER - sampledSuccessEstimate;
  const total = aggregateAvailable && totalAvailable ? sampledSuccessEstimate + failed : 0;
  const rateAvailable = aggregateAvailable === true
    && sampledSuccessEstimate !== null
    && totalAvailable
    && total > 0
    && unknownOutcomes === 0
    && monitorDrops === 0;
  const rate = {
    available: rateAvailable,
    window: '30m',
    numerator: rateAvailable ? failed : null,
    denominator: rateAvailable ? total : null,
    success: {
      observed: sampledSuccess,
      estimate: sampledSuccessEstimate,
      probability: LOW_TIER_SUCCESS_SAMPLE_PROBABILITY,
    },
    failures: { observed: failed, probability: 1 },
    excluded: { quotaDenied, monitorDrops, unknown: unknownOutcomes },
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
    alerts.push({ trigger: item.trigger, sent: true, attempts: delivered.attempts, receiptId: delivered.receiptId });
  }

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
export const runProMonitor = evaluateProMonitor;
