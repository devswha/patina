// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createProMonitorApiHandler } from '../../api/pro-monitor.js';
/** @typedef {Exclude<Parameters<typeof createProMonitorApiHandler>[0], undefined>} ProMonitorOptions */
/** @param {unknown} fake @returns {ProMonitorOptions['fetchImpl']} */
function fetchFake(fake) { return /** @type {ProMonitorOptions['fetchImpl']} */ (fake); }
/** @param {unknown} fake @returns {ProMonitorOptions['evaluateProMonitorImpl']} */
function evaluateFake(fake) { return /** @type {ProMonitorOptions['evaluateProMonitorImpl']} */ (fake); }

const logUrl = 'https://logs.example.net/v1/aggregate';
const env = Object.freeze({
  CRON_SECRET: 'cron-secret', PATINA_DEPLOYMENT_CHANNEL: 'production', VERCEL_GIT_COMMIT_SHA: '0123456789abcdef0123456789abcdef01234567',
  PATINA_OBSERVABILITY_REST_API_URL: 'https://telemetry.upstash.io', PATINA_OBSERVABILITY_REST_API_TOKEN: 'observability-token',
  PATINA_PUBLIC_BASE_URL: 'https://patina.example.com', PATINA_SYNTHETIC_PRO_LICENSE: 'license-secret', PATINA_SYNTHETIC_OBSERVER_SECRET: 'observer-secret',
  PATINA_PUBLIC_BASE_URL_SHA256: createHash('sha256').update('https://patina.example.com/').digest('hex'),
  PATINA_ALERT_DISCORD_WEBHOOK: 'https://discord.com/api/webhooks/123456789012345678/token-secret',
  PATINA_VERCEL_LOG_QUERY_URL: logUrl, PATINA_VERCEL_LOG_QUERY_TOKEN: 'log-token-secret',
  PATINA_VERCEL_LOG_QUERY_URL_SHA256: createHash('sha256').update(logUrl).digest('hex'),
});
function response() { return { statusCode: 200, setHeader() {}, end(value = '') { this.body = String(value); }, body: '' }; }
function request(overrides = {}) { return { method: 'GET', headers: { authorization: 'Bearer cron-secret' }, ...overrides }; }
function json(value) { return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ result: value }) }; }
function monitorResult() { return { channel: 'production', tier: 'pro', buckets: [], histogram: {}, syntheticStreak: 0, triggers: [], alerts: [], adapters: { aggregate: true, safetyEntitlementLogs: true, monitorDropLogs: true } }; }
function alertFact() { return { channel: 'production', tier: 'pro', buckets: ['20260715T1200Z'], histogram: { counts: { '<=30s': 1, '30-60s': 0, '60-120s': 0, '>120s': 0 }, n: 1, rank: 1, selectedBucket: '<=30s', upperBound: '30s', over120Ratio: 0 }, denominators: { productionAggregate: 1, entitlementTotal: 0, entitlementNonOk: 0, histogram: 1, numberSafety: 1, monitorDrop: 0 }, adapters: { aggregate: true, safetyEntitlementLogs: true, monitorDropLogs: true }, logWindows: { safetyEntitlement: { window: '15m', available: true, denominator: 0 }, monitorDrop: { window: '30m', available: true, denominator: 1 } }, syntheticTerminal: 'done', syntheticStreak: 0, realPath: true, trigger: { trigger: 'number_safety', count: 1, window: '15m' }, alert: { receiptId: 'discord-1', attempts: 1 } }; }

test('fails closed when any dedicated adapter configuration is absent or log endpoint pin is invalid', async () => {
  for (const key of ['PATINA_OBSERVABILITY_REST_API_URL', 'PATINA_OBSERVABILITY_REST_API_TOKEN', 'PATINA_VERCEL_LOG_QUERY_URL', 'PATINA_VERCEL_LOG_QUERY_TOKEN', 'PATINA_VERCEL_LOG_QUERY_URL_SHA256', 'PATINA_PUBLIC_BASE_URL', 'PATINA_PUBLIC_BASE_URL_SHA256', 'PATINA_SYNTHETIC_PRO_LICENSE', 'PATINA_SYNTHETIC_OBSERVER_SECRET', 'PATINA_ALERT_DISCORD_WEBHOOK']) {
    const handler = createProMonitorApiHandler({ env: { ...env, [key]: '' }, evaluateProMonitorImpl: evaluateFake(async () => monitorResult()) });
    const res = response(); await handler(request(), res);
    assert.equal(res.statusCode, 503, key);
  }
  const handler = createProMonitorApiHandler({ env: { ...env, PATINA_VERCEL_LOG_QUERY_URL_SHA256: '0'.repeat(64) }, evaluateProMonitorImpl: evaluateFake(async () => monitorResult()) });
  const res = response(); await handler(request(), res); assert.equal(res.statusCode, 503);
});

