import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { aggregateKey, evaluateProMonitor, overlappingQuarterBuckets, utc15mBucket } from '../../src/pro-monitor.js';

const NOW = new Date('2026-07-15T12:07:00.000Z');
function store() {
  const values = new Map();
  return {
    values,
    async get(key) { return values.get(key); },
    async set(key, value) { values.set(key, value); return true; },
    async acquire(key, value) { if (values.has(key)) return false; values.set(key, value); return true; },
    async release(key, value) { if (values.get(key) !== value) return false; values.delete(key); return true; },
    async acknowledge(leaseKey, leaseValue, activeKey, receiptId) {
      if (values.get(leaseKey) !== leaseValue) return false;
      const active = (values.get(activeKey) ?? []).filter((id) => typeof id === 'string' && /^[a-z0-9._-]+$/i.test(id));
      values.set(activeKey, Object.freeze([...new Set([...active, receiptId])]));
      return true;
    },
    async completeRecovery(activeKey, recoveryKey, recoveryValue, expectedActiveIds, recovery) {
      const active = values.get(activeKey) ?? [];
      if (JSON.stringify(active) !== JSON.stringify(expectedActiveIds) || values.get(recoveryKey) !== recoveryValue) return false;
      values.set(recoveryKey, recovery);
      values.set(activeKey, Object.freeze([]));
      return true;
    },
  };
}
function snapshot(values = {}) { return { async snapshot(keys, options) { assert.ok(options.deadlineMs > 0); return Object.fromEntries(keys.map((key) => [key, values[key] ?? 0])); } }; }
function deps(overrides = {}) { return { channel: 'production', tier: 'pro', clock: () => NOW, sleep: async () => {}, aggregateReader: snapshot(), logQuery: async () => ({}), syntheticRequest: async () => ({ ok: true, terminal: 'done' }), discordSender: async () => ({ status: 204, receiptId: 'discord-1' }), controlStore: store(), ...overrides }; }
const key = (outcome = 'completed', latencyBucket = '<=30s', tier = 'pro') => aggregateKey({ channel: 'production', tier, at: '20260715T1200Z', outcome, latencyBucket });

test('closed dimensions and real compact quarter buckets are enforced', () => {
  assert.throws(() => aggregateKey({ channel: 'dev', tier: 'pro', at: NOW, outcome: 'completed', latencyBucket: '<=30s' }));
  assert.throws(() => aggregateKey({ channel: 'production', tier: 'enterprise', at: NOW, outcome: 'completed', latencyBucket: '<=30s' }));
  assert.throws(() => aggregateKey({ channel: 'production', tier: 'pro', at: NOW, outcome: 'completed', latencyBucket: 'unknown' }));
  assert.equal(utc15mBucket('20260715T1145Z'), '20260715T1145Z');
  for (const bucket of ['20260715T1146Z', '20260230T1200Z', '20260715T1200']) assert.throws(() => utc15mBucket(bucket));
});

test('takes one complete atomic snapshot with only approved latency dimensions', async () => {
  let calls = 0;
  const result = await evaluateProMonitor(deps({ deadlineMs: 7, aggregateReader: { async snapshot(keys, { deadlineMs }) { calls += 1; assert.equal(keys.length, 108); assert.ok(keys.every((item) => /:(?:<=30s|30-60s|60-120s|>120s)$/.test(item))); assert.equal(deadlineMs, 7); return Object.fromEntries(keys.map((item) => [item, 1])); } } }));
  assert.equal(calls, 1); assert.equal(result.aggregateAvailable, true); assert.equal(result.denominators.productionAggregate, 108);
});

test('snapshot failure is all-or-nothing and produces no partial histogram', async () => {
  const result = await evaluateProMonitor(deps({ aggregateReader: { async snapshot() { throw new Error('private'); } } }));
  assert.equal(result.aggregateAvailable, false); assert.equal(result.histogram.n, 0); assert.ok(result.triggers.some(({ trigger }) => trigger === 'monitor_blind'));
});

