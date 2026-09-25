// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
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
  PATINA_ALERT_DISCORD_WEBHOOK: 'https://discord.com/api/webhooks/123456789012345678/token-secret',
  PATINA_VERCEL_LOG_QUERY_URL: logUrl, PATINA_VERCEL_LOG_QUERY_TOKEN: 'log-token-secret',
});
function response() { return { statusCode: 200, setHeader() {}, end(value = '') { this.body = String(value); }, body: '' }; }
function request(overrides = {}) { return { method: 'GET', headers: { authorization: 'Bearer cron-secret' }, ...overrides }; }
function json(value) { return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ result: value }) }; }
function monitorResult() { return { channel: 'production', tier: 'pro', buckets: [], histogram: {}, syntheticStreak: 0, triggers: [], alerts: [], adapters: { aggregate: true, safetyEntitlementLogs: true, monitorDropLogs: true } }; }

test('fails closed when any dedicated adapter configuration is absent', async () => {
  for (const key of ['PATINA_OBSERVABILITY_REST_API_URL', 'PATINA_OBSERVABILITY_REST_API_TOKEN', 'PATINA_VERCEL_LOG_QUERY_URL', 'PATINA_VERCEL_LOG_QUERY_TOKEN', 'PATINA_PUBLIC_BASE_URL', 'PATINA_SYNTHETIC_PRO_LICENSE', 'PATINA_SYNTHETIC_OBSERVER_SECRET', 'PATINA_ALERT_DISCORD_WEBHOOK']) {
    const handler = createProMonitorApiHandler({ env: { ...env, [key]: '' }, evaluateProMonitorImpl: evaluateFake(async () => monitorResult()) });
    const res = response(); await handler(request(), res);
    assert.equal(res.statusCode, 503, key);
  }
});

test('rejects unauthorized or non-empty cron requests before adapter I/O', async () => {
  let called = false;
  const handler = createProMonitorApiHandler({ env, evaluateProMonitorImpl: evaluateFake(async () => { called = true; return monitorResult(); }) });
  for (const req of [request({ method: 'POST' }), request({ body: '{}' }), request({ headers: { authorization: 'Bearer wrong' } }), request({ rawHeaders: ['Authorization', 'Bearer cron-secret', 'Authorization', 'Bearer cron-secret'] })]) {
    const res = response(); await handler(req, res); assert.ok([401, 405].includes(res.statusCode));
  }
  assert.equal(called, false);
});

test('Discord delivery uses a valid content envelope, disables mentions, and requests its receipt', async () => {
  const payload = { trigger: 'monitor_blind', countBand: '0', window: '30m', channel: 'production', evidence: { reason: 'no_production_aggregate' } };
  let delivered = false;
  const handler = createProMonitorApiHandler({ env,
    fetchImpl: fetchFake(async (url, options) => {
      assert.equal(new URL(String(url)).searchParams.get('wait'), 'true');
      const body = JSON.parse(options.body);
      // Discord rejects the old top-level trigger/countBand object as empty.
      if (typeof body.content !== 'string' || !body.content) return { ok: false, status: 400 };
      assert.deepEqual(JSON.parse(body.content), payload);
      assert.deepEqual(body.allowed_mentions, { parse: [] });
      assert.ok(body.content.length <= 2000); delivered = true;
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => '{"id":"123456789012345678"}' };
    }),
    evaluateProMonitorImpl: evaluateFake(async (deps) => {
      assert.deepEqual(await deps.discordSender(payload), { status: 200, receiptId: '123456789012345678' });
      return monitorResult();
    }), evaluateFreeTierHealthImpl: /** @type {any} */ (async () => null),
  });
  const res = response(); await handler(request(), res);
  assert.equal(res.statusCode, 200); assert.equal(delivered, true);
});

test('monitor diagnostics distinguish configuration, input and evaluation failures without secrets', async () => {
  const events = [];
  const logger = { warn(event) { events.push(event); } };
  let res = response();
  await createProMonitorApiHandler({ env: { ...env, PATINA_VERCEL_LOG_QUERY_TOKEN: '' }, logger })(request(), res);
  assert.equal(res.statusCode, 503);
  assert.equal(events[0].stage, 'configuration');
  assert.equal(events[0].adapters.logs, false);
  assert.equal(events[0].adapters.aggregate, true);

  res = response();
  await createProMonitorApiHandler({ env, logger, evaluateProMonitorImpl: evaluateFake(async () => ({
    ...monitorResult(), adapters: { aggregate: true, safetyEntitlementLogs: false, monitorDropLogs: true },
  })), evaluateFreeTierHealthImpl: /** @type {any} */ (async () => null) })(request(), res);
  assert.equal(res.statusCode, 503);
  assert.equal(events[1].stage, 'inputs');
  assert.equal(events[1].adapters.safetyEntitlementLogs, false);

  res = response();
  await createProMonitorApiHandler({ env, logger, evaluateProMonitorImpl: evaluateFake(async () => {
    throw new Error('secret provider response https://private.example/token-secret');
  }) })(request(), res);
  assert.equal(res.statusCode, 503);
  assert.equal(events[2].stage, 'evaluation');
  assert.doesNotMatch(JSON.stringify(events), /token-secret|private\.example|cron-secret|license-secret|observer-secret/);
  assert.deepEqual(JSON.parse(res.body), { error: 'monitor_unavailable' });
});

test('diagnostic logger failures preserve the closed monitor response', async () => {
  const res = response();
  await createProMonitorApiHandler({ env: {}, logger: { warn() { throw new Error('logger failed'); } } })(request({ headers: {} }), res);
  assert.equal(res.statusCode, 401);
  await createProMonitorApiHandler({ env: { CRON_SECRET: 'cron-secret' }, logger: { warn() { throw new Error('logger failed'); } } })(request(), res);
  assert.equal(res.statusCode, 503);
  await createProMonitorApiHandler({ env: { CRON_SECRET: 'cron-secret' }, logger: { async warn() { throw new Error('async logger failed'); } } })(request(), res);
  assert.equal(res.statusCode, 503);
});

test('uses aggregate-only logs, bounded adapters, and Lua-backed control mutations', async () => {
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