test('rejects unauthorized or non-empty cron requests before adapter I/O', async () => {
  let called = false;
  const handler = createProMonitorApiHandler({ env, evaluateProMonitorImpl: evaluateFake(async () => { called = true; return monitorResult(); }) });
  for (const req of [request({ method: 'POST' }), request({ body: '{}' }), request({ headers: { authorization: 'Bearer wrong' } }), request({ rawHeaders: ['Authorization', 'Bearer cron-secret', 'Authorization', 'Bearer cron-secret'] })]) {
    const res = response(); await handler(req, res); assert.ok([401, 405].includes(res.statusCode));
  }
  assert.equal(called, false);
});

test('uses pinned aggregate-only logs, bounded adapters, and Lua-backed control mutations', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url) === env.PATINA_OBSERVABILITY_REST_API_URL) return json(options.body ? 'OK' : null);
    if (String(url).startsWith(logUrl)) return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ numberSafety: 2, entitlementNonOk: 0, entitlementTotal: 0 }) };
    if (String(url).includes('/api/rewrite')) return { ok: true, status: 200, headers: { get: () => 'application/x-ndjson' }, text: async () => '{"type":"start"}\n{"type":"delta","text":"Patina"}\n{"type":"done","rewrite":"Patina"}\n' };
    if (String(url).includes('discord.com')) return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => '{"id":"discord-1"}' };
    throw new Error('unexpected URL');
  };
  const handler = createProMonitorApiHandler({ env, fetchImpl: fetchFake(fetchImpl), evaluateProMonitorImpl: evaluateFake(async (deps) => {
    assert.equal((await deps.logQuery({ channel: 'production', tier: 'pro', window: '15m', aggregateOnly: true, readOnly: true })).numberSafety, 2);
    await assert.rejects(deps.logQuery({ channel: 'production', tier: 'pro', window: '15m', aggregateOnly: false, readOnly: true }));
    assert.deepEqual(await deps.syntheticRequest(), { ok: true, terminal: 'done' });
    assert.deepEqual(await deps.discordSender({}), { status: 200, receiptId: 'discord-1' });
    await deps.controlStore.release('lease', 'owner');
    return monitorResult();
  }) });
  const res = response(); await handler(request(), res); assert.equal(res.statusCode, 200);
  const log = calls.find(({ url }) => url.startsWith(logUrl));
  assert.match(log.url, /aggregate_only=true/); assert.equal(log.options.method, 'GET'); assert.equal(log.options.redirect, 'error');
  const synthetic = calls.find(({ url }) => url.includes('/api/rewrite'));
  assert.equal(synthetic.options.headers['x-patina-synthetic-observer'], 'observer-secret'); assert.equal(synthetic.options.redirect, 'error');
  const evalCall = calls.find(({ url, options }) => url === env.PATINA_OBSERVABILITY_REST_API_URL && JSON.parse(options.body)[0] === 'EVAL');
  assert.ok(evalCall); assert.equal(JSON.parse(evalCall.options.body)[2], '1');
  assert.doesNotMatch(res.body, /token|secret/i);
});