test('queries distinct 15m safety and 30m drop windows with explicit availability', async () => {
  const windows = []; const result = await evaluateProMonitor(deps({ logQuery: async ({ window }) => { windows.push(window); return window === '15m' ? { numberSafety: 1, entitlementTotal: 20, entitlementNonOk: 5 } : { monitorDrop: 3 }; } }));
  assert.deepEqual(windows, ['15m', '30m']); assert.equal(result.adapters.safetyEntitlementLogs, true); assert.equal(result.adapters.monitorDropLogs, true); assert.equal(result.denominators.entitlementTotal, 20); assert.deepEqual(result.triggers.map(({ trigger }) => trigger), ['number_safety', 'entitlement_pro', 'monitor_blind']);
});
test('only exact camelCase log aggregate keys drive monitor thresholds', async () => {
  const aggregateReader = snapshot({ [key()]: 1 });
  const snakeCase = await evaluateProMonitor(deps({ aggregateReader, logQuery: async ({ window }) => window === '15m' ? { number_safety: 1, entitlement_non_ok: 5, entitlement_total: 20 } : { monitor_drop: 3 } }));
  assert.deepEqual(snakeCase.adapters, { aggregate: true, safetyEntitlementLogs: true, monitorDropLogs: true });
  assert.deepEqual(snakeCase.denominators, { productionAggregate: 1, entitlementTotal: 0, entitlementNonOk: 0, histogram: 1, numberSafety: 0, monitorDrop: 0 });
  assert.deepEqual(snakeCase.triggers, []);

  const camelCase = await evaluateProMonitor(deps({ aggregateReader, logQuery: async ({ window }) => window === '15m' ? { numberSafety: 1, entitlementNonOk: 5, entitlementTotal: 20 } : { monitorDrop: 3 } }));
  assert.deepEqual(camelCase.denominators, { productionAggregate: 1, entitlementTotal: 20, entitlementNonOk: 5, histogram: 1, numberSafety: 1, monitorDrop: 3 });
  assert.deepEqual(camelCase.triggers.map(({ trigger }) => trigger), ['number_safety', 'entitlement_pro', 'monitor_blind']);
});

test('aggregate and control namespaces are channel and tier scoped', async () => {
  const shared = { at: NOW, outcome: 'completed', latencyBucket: '<=30s' };
  assert.notEqual(aggregateKey({ ...shared, channel: 'production', tier: 'pro' }), aggregateKey({ ...shared, channel: 'production', tier: 'free' }));
  const control = store(); await evaluateProMonitor(deps({ controlStore: control, tier: 'free', logQuery: async () => ({ numberSafety: 1 }) }));
  assert.ok([...control.values.keys()].every((item) => item.startsWith('patina:monctl:v1:production:free:')));
});

test('concurrent monitor calls acquire a single atomic dedup lease', async () => {
  const control = store(); let sends = 0; const common = deps({ controlStore: control, aggregateReader: snapshot({ [key()]: 1 }), logQuery: async () => ({ numberSafety: 1 }), discordSender: async () => { sends += 1; return { status: 204, receiptId: 'alert-a' }; } });
  const [first, second] = await Promise.all([evaluateProMonitor(common), evaluateProMonitor(common)]);
  assert.equal(sends, 1); assert.equal(first.alerts[0].sent || second.alerts[0].sent, true); assert.equal(first.alerts[0].deduped || second.alerts[0].deduped, true);
});

test('failed delivery releases lease and never activates or recovers', async () => {
  const control = store(); const failed = await evaluateProMonitor(deps({ controlStore: control, aggregateReader: snapshot({ [key()]: 1 }), logQuery: async () => ({ numberSafety: 1 }), discordSender: async () => ({ status: 500 }) }));
  assert.equal(failed.alertReceiptIds.length, 0); assert.equal(control.values.has('patina:monctl:v1:production:pro:active'), false); assert.equal([...control.values.keys()].some((item) => item.includes(':recovery')), false);
});

