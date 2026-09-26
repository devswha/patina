// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { mpsResult, fidelityResult } from '../fixtures/verification-results.js';
import { createRewriteApiHandler } from '../../api/rewrite.js';
import { createProMonitorApiHandler } from '../../api/pro-monitor.js';
import { runWebRewriteStream } from '../../src/web-rewrite-stream.js';

/** @typedef {Exclude<Parameters<typeof createProMonitorApiHandler>[0], undefined>} ProMonitorOptions */
/** @param {unknown} fake @returns {ProMonitorOptions['fetchImpl']} */
function fetchFake(fake) { return /** @type {ProMonitorOptions['fetchImpl']} */ (fake); }
const BASE = Date.parse('2026-07-15T12:00:00.000Z');
const AGGREGATE_PREFIX = 'patina:mon:v1';
const CONTROL_PREFIX = 'patina:monctl:v1:production:pro';
const logUrl = 'https://logs.example.net/v1/aggregate';
function response() { const chunks = []; return { statusCode: 200, setHeader() {}, write(value) { chunks.push(String(value)); }, end(value = '') { chunks.push(String(value)); this.body = chunks.join(''); }, on() { return this; }, off() { return this; }, body: '' }; }
function rewriteRequest(authorization, text = 'Order 7 units.') { return { method: 'POST', headers: { 'x-real-ip': '203.0.113.80', ...(authorization ? { authorization } : {}) }, body: JSON.stringify({ mode: 'first', lang: 'en', tier: 'pro', text }) }; }
function textResponse(value) { return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ result: value }) }; }
function flush() { return new Promise((resolve) => setTimeout(resolve, 0)); }