test('fails closed for oversized adapter bodies and treats malformed synthetic frames as failed without leaking secrets', async () => {
  const oversized = createProMonitorApiHandler({ env, fetchImpl: fetchFake(async (url) => String(url).includes('/api/rewrite')
    ? { ok: true, status: 200, headers: { get: () => 'application/x-ndjson' }, text: async () => 'x'.repeat(64 * 1024 + 1) }
    : json({})), evaluateProMonitorImpl: evaluateFake(async (deps) => { assert.deepEqual(await deps.syntheticRequest(), { ok: false, terminal: 'failed' }); return monitorResult(); }) });
  let res = response(); await oversized(request(), res); assert.equal(res.statusCode, 200);
  /** @type {AbortSignal | undefined} */ let stalledSignal;
  const stalled = createProMonitorApiHandler({ env, fetchImpl: fetchFake(async (url, options = {}) => String(url).startsWith(logUrl)
    ? { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => { stalledSignal = options.signal; return new Promise(() => {}); } }
    : json({})), evaluateProMonitorImpl: evaluateFake(async (deps) => { await assert.rejects(deps.logQuery({ channel: 'production', tier: 'pro', window: '15m', aggregateOnly: true, readOnly: true })); return monitorResult(); }) });
  res = response(); await stalled(request(), res); assert.equal(res.statusCode, 200); assert.ok(stalledSignal); assert.equal(stalledSignal.aborted, true); assert.doesNotMatch(res.body, /secret|token/i);
});
test('rejects extra nested pending evidence keys before acknowledgement', async () => {
  const handler = createProMonitorApiHandler({ env, evaluateProMonitorImpl: evaluateFake(async (deps) => {
    const valid = alertFact(); const prepared = await deps.prepareAlertEvidence(valid);
    assert.deepEqual(Object.keys(prepared.histogram.counts).sort(), ['30-60s', '60-120s', '<=30s', '>120s']);
    await assert.rejects(deps.prepareAlertEvidence({ ...alertFact(), histogram: { ...valid.histogram, counts: { ...valid.histogram.counts, injected: 1 } } }));
    await assert.rejects(deps.prepareAlertEvidence({ ...alertFact(), logWindows: { ...valid.logWindows, monitorDrop: { ...valid.logWindows.monitorDrop, extra: true } } }));
    return monitorResult();
  }) });
  const res = response(); await handler(request(), res); assert.equal(res.statusCode, 200);
});
test('validates every latency bucket before creating durable recovery receipts', async () => {
  let pending;
  const fetchImpl = async (_url, options) => {
    const [verb, key] = JSON.parse(String(options.body));
    assert.equal(verb, 'GET'); assert.match(key, /:pending:discord-1$/);
    return json(pending);
  };
  const handler = createProMonitorApiHandler({ env, fetchImpl: fetchFake(fetchImpl), evaluateProMonitorImpl: evaluateFake(async (deps) => {
    pending = await deps.prepareAlertEvidence(alertFact());
    const healthy = alertFact();
    healthy.histogram = { counts: { '<=30s': 0, '30-60s': 0, '60-120s': 0, '>120s': 0 }, n: 0, rank: 0, selectedBucket: null, upperBound: null, over120Ratio: 0 };
    healthy.denominators = { productionAggregate: 1, entitlementTotal: 0, entitlementNonOk: 0, histogram: 0, numberSafety: 0, monitorDrop: 0 };
    delete healthy.trigger; delete healthy.alert; healthy.recovery = { receiptId: 'recovery-1', attempts: 1, linkedAlertReceiptIds: ['discord-1'] };
    assert.equal((await deps.prepareRecoveryEvidence(healthy)).finals.length, 1);
    for (const invalid of [{}, '0', false, -1, Number.MAX_SAFE_INTEGER + 1]) {
      pending = { ...await deps.prepareAlertEvidence(alertFact()), histogram: { ...alertFact().histogram, counts: { '<=30s': 1, '30-60s': invalid, '60-120s': 1, '>120s': 0 } } };
      await assert.rejects(deps.prepareRecoveryEvidence(healthy));
    }
    return monitorResult();
  }) });
  const res = response(); await handler(request(), res); assert.equal(res.statusCode, 200);
});
test('uses the 20+ final count band after healthy recovery', async () => {
  let pending;
  const fetchImpl = async (_url, options) => {
    const [verb, key] = JSON.parse(String(options.body));
    assert.equal(verb, 'GET'); assert.match(key, /:pending:discord-20$/);
    return json(pending);
  };
  const handler = createProMonitorApiHandler({ env, fetchImpl: fetchFake(fetchImpl), evaluateProMonitorImpl: evaluateFake(async (deps) => {
    const alert = alertFact(); alert.denominators = { ...alert.denominators, productionAggregate: 20, numberSafety: 20 }; alert.logWindows = { ...alert.logWindows, monitorDrop: { ...alert.logWindows.monitorDrop, denominator: 20 } };
    alert.trigger = { trigger: 'number_safety', count: 20, window: '15m' }; alert.alert = { receiptId: 'discord-20', attempts: 1 };
    pending = await deps.prepareAlertEvidence(alert);
    const healthy = alertFact(); healthy.histogram = { counts: { '<=30s': 0, '30-60s': 0, '60-120s': 0, '>120s': 0 }, n: 0, rank: 0, selectedBucket: null, upperBound: null, over120Ratio: 0 }; healthy.denominators = { productionAggregate: 1, entitlementTotal: 0, entitlementNonOk: 0, histogram: 0, numberSafety: 0, monitorDrop: 0 }; healthy.logWindows = { safetyEntitlement: { window: '15m', available: true, denominator: 0 }, monitorDrop: { window: '30m', available: true, denominator: 1 } }; delete healthy.trigger; delete healthy.alert; healthy.recovery = { receiptId: 'recovery-20', attempts: 1, linkedAlertReceiptIds: ['discord-20'] };
    const prepared = await deps.prepareRecoveryEvidence(healthy);
    assert.equal(prepared.finals[0].countBand, '20+'); assert.match(prepared.finals[0].issuedAt, /Z$/);
    return monitorResult();
  }) });
  const res = response(); await handler(request(), res); assert.equal(res.statusCode, 200);
});