test('ACK receipt IDs are active state and recovery links them only after Discord ACK', async () => {
  const control = store(); const alert = await evaluateProMonitor(deps({ controlStore: control, aggregateReader: snapshot({ [key()]: 1 }), logQuery: async () => ({ numberSafety: 1 }), discordSender: async () => ({ status: 204, receiptId: 'alert-ack' }) }));
  assert.deepEqual(alert.alertReceiptIds, ['alert-ack']); assert.deepEqual(control.values.get('patina:monctl:v1:production:pro:active'), ['alert-ack']);
  for (const keyName of [...control.values.keys()]) if (keyName.includes(':dedup:')) control.values.delete(keyName);
  let recoverySends = 0;
  const recovered = await evaluateProMonitor(deps({ controlStore: control, aggregateReader: snapshot({ [key()]: 1 }), discordSender: async () => { recoverySends += 1; return recoverySends === 1 ? { status: 503 } : { status: 204, receiptId: 'recovery-ack' }; } }));
  assert.equal(recoverySends, 2); assert.equal(recovered.recoveryReceiptId, 'recovery-ack'); assert.equal(recovered.recovery.attempts, 2); assert.deepEqual(recovered.recovery.linkedAlertReceiptIds, ['alert-ack']);
});
test('new ACKs retain safe active receipts for complete recovery linkage', async () => {
  const control = store();
  control.values.set('patina:monctl:v1:production:pro:active', ['prior-ack', 'prior-ack', 'unsafe receipt']);
  const alerted = await evaluateProMonitor(deps({ controlStore: control, aggregateReader: snapshot({ [key()]: 1 }), logQuery: async () => ({ numberSafety: 1 }), discordSender: async () => ({ status: 204, receiptId: 'new-ack' }) }));
  const active = control.values.get('patina:monctl:v1:production:pro:active');
  assert.deepEqual(alerted.alertReceiptIds, ['new-ack']); assert.deepEqual(active, ['prior-ack', 'new-ack']); assert.ok(Object.isFrozen(active));
  const recovered = await evaluateProMonitor(deps({ controlStore: control, aggregateReader: snapshot({ [key()]: 1 }), discordSender: async () => ({ status: 204, receiptId: 'recovery-ack' }) }));
  assert.deepEqual(recovered.recovery.linkedAlertReceiptIds, ['prior-ack', 'new-ack']); assert.ok(Object.isFrozen(recovered.recovery)); assert.ok(Object.isFrozen(recovered.recovery.linkedAlertReceiptIds));
});

test('synthetic completion requires explicit terminal done', async () => {
  const control = store(); const common = deps({ controlStore: control, syntheticRequest: async () => ({ status: 204, ok: true, terminal: 'queued' }) });
  await evaluateProMonitor(common); await evaluateProMonitor(common); const third = await evaluateProMonitor(common);
  assert.equal(third.syntheticTerminal, 'failed'); assert.ok(third.triggers.some(({ trigger }) => trigger === 'synthetic_failure'));
});
test('max-safe failed synthetic streak fails closed without persistence or alerts', async () => {
  const control = store(); const streakKey = 'patina:monctl:v1:production:pro:synthetic-streak'; control.values.set(streakKey, Number.MAX_SAFE_INTEGER);
  let persistenceAttempts = 0; let alertAttempts = 0; const set = control.set; control.set = async (...args) => { persistenceAttempts += 1; return set(...args); };
  await assert.rejects(evaluateProMonitor(deps({ controlStore: control, syntheticRequest: async () => ({ ok: false, terminal: 'failed' }), discordSender: async () => { alertAttempts += 1; return { status: 204, receiptId: 'unexpected' }; } })), /synthetic streak overflow/);
  assert.equal(persistenceAttempts, 0); assert.equal(alertAttempts, 0); assert.equal(control.values.get(streakKey), Number.MAX_SAFE_INTEGER);
});
test('max-safe synthetic completion resets the streak to zero', async () => {
  const control = store(); const streakKey = 'patina:monctl:v1:production:pro:synthetic-streak'; control.values.set(streakKey, Number.MAX_SAFE_INTEGER);
  const result = await evaluateProMonitor(deps({ controlStore: control }));
  assert.equal(result.syntheticTerminal, 'done'); assert.equal(result.syntheticStreak, 0); assert.equal(control.values.get(streakKey), 0);
});
test('overlapping quarter buckets include the exact boundary and both adjacent milliseconds', () => {
  assert.deepEqual(overlappingQuarterBuckets('2026-07-15T11:59:59.999Z'), ['20260715T1115Z', '20260715T1130Z', '20260715T1145Z']);
  assert.deepEqual(overlappingQuarterBuckets('2026-07-15T12:00:00.000Z'), ['20260715T1130Z', '20260715T1145Z', '20260715T1200Z']);
  assert.deepEqual(overlappingQuarterBuckets('2026-07-15T12:00:00.001Z'), ['20260715T1130Z', '20260715T1145Z', '20260715T1200Z']);
});

