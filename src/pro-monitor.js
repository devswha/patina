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
export function latencyHistogram(values = {}) {
  const counts = {}; let n = 0;
  for (const bucket of LATENCY_BUCKETS) { const count = Number(values[bucket]); counts[bucket] = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0; n += counts[bucket]; }
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
    if (!result || typeof result !== 'object' || result.available === false) return { available: false, values: {} };
    return { available: true, values: result.values && typeof result.values === 'object' ? result.values : result };
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
  const histogramCounts = Object.fromEntries(LATENCY_BUCKETS.map((bucket) => [bucket, 0])); let productionAggregate = 0;
  if (aggregate.available) for (const key of keys) { const value = aggregate.values[key]; productionAggregate += value; const parts = key.split(':'); if (parts[6] === 'completed' && LATENCY_BUCKETS.includes(parts[7])) histogramCounts[parts[7]] += value; }
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
  const adaptersBlind = !aggregate.available || !safetyLogs.available || !dropLogs.available;
  let syntheticTerminal = 'failed'; let syntheticRan = false;
  if (!adaptersBlind && await acquire(controlStore, controlKey(channel, tier, 'synthetic-probe-budget'), `${now.getTime()}`, ONE_HOUR_MS)) {
    syntheticRan = true;
    try { const response = await syntheticRequest({ channel, tier, text: SYNTHETIC_TEXT, timeoutMs: 60_000 }); syntheticTerminal = response?.terminal === 'done' && response?.ok === true ? 'done' : 'failed'; } catch {}
  }
  const streakKey = controlKey(channel, tier, 'synthetic-streak'); const storedStreak = persistedStreak(await requiredControl(controlStore, 'get')(streakKey)); if (storedStreak === null) throw new Error('invalid synthetic streak state'); const previousStreak = storedStreak; if (syntheticRan && syntheticTerminal !== 'done' && previousStreak === Number.MAX_SAFE_INTEGER) throw new Error('synthetic streak overflow'); const syntheticStreak = syntheticRan ? (syntheticTerminal === 'done' ? 0 : previousStreak + 1) : previousStreak; if (await requiredControl(controlStore, 'set')(streakKey, syntheticStreak, THIRTY_MINUTES_MS) !== true) throw new Error('synthetic streak persistence failed');
  const triggers = [];
  if (numberSafety >= 1) triggers.push({ trigger: 'number_safety', count: numberSafety, window: '15m' });
  if (entitlementTotal >= 20 && entitlementNonOk >= 5) triggers.push({ trigger: 'entitlement_pro', count: entitlementNonOk, window: '15m' });
  if (syntheticStreak >= 3) triggers.push({ trigger: 'synthetic_failure', count: syntheticStreak, window: '30m' });
  if (histogram.n >= 10 && histogram.selectedBucket === '>120s') triggers.push({ trigger: 'p95_latency', count: histogram.n, window: '30m', evidence: { latencyBound: '>120s', rankBand: 'p95' } });
  if (histogram.n >= 10 && histogram.over120Ratio > 0.05) triggers.push({ trigger: 'latency_tail', count: histogram.counts['>120s'], window: '30m', evidence: { ratioBand: '>5pct' } });
  if (!aggregate.available || !safetyLogs.available || !dropLogs.available || productionAggregate === 0 || monitorDrop >= 3) triggers.push({ trigger: 'monitor_blind', count: !aggregate.available || !safetyLogs.available || !dropLogs.available ? 1 : monitorDrop, window: '30m', evidence: { reason: !aggregate.available ? 'aggregate_unavailable' : !safetyLogs.available || !dropLogs.available ? 'log_unavailable' : monitorDrop >= 3 ? 'monitor_drop' : 'no_production_aggregate' } });
  const denominators = { productionAggregate, entitlementTotal, entitlementNonOk, histogram: histogram.n, numberSafety, monitorDrop };
  const adapters = { aggregate: aggregate.available, safetyEntitlementLogs: safetyLogs.available, monitorDropLogs: dropLogs.available };
  const logWindows = { safetyEntitlement: { window: '15m', available: safetyLogs.available, denominator: entitlementTotal }, monitorDrop: { window: '30m', available: dropLogs.available, denominator: productionAggregate } };
  const realPath = aggregate.available === true && productionAggregate > 0;
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
  return { channel, tier, buckets, keys: Object.freeze([...keys]), aggregateAvailable: aggregate.available, histogram, denominators, adapters, logWindows, syntheticTerminal, syntheticStreak, triggers, alerts, recovery, alertReceiptIds: safeReceiptIds(ackedReceiptIds), recoveryReceiptId: recovery?.receiptId ?? null };
}
export const runProMonitor = evaluateProMonitor;