test('real rewrite aggregates flow through protected cron, acknowledged Discord alerts, and an atomic healthy recovery', async () => {
  const clock = { ms: BASE }; const aggregate = new Map(); const controls = new Map(); const observerEvents = []; const commands = []; const discord = []; let directAggregateSeed = 0; let latencyIndex = -1; let discordFailures = 9;
  const env = {
    NODE_ENV: 'test', PATINA_DEPLOYMENT_CHANNEL: 'production', PATINA_PRO_API_KEY: 'pro-key', PATINA_LICENSE_HMAC_SECRET: 'hmac-secret', POLAR_ORGANIZATION_ID: 'org-uuid', POLAR_PRO_BENEFIT_ID: 'benefit-uuid',
    CRON_SECRET: 'cron-secret', VERCEL_GIT_COMMIT_SHA: '0123456789abcdef0123456789abcdef01234567',
    PATINA_OBSERVABILITY_REST_API_URL: 'https://telemetry.upstash.io', PATINA_OBSERVABILITY_REST_API_TOKEN: 'observability-token',
    PATINA_PUBLIC_BASE_URL: 'https://patina.example.com', PATINA_SYNTHETIC_PRO_LICENSE: 'synthetic-license', PATINA_SYNTHETIC_OBSERVER_SECRET: 'synthetic-observer',
    PATINA_ALERT_DISCORD_WEBHOOK: 'https://discord.com/api/webhooks/123456789012345678/token',
    PATINA_VERCEL_LOG_QUERY_URL: logUrl, PATINA_VERCEL_LOG_QUERY_TOKEN: 'log-token',
  };
  const observabilityKv = {
    increment(key, { ttlSeconds }) { const old = aggregate.get(key) ?? 0; aggregate.set(key, old + 1); assert.ok(ttlSeconds > 0); return Promise.resolve(old + 1); },
    get(key) { return aggregate.get(key); }, snapshot(keys) { return Promise.resolve(keys.map((key) => aggregate.get(key) ?? 0)); },
    set() { directAggregateSeed += 1; throw new Error('aggregate evidence must come from rewrite observers'); },
  };
  const logger = { info(value) { if (value?.schema === 'patina.web.v2') observerEvents.push({ at: clock.ms, event: value }); }, warn() {}, error() {}, debug() {} };
  const runner = async ({ request, emit, signal, timeout, observe }) => runWebRewriteStream({ request, emit, signal, timeout, observe, now: () => clock.ms, callLLMStream: async ({ onDelta }) => { clock.ms += request.text === 'Patina monitor health check.' ? 0 : latencyIndex < 0 ? 10_000 : [10_000, 40_000, 90_000, 130_000, 130_000, 130_000, 130_000, 130_000, 130_000, 130_000][latencyIndex]; const value = request.text === 'Patina monitor health check.' ? request.text : request.text.includes('mismatch') ? 'Order 8 units.' : 'Order 7 units.'; onDelta(value); return { text: value }; }, scoreFns: { scoreMPS: async () => (mpsResult(95)), scoreFidelity: async () => (fidelityResult(11)), scoreDeterministicSignals: () => ({}) } });
  const originalFetch = globalThis.fetch; const RealDate = Date;
  globalThis.fetch = /** @type {any} */ (async () => ({ ok: true, status: 200, json: async () => ({ organization_id: 'org-uuid', benefit_id: 'benefit-uuid', status: 'granted', expires_at: null }) }));
  try {
    const rewrite = createRewriteApiHandler({ env, now: () => clock.ms, logger, observabilityKv, runWebRewriteStreamImpl: runner });
    let output = response(); await rewrite(rewriteRequest('Bearer POLAR-RAW-PRO-CANARY', 'Order 7 units mismatch.'), output); await flush(); assert.match(output.body, /number_safety_failed/);
    output = response(); await rewrite(rewriteRequest(), output); await flush(); assert.equal(output.statusCode, 401);
    for (let i = 0; i < 10; i += 1) { latencyIndex = i; clock.ms = BASE; output = response(); await rewrite(rewriteRequest('Bearer POLAR-RAW-PRO-CANARY'), output); await flush(); assert.equal(output.statusCode, 200); }
    assert.equal(directAggregateSeed, 0); assert.ok([...aggregate.keys()].every((key) => key.startsWith(`${AGGREGATE_PREFIX}:production:pro:`)));
    assert.ok(observerEvents.some(({ event }) => event.outcome === 'number_safety_failed'));

    const fetchImpl = async (url, options = {}) => {
      const target = String(url);
      if (target === env.PATINA_OBSERVABILITY_REST_API_URL) {
        const command = JSON.parse(String(options.body)); commands.push(command); const [verb, script, keyCount, ...rest] = command;
        if (verb === 'MGET') return textResponse([script, keyCount, ...rest].map((key) => aggregate.get(key) ?? null));
        if (verb === 'GET') return textResponse(controls.get(script) ?? null);
        if (verb === 'SET') { const [key, value, mode, , nx] = [script, keyCount, ...rest]; if (key.startsWith(`${AGGREGATE_PREFIX}:`)) { directAggregateSeed += 1; throw new Error('direct aggregate seed'); } if (mode === 'PX' && nx === 'NX' && controls.has(key)) return textResponse(null); controls.set(key, value); return textResponse('OK'); }
        assert.equal(verb, 'EVAL'); const keys = rest.slice(0, Number(keyCount)); const args = rest.slice(Number(keyCount));
        if (script.includes('cjson.decode')) { const [lease, active] = keys; if (controls.get(lease) !== args[0]) return textResponse(0); const ids = JSON.parse(controls.get(active) ?? '[]'); if (!ids.includes(args[1])) ids.push(args[1]); controls.set(active, JSON.stringify(ids)); return textResponse(1); }
        if (keys.length === 2) { const [active, lease] = keys; if (controls.get(lease) !== args[0] || controls.get(active) !== args[1]) return textResponse(0); controls.delete(active); controls.delete(lease); return textResponse(1); }
        assert.equal(controls.get(keys[0]), args[0]); controls.delete(keys[0]); return textResponse(1);
      }
      if (target.startsWith(logUrl)) { const query = new URL(target).searchParams; assert.equal(query.get('aggregate_only'), 'true'); const windowMs = query.get('window') === '15m' ? 900_000 : 1_800_000; const events = observerEvents.filter(({ at }) => at > clock.ms - windowMs).map(({ event }) => event); return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(query.get('window') === '15m' ? { numberSafety: events.filter((e) => e.outcome === 'number_safety_failed').length, entitlementNonOk: 0, entitlementTotal: 0 } : { monitorDrop: 0 }) }; }
      if (target === 'https://patina.example.com/api/rewrite') {
        const syntheticResponse = response();
        await rewrite({ method: 'POST', headers: { authorization: options.headers.Authorization, 'x-real-ip': '203.0.113.80', 'x-patina-synthetic-observer': options.headers['x-patina-synthetic-observer'] }, body: options.body, on() { return this; }, off() { return this; } }, syntheticResponse);
        return { ok: syntheticResponse.statusCode === 200, status: syntheticResponse.statusCode, headers: { get: () => 'application/x-ndjson' }, text: async () => syntheticResponse.body };
      }
      if (target.startsWith('https://discord.com/')) { if (discordFailures-- > 0) return { ok: false, status: 500, headers: { get: () => 'application/json' }, text: async () => '{}' }; discord.push(JSON.parse(String(options.body))); return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ id: `discord-${discord.length}` }) }; }
      throw new Error(`unexpected ${target}`);
    };
    // The cron also evaluates the free tier; that path has its own suite
    // (free-tier-monitor.test.js) and this fixture configures no free provider,
    // so it is stubbed to keep this test scoped to the paid evidence chain.
    const freeStub = async () => (/** @type {any} */ ({ channel: 'production', tier: 'free', buckets: [], aggregateAvailable: true, denominators: { total: 0, failed: 0 }, canaryTerminal: null, triggers: [], alerts: [] }));
    const monitor = createProMonitorApiHandler({ env, fetchImpl: fetchFake(fetchImpl), evaluateFreeTierHealthImpl: freeStub });
    const cron = async (authorization = 'Bearer cron-secret') => { globalThis.Date = /** @type {DateConstructor} */ (/** @type {unknown} */ (class extends RealDate { constructor(value) { super(value === undefined ? clock.ms : value); } static now() { return clock.ms; } })); try { const res = response(); await monitor({ method: 'GET', headers: { authorization } }, res); return res; } finally { globalThis.Date = RealDate; } };
    assert.equal((await cron('Bearer wrong')).statusCode, 401);
    clock.ms = BASE + 130_000; const firstCron = await cron(); assert.equal(firstCron.statusCode, 200, firstCron.body); assert.equal(discord.length, 0);
    assert.equal((await cron()).statusCode, 200); assert.equal(discord.length, 3);
    const alerts = discord.map(({ content }) => JSON.parse(content));
    assert.deepEqual(alerts.map(({ trigger }) => trigger).sort(), ['latency_tail', 'number_safety', 'p95_latency']);
    assert.equal(alerts.find(({ trigger }) => trigger === 'p95_latency')?.countBand, '10-19');
    assert.deepEqual(JSON.parse(controls.get(`${CONTROL_PREFIX}:active`)), ['discord-1', 'discord-2', 'discord-3']);
    clock.ms = BASE + 46 * 60_000; latencyIndex = 0; output = response(); await rewrite(rewriteRequest('Bearer LS-RAW-PRO-CANARY'), output); await flush();
    assert.equal((await cron()).statusCode, 200); assert.equal(discord.length, 4);
    assert.deepEqual(JSON.parse(discord[3].content), { trigger: 'monitor_recovered', countBand: '2-4', window: '30m', channel: 'production', evidence: { reason: 'recovered' } });
    assert.equal(controls.has(`${CONTROL_PREFIX}:active`), false); assert.equal(controls.has(`${CONTROL_PREFIX}:recovery`), false);
    const evals = commands.filter(([verb]) => verb === 'EVAL');
    assert.ok(evals.some(([, script]) => String(script).includes('cjson.decode'))); assert.ok(evals.some(([, script, keyCount]) => !String(script).includes('cjson') && keyCount === '2'));
    assert.ok([...controls.keys()].every((key) => !/:(?:pending|obs|recovery):/.test(key)));
    assert.equal(directAggregateSeed, 0);
  } finally { globalThis.fetch = originalFetch; globalThis.Date = RealDate; }
});