test('a sparse oldest overlap is fresh through its bucket end and stale once it leaves the window', async () => {
  const oldest = aggregateKey({ channel: 'production', tier: 'pro', at: '20260715T1130Z', outcome: 'completed', latencyBucket: '<=30s' });
  const common = { aggregateReader: snapshot({ [oldest]: 1 }), logQuery: async () => ({}) };
  const fresh = await evaluateProMonitor(deps({ ...common, clock: () => new Date('2026-07-15T12:00:00.000Z') }));
  const stale = await evaluateProMonitor(deps({ ...common, clock: () => new Date('2026-07-15T12:15:00.000Z') }));
  assert.equal(fresh.denominators.productionAggregate, 1);
  assert.deepEqual(fresh.triggers, []);
  assert.deepEqual(stale.triggers, [{ trigger: 'monitor_blind', count: 0, window: '30m', evidence: { reason: 'no_production_aggregate' } }]);
});

test('production and staging aggregate snapshots cannot cross-read', async () => {
  const production = aggregateKey({ channel: 'production', tier: 'pro', at: '20260715T1200Z', outcome: 'completed', latencyBucket: '<=30s' });
  const requestedChannels = [];
  const aggregateReader = { async snapshot(keys) {
    requestedChannels.push(new Set(keys.map((item) => item.split(':')[3])));
    return Object.fromEntries(keys.map((item) => [item, item === production ? 1 : 0]));
  } };
  const productionResult = await evaluateProMonitor(deps({ aggregateReader, logQuery: async () => ({}) }));
  const stagingResult = await evaluateProMonitor(deps({ channel: 'staging', aggregateReader, logQuery: async () => ({}) }));
  assert.equal(productionResult.denominators.productionAggregate, 1);
  assert.equal(stagingResult.denominators.productionAggregate, 0);
  assert.deepEqual([...requestedChannels[0]], ['production']);
  assert.deepEqual([...requestedChannels[1]], ['staging']);
  assert.deepEqual(stagingResult.triggers, [{ trigger: 'monitor_blind', count: 0, window: '30m', evidence: { reason: 'no_production_aggregate' } }]);
});

test('unavailable log queries with a positive aggregate have only the log-unavailable blind reason', async () => {
  const result = await evaluateProMonitor(deps({ aggregateReader: snapshot({ [key()]: 1 }), logQuery: async () => { throw new Error('unavailable'); } }));
  assert.deepEqual(result.triggers, [{ trigger: 'monitor_blind', count: 1, window: '30m', evidence: { reason: 'log_unavailable' } }]);
});

test('monitor drops are isolated from zero-aggregate blindness', async () => {
  const result = await evaluateProMonitor(deps({ aggregateReader: snapshot({ [key()]: 1 }), logQuery: async ({ window }) => window === '30m' ? { monitorDrop: 3 } : {} }));
  assert.equal(result.denominators.productionAggregate, 1);
  assert.deepEqual(result.triggers, [{ trigger: 'monitor_blind', count: 3, window: '30m', evidence: { reason: 'monitor_drop' } }]);
});

test('conservative p95 and tail thresholds distinguish one slow request at n=10 from exactly five percent at n=20', async () => {
  const slow = aggregateKey({ channel: 'production', tier: 'pro', at: '20260715T1200Z', outcome: 'completed', latencyBucket: '>120s' });
  const fast = aggregateKey({ channel: 'production', tier: 'pro', at: '20260715T1200Z', outcome: 'completed', latencyBucket: '<=30s' });
  const n10 = await evaluateProMonitor(deps({ aggregateReader: snapshot({ [fast]: 9, [slow]: 1 }), logQuery: async () => ({}) }));
  const n20 = await evaluateProMonitor(deps({ aggregateReader: snapshot({ [fast]: 19, [slow]: 1 }), logQuery: async () => ({}) }));
  assert.deepEqual(n10.triggers.map(({ trigger }) => trigger), ['p95_latency', 'latency_tail']);
  assert.deepEqual(n20.triggers, []);
});
test('a shared store isolates channel snapshots, stale counts, and alert control state', async () => {
  const productionCount = aggregateKey({ channel: 'production', tier: 'pro', at: '20260715T1200Z', outcome: 'completed', latencyBucket: '<=30s' });
  const staleStagingCount = aggregateKey({ channel: 'staging', tier: 'pro', at: '20260715T1115Z', outcome: 'completed', latencyBucket: '<=30s' });
  const aggregateValues = new Map([[productionCount, 1], [staleStagingCount, 9]]);
  const requestedKeys = [];
  const aggregateReader = { async snapshot(keys) {
    requestedKeys.push(keys);
    return Object.fromEntries(keys.map((item) => [item, aggregateValues.get(item) ?? 0]));
  } };
  const control = store();
  const sent = [];
  const common = {
    aggregateReader,
    controlStore: control,
    logQuery: async () => ({ numberSafety: 1 }),
    discordSender: async (payload) => { sent.push(payload); return { status: 204, receiptId: `${payload.channel}-${payload.trigger}` }; },
  };
  const production = await evaluateProMonitor(deps(common));
  const staging = await evaluateProMonitor(deps({ ...common, channel: 'staging' }));

  assert.equal(production.denominators.productionAggregate, 1);
  assert.equal(staging.denominators.productionAggregate, 0);
  assert.ok(requestedKeys[0].every((item) => item.startsWith('patina:mon:v1:production:pro:')));
  assert.ok(requestedKeys[1].every((item) => item.startsWith('patina:mon:v1:staging:pro:')));
  assert.equal(requestedKeys[1].includes(staleStagingCount), false);
  assert.deepEqual(staging.triggers, [
    { trigger: 'number_safety', count: 1, window: '15m' },
    { trigger: 'monitor_blind', count: 0, window: '30m', evidence: { reason: 'no_production_aggregate' } },
  ]);
  assert.equal(production.alerts.find(({ trigger }) => trigger === 'number_safety').sent, true);
  assert.equal(staging.alerts.find(({ trigger }) => trigger === 'number_safety').sent, true);
  assert.ok(control.values.has('patina:monctl:v1:production:pro:dedup:number_safety'));
  assert.ok(control.values.has('patina:monctl:v1:staging:pro:dedup:number_safety'));
  assert.deepEqual(control.values.get('patina:monctl:v1:production:pro:active'), ['production-number_safety']);
  assert.deepEqual(control.values.get('patina:monctl:v1:staging:pro:active'), ['staging-number_safety', 'staging-monitor_blind']);
  assert.equal(sent.filter(({ trigger }) => trigger === 'number_safety').length, 2);
});
test('complete null-filled MGET snapshots preserve zeroes while missing values remain unavailable', async () => {
  const count = key();
  const nullArray = await evaluateProMonitor(deps({ aggregateReader: { async snapshot(keys) { return keys.map((item) => item === count ? 1 : null); } } }));
  const nullObject = await evaluateProMonitor(deps({ aggregateReader: { async snapshot(keys) { return Object.fromEntries(keys.map((item) => [item, item === count ? 1 : null])); } } }));
  const undefinedArray = await evaluateProMonitor(deps({ aggregateReader: { async snapshot(keys) { return keys.map((item) => item === count ? 1 : undefined); } } }));
  const incompleteObject = await evaluateProMonitor(deps({ aggregateReader: { async snapshot() { return { [count]: 1 }; } } }));
  assert.equal(nullArray.aggregateAvailable, true);
  assert.equal(nullArray.denominators.productionAggregate, 1);
  assert.equal(nullObject.aggregateAvailable, true);
  assert.equal(nullObject.denominators.productionAggregate, 1);
  assert.equal(undefinedArray.aggregateAvailable, false);
  assert.equal(incompleteObject.aggregateAvailable, false);
});
test('dedup lease expires exactly at the one-hour boundary', async () => {
  let nowMs = NOW.getTime();
  const values = new Map();
  const leases = new Map();
  const acquireTtls = [];
  const controlStore = {
    async get(key) { return values.get(key); },
    async set(key, value) { values.set(key, value); return true; },
    async acquire(key, value, ttl) {
      acquireTtls.push(ttl);
      if (leases.get(key)?.expiresAt > nowMs) return false;
      leases.set(key, { value, expiresAt: nowMs + ttl });
      return true;
    },
    async release(key, value) { if (leases.get(key)?.value !== value) return false; leases.delete(key); return true; },
    async acknowledge(leaseKey, leaseValue, activeKey, receiptId) { if (leases.get(leaseKey)?.value !== leaseValue) return false; values.set(activeKey, Object.freeze([...(values.get(activeKey) ?? []), receiptId])); return true; },
  };
  let sends = 0;
  const common = deps({
    clock: () => new Date(nowMs),
    controlStore,
    aggregateReader: { async snapshot(keys) { return Object.fromEntries(keys.map((item) => [item, item.endsWith(':completed:<=30s') ? 1 : 0])); } },
    logQuery: async () => ({ numberSafety: 1 }),
    discordSender: async () => { sends += 1; return { status: 204, receiptId: `alert-${sends}` }; },
  });
  const first = await evaluateProMonitor(common);
  nowMs += 3_599_999;
  const beforeExpiry = await evaluateProMonitor(common);
  nowMs += 1;
  const atExpiry = await evaluateProMonitor(common);

  assert.equal(first.alerts[0].sent, true);
  assert.equal(beforeExpiry.alerts[0].deduped, true);
  assert.equal(atExpiry.alerts[0].sent, true);
  assert.equal(sends, 2);
  assert.deepEqual(acquireTtls, [3_600_000, 3_600_000, 3_600_000]);
});
test('active acknowledgements retain recovery linkage at the exact one-hour dedup boundary', async () => {
  let nowMs = NOW.getTime();
  const values = new Map(); const leases = new Map(); const activeExpiry = new Map(); const ackTtls = []; const leaseTtls = [];
  const activeKey = 'patina:monctl:v1:production:pro:active';
  const controlStore = {
    async get(keyName) { if (keyName === activeKey && activeExpiry.get(keyName) < nowMs) return undefined; return values.get(keyName); },
    async set(keyName, value) { values.set(keyName, value); return true; },
    async acquire(keyName, value, ttl) { leaseTtls.push(ttl); if (leases.get(keyName)?.expiresAt > nowMs) return false; leases.set(keyName, { value, expiresAt: nowMs + ttl }); return true; },
    async release(keyName, value) { if (leases.get(keyName)?.value !== value) return false; leases.delete(keyName); return true; },
    async acknowledge(leaseKey, leaseValue, keyName, receiptId, ttl) { if (leases.get(leaseKey)?.value !== leaseValue) return false; ackTtls.push(ttl); values.set(keyName, Object.freeze([...(values.get(keyName) ?? []), receiptId])); activeExpiry.set(keyName, nowMs + ttl); return true; },
    async completeRecovery(keyName, recoveryKey, recoveryValue, expectedActiveIds, recovery) { if (JSON.stringify(values.get(keyName)) !== JSON.stringify(expectedActiveIds) || leases.get(recoveryKey)?.value !== recoveryValue) return false; values.set(recoveryKey, recovery); values.set(keyName, Object.freeze([])); return true; },
  };
  const common = deps({ clock: () => new Date(nowMs), controlStore, aggregateReader: { async snapshot(keys) { return Object.fromEntries(keys.map((item) => [item, item.endsWith(':completed:<=30s') ? 1 : 0])); } }, logQuery: async () => ({ numberSafety: nowMs === NOW.getTime() ? 1 : 0 }), discordSender: async (payload) => ({ status: 204, receiptId: payload.trigger === 'monitor_recovered' ? 'recovery-a' : 'alert-a' }) });
  await evaluateProMonitor(common);
  nowMs += 3_600_000;
  const recovered = await evaluateProMonitor(common);
  assert.equal(ackTtls[0], 7_200_000);
  assert.equal(recovered.recoveryReceiptId, 'recovery-a');
  assert.deepEqual(recovered.recovery.linkedAlertReceiptIds, ['alert-a']);
  assert.ok(leaseTtls.every((ttl) => ttl === 3_600_000));
});
test('rejects malformed MGET counters as an unavailable whole snapshot', async () => {
  for (const malformed of [true, false, 1.5, -1, '01', '1.0', '-1', 'junk', '9007199254740992']) {
    const result = await evaluateProMonitor(deps({ aggregateReader: { async mget(keys) { return keys.map((item, index) => index === 0 ? malformed : null); } } }));
    assert.equal(result.aggregateAvailable, false, String(malformed));
    assert.equal(result.histogram.n, 0, String(malformed));
  }
});
test('ambiguous leases and failed alert release abort evaluation without an acknowledgement', async () => {
  const ambiguous = store();
  ambiguous.acquire = async () => undefined;
  await assert.rejects(() => evaluateProMonitor(deps({ controlStore: ambiguous, logQuery: async () => ({ numberSafety: 1 }) })), /ambiguous control lease acquisition/);
  const releaseFailure = store();
  releaseFailure.release = async () => false;
  await assert.rejects(() => evaluateProMonitor(deps({ controlStore: releaseFailure, logQuery: async () => ({ numberSafety: 1 }), discordSender: async () => ({ status: 500 }) })), /control lease release failed/);
  assert.equal(releaseFailure.values.has('patina:monctl:v1:production:pro:active'), false);
});
test('failed atomic acknowledgement never reports an alert receipt', async () => {
  const control = store();
  control.acknowledge = async () => false;
  await assert.rejects(() => evaluateProMonitor(deps({ controlStore: control, logQuery: async () => ({ numberSafety: 1 }) })), /alert acknowledgement failed/);
  assert.equal(control.values.has('patina:monctl:v1:production:pro:active'), false);
});
test('recovery completion failure preserves active state and propagates', async () => {
  const control = store();
  control.values.set('patina:monctl:v1:production:pro:active', Object.freeze(['alert-a']));
  control.completeRecovery = async () => false;
  await assert.rejects(() => evaluateProMonitor(deps({ controlStore: control, aggregateReader: snapshot({ [key()]: 1 }) })), /recovery completion failed/);
  assert.deepEqual(control.values.get('patina:monctl:v1:production:pro:active'), ['alert-a']);
});
test('recovery fails closed for malformed or duplicate persisted active receipt IDs', async () => {
  for (const value of ['alert-a', ['alert-a', 'alert-a'], ['alert-a', 'unsafe receipt'], [1]]) {
    const control = store();
    control.values.set('patina:monctl:v1:production:pro:active', value);
    let sends = 0;
    await assert.rejects(() => evaluateProMonitor(deps({ controlStore: control, aggregateReader: snapshot({ [key()]: 1 }), discordSender: async () => { sends += 1; return { status: 204, receiptId: 'recovery-a' }; } })), /invalid active receipt state/);
    assert.equal(sends, 0);
  }
});
test('recovery completion rejects a lease owned by another caller', async () => {
  const control = store();
  control.values.set('patina:monctl:v1:production:pro:active', Object.freeze(['alert-a']));
  control.completeRecovery = async (activeKey, recoveryKey, recoveryValue) => control.values.get(recoveryKey) === `${recoveryValue}-other`;
  await assert.rejects(() => evaluateProMonitor(deps({ controlStore: control, aggregateReader: snapshot({ [key()]: 1 }) })), /recovery completion failed/);
  assert.deepEqual(control.values.get('patina:monctl:v1:production:pro:active'), ['alert-a']);
});
test('prepares closed alert evidence after delivery and before atomic acknowledgement', async () => {
  const control = store(); const events = []; let prepared;
  const acknowledge = control.acknowledge.bind(control);
  control.acknowledge = async (...args) => { events.push('acknowledge'); prepared = args[5]; return acknowledge(...args); };
  const result = await evaluateProMonitor(deps({
    controlStore: control,
    aggregateReader: snapshot({ [key()]: 1 }),
    logQuery: async () => ({ numberSafety: 1, entitlementTotal: 19, entitlementNonOk: 5 }),
    discordSender: async () => { events.push('discord'); return { status: 204, receiptId: 'alert-a' }; },
    prepareAlertEvidence: (fact) => {
      events.push('prepare');
      assert.equal(Object.isFrozen(fact), true);
      assert.deepEqual(fact.trigger, { trigger: 'number_safety', count: 1, window: '15m' });
      assert.deepEqual(fact.alert, { receiptId: 'alert-a', attempts: 1 });
      assert.equal(fact.denominators.entitlementNonOk, 5);
      assert.equal(fact.realPath, true);
      return { receiptId: 'outbox-a' };
    },
  }));
  assert.deepEqual(events, ['discord', 'prepare', 'acknowledge']);
  assert.deepEqual(prepared, { receiptId: 'outbox-a' });
  assert.deepEqual(result.alertReceiptIds, ['alert-a']);
});
test('invalid alert preparation releases the lease and does not acknowledge', async () => {
  const control = store(); let acknowledged = false; let released = false;
  const release = control.release.bind(control);
  control.release = async (...args) => { released = true; return release(...args); };
  control.acknowledge = async () => { acknowledged = true; return true; };
  await assert.rejects(() => evaluateProMonitor(deps({ controlStore: control, logQuery: async () => ({ numberSafety: 1 }), prepareAlertEvidence: () => null })), /evidence preparation failed/);
  assert.equal(released, true);
  assert.equal(acknowledged, false);
  assert.equal(control.values.has('patina:monctl:v1:production:pro:active'), false);
});
test('prepares recovery evidence after delivery and before atomic completion', async () => {
  const control = store(); const events = []; let prepared;
  control.values.set('patina:monctl:v1:production:pro:active', Object.freeze(['alert-a']));
  const complete = control.completeRecovery.bind(control);
  control.completeRecovery = async (...args) => { events.push('complete'); prepared = args[6]; return complete(...args); };
  const result = await evaluateProMonitor(deps({
    controlStore: control, aggregateReader: snapshot({ [key()]: 1 }),
    discordSender: async () => { events.push('discord'); return { status: 204, receiptId: 'recovery-a' }; },
    prepareRecoveryEvidence: (fact) => {
      events.push('prepare');
      assert.deepEqual(fact.recovery, { receiptId: 'recovery-a', attempts: 1, linkedAlertReceiptIds: ['alert-a'] });
      return { receiptIds: ['outbox-recovery'] };
    },
  }));
  assert.deepEqual(events, ['discord', 'prepare', 'complete']);
  assert.deepEqual(prepared, { receiptIds: ['outbox-recovery'] });
  assert.equal(result.recoveryReceiptId, 'recovery-a');
});
test('failed recovery preparation releases the owned lease without clearing active state', async () => {
  const control = store(); let completed = false;
  control.values.set('patina:monctl:v1:production:pro:active', Object.freeze(['alert-a']));
  control.completeRecovery = async () => { completed = true; return true; };
  await assert.rejects(() => evaluateProMonitor(deps({ controlStore: control, aggregateReader: snapshot({ [key()]: 1 }), prepareRecoveryEvidence: () => ({ receiptId: 'unsafe receipt' }) })), /evidence preparation failed/);
  assert.equal(completed, false);
  assert.deepEqual(control.values.get('patina:monctl:v1:production:pro:active'), ['alert-a']);
  assert.equal(control.values.has('patina:monctl:v1:production:pro:recovery'), false);
});
