// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRewriteApiHandler } from '../../api/rewrite.js';
import { createProMonitorApiHandler } from '../../api/pro-monitor.js';
import { runWebRewriteStream } from '../../src/web-rewrite-stream.js';
import { MONITOR_KEY_PREFIX } from '../../src/pro-monitor.js';

/** @typedef {Exclude<Parameters<typeof createProMonitorApiHandler>[0], undefined>} ProMonitorOptions */
/** @param {unknown} fake @returns {ProMonitorOptions['fetchImpl']} */
function fetchFake(fake) { return /** @type {ProMonitorOptions['fetchImpl']} */ (fake); }
const BASE = Date.parse('2026-07-15T12:00:00.000Z');
const logUrl = 'https://logs.example.net/v1/aggregate';
function response() { const chunks = []; return { statusCode: 200, setHeader() {}, write(value) { chunks.push(String(value)); }, end(value = '') { chunks.push(String(value)); this.body = chunks.join(''); }, on() { return this; }, off() { return this; }, body: '' }; }
function rewriteRequest(authorization, text = 'Order 7 units.') { return { method: 'POST', headers: { 'x-real-ip': '203.0.113.80', ...(authorization ? { authorization } : {}) }, body: JSON.stringify({ mode: 'first', lang: 'en', tier: 'pro', text }) }; }
function textResponse(value) { return { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ result: value }) }; }
function canonical(value) { return Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value; }
function artifactHash(receipt) { const { artifactHash: _ignored, ...payload } = receipt; return createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex'); }
function flush() { return new Promise((resolve) => setTimeout(resolve, 0)); }

test('real rewrite aggregates flow through protected cron, pending Discord alerts, and atomic healthy-recovery OBS receipts', async () => {
  const clock = { ms: BASE }; const aggregate = new Map(); const controls = new Map(); const observerEvents = []; const commands = []; const discord = []; let directAggregateSeed = 0; let latencyIndex = -1; let discordFailures = 9;
  const env = {
    NODE_ENV: 'test', PATINA_DEPLOYMENT_CHANNEL: 'production', PATINA_PRO_API_KEY: 'pro-key', PATINA_LICENSE_HMAC_SECRET: 'hmac-secret', LS_STORE_ID: '42', LS_PRO_VARIANT_ID: '99',
    CRON_SECRET: 'cron-secret', VERCEL_GIT_COMMIT_SHA: '0123456789abcdef0123456789abcdef01234567',
    PATINA_OBSERVABILITY_REST_API_URL: 'https://telemetry.upstash.io', PATINA_OBSERVABILITY_REST_API_TOKEN: 'observability-token',
    PATINA_PUBLIC_BASE_URL: 'https://patina.example.com', PATINA_SYNTHETIC_PRO_LICENSE: 'synthetic-license', PATINA_SYNTHETIC_OBSERVER_SECRET: 'synthetic-observer',
    PATINA_PUBLIC_BASE_URL_SHA256: createHash('sha256').update('https://patina.example.com/').digest('hex'),
    PATINA_ALERT_DISCORD_WEBHOOK: 'https://discord.com/api/webhooks/123456789012345678/token',
    PATINA_VERCEL_LOG_QUERY_URL: logUrl, PATINA_VERCEL_LOG_QUERY_TOKEN: 'log-token', PATINA_VERCEL_LOG_QUERY_URL_SHA256: createHash('sha256').update(logUrl).digest('hex'),
  };
  const observabilityKv = {
    increment(key, { ttlSeconds }) { const old = aggregate.get(key) ?? 0; aggregate.set(key, old + 1); assert.ok(ttlSeconds > 0); return Promise.resolve(old + 1); },
    get(key) { return aggregate.get(key); }, snapshot(keys) { return Promise.resolve(keys.map((key) => aggregate.get(key) ?? 0)); },
    set() { directAggregateSeed += 1; throw new Error('aggregate evidence must come from rewrite observers'); },
  };
  const logger = { info(value) { if (value?.schema === 'patina.web.v1') observerEvents.push({ at: clock.ms, event: value }); }, warn() {}, error() {}, debug() {} };
  const runner = async ({ request, emit, signal, timeout, observe }) => runWebRewriteStream({ request, emit, signal, timeout, observe, now: () => clock.ms, callLLMStream: async ({ onDelta }) => { clock.ms += request.text === 'Patina monitor health check.' ? 0 : latencyIndex < 0 ? 10_000 : [10_000, 40_000, 90_000, 130_000, 130_000, 130_000, 130_000, 130_000, 130_000, 130_000][latencyIndex]; const value = request.text === 'Patina monitor health check.' ? request.text : request.text.includes('mismatch') ? 'Order 8 units.' : 'Order 7 units.'; onDelta(value); return { text: value }; }, scoreFns: { scoreMPS: async () => ({ mps: 95 }), scoreFidelity: async () => ({ fidelity: 95 }), scoreDeterministicSignals: () => ({}) } });
  const originalFetch = globalThis.fetch; const RealDate = Date;
  globalThis.fetch = /** @type {any} */ (async () => ({ ok: true, status: 200, json: async () => ({ valid: true, license_key: { status: 'active' }, meta: { store_id: '42', variant_id: '99' } }) }));
  try {
    const rewrite = createRewriteApiHandler({ env, now: () => clock.ms, logger, observabilityKv, runWebRewriteStreamImpl: runner });
    let output = response(); await rewrite(rewriteRequest('Bearer LS-RAW-PRO-CANARY', 'Order 7 units mismatch.'), output); await flush(); assert.match(output.body, /number_safety_failed/);
    output = response(); await rewrite(rewriteRequest(), output); await flush(); assert.equal(output.statusCode, 401);
    for (let i = 0; i < 10; i += 1) { latencyIndex = i; clock.ms = BASE; output = response(); await rewrite(rewriteRequest('Bearer LS-RAW-PRO-CANARY'), output); await flush(); assert.equal(output.statusCode, 200); }
    assert.equal(directAggregateSeed, 0); assert.ok([...aggregate.keys()].every((key) => key.startsWith(`${MONITOR_KEY_PREFIX}:production:pro:`)));
    assert.ok(observerEvents.some(({ event }) => event.outcome === 'number_safety_failed'));

    const fetchImpl = async (url, options = {}) => {
      const target = String(url);
      if (target === env.PATINA_OBSERVABILITY_REST_API_URL) {
        const command = JSON.parse(String(options.body)); commands.push(command); const [verb, script, keyCount, ...rest] = command;
        if (verb === 'MGET') return textResponse([script, keyCount, ...rest].map((key) => aggregate.get(key) ?? null));
        if (verb === 'GET') return textResponse(controls.get(script) ?? null);
        if (verb === 'SET') { const [key, value, mode, , nx] = [script, keyCount, ...rest]; if (key.startsWith(`${MONITOR_KEY_PREFIX}:`)) { directAggregateSeed += 1; throw new Error('direct aggregate seed'); } if (mode === 'PX' && nx === 'NX' && controls.has(key)) return textResponse(null); controls.set(key, value); return textResponse('OK'); }
        assert.equal(verb, 'EVAL'); const keys = rest.slice(0, Number(keyCount)); const args = rest.slice(Number(keyCount));
        if (script.includes('cjson.decode')) { const [lease, active, pending] = keys; assert.equal(controls.get(lease), args[0]); if (controls.has(pending) && controls.get(pending) !== args[1]) return textResponse(0); controls.set(pending, args[1]); const ids = JSON.parse(controls.get(active) ?? '[]'); if (!ids.includes(args[2])) ids.push(args[2]); controls.set(active, JSON.stringify(ids)); return textResponse(1); }
        if (script.includes('local n=tonumber')) { const [active, lease, ...records] = keys; const n = Number(args[2]); assert.equal(controls.get(lease), args[0]); assert.equal(controls.get(active), args[1]); for (let i = 0; i < n; i += 1) { assert.equal(controls.get(records[i]), args[i + 3]); controls.delete(records[i]); } for (let i = n; i < records.length; i += 1) { const value = args[3 + n + (i - n)]; if (controls.has(records[i]) && controls.get(records[i]) !== value) return textResponse(0); controls.set(records[i], value); } assert.doesNotMatch(script, /'PX'/); controls.delete(active); controls.delete(lease); return textResponse(1); }
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
    const monitor = createProMonitorApiHandler({ env, fetchImpl: fetchFake(fetchImpl) });
    const cron = async (authorization = 'Bearer cron-secret') => { globalThis.Date = /** @type {DateConstructor} */ (/** @type {unknown} */ (class extends RealDate { constructor(value) { super(value === undefined ? clock.ms : value); } static now() { return clock.ms; } })); try { const res = response(); await monitor({ method: 'GET', headers: { authorization } }, res); return res; } finally { globalThis.Date = RealDate; } };
    assert.equal((await cron('Bearer wrong')).statusCode, 401);
    clock.ms = BASE + 130_000; const firstCron = await cron(); assert.equal(firstCron.statusCode, 200, firstCron.body); assert.equal(discord.length, 0);
    assert.equal((await cron()).statusCode, 200); assert.equal(discord.length, 3); assert.ok([...controls.keys()].some((key) => key.includes(':pending:'))); assert.equal([...controls.keys()].filter((key) => key.includes(':obs:')).length, 0);
    clock.ms = BASE + 46 * 60_000; latencyIndex = 0; output = response(); await rewrite(rewriteRequest('Bearer LS-RAW-PRO-CANARY'), output); await flush();
    assert.equal((await cron()).statusCode, 200); const obs = [...controls.entries()].filter(([key]) => key.includes(':obs:')).map(([, value]) => JSON.parse(value)); assert.equal(obs.length, 3); assert.equal([...controls.keys()].filter((key) => key.includes(':pending:')).length, 0);
    assert.ok(commands.filter(([verb]) => verb === 'EVAL').some(([, script]) => String(script).includes('cjson.decode'))); assert.ok(commands.filter(([verb]) => verb === 'EVAL').some(([, script]) => String(script).includes('local n=tonumber')));
    const receiptKeys = ['schemaVersion', 'receiptId', 'issuedAt', 'issuer', 'deploymentId', 'channel', 'tier', 'realPath', 'namespace', 'eventSchema', 'eventSchemaVersion', 'eventSchemaHash', 'configHash', 'ruleVersion', 'trigger', 'window', 'countBand', 'denominators', 'latency', 'cronAuthorized', 'syntheticTerminal', 'syntheticStreak', 'discord', 'dedupControlKey', 'pendingAlertKey', 'recoveryId', 'artifactHash'];
    for (const receipt of obs) { assert.deepEqual(Object.keys(receipt).sort(), [...receiptKeys].sort()); assert.equal(receipt.schemaVersion, 'OBS-ALERT-v1'); assert.equal(receipt.issuer, 'patina.pro-monitor'); assert.equal(receipt.channel, 'production'); assert.equal(receipt.tier, 'pro'); assert.equal(receipt.eventSchema, 'patina.web.v1'); assert.equal(receipt.ruleVersion, 'pro-monitor.histogram.v1'); assert.match(receipt.issuedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/); assert.equal(new Date(receipt.issuedAt).toISOString(), receipt.issuedAt); assert.match(receipt.artifactHash, /^[a-f0-9]{64}$/); assert.equal(receipt.artifactHash, artifactHash(receipt)); assert.deepEqual(Object.keys(receipt.denominators).sort(), ['entitlementNonOk', 'entitlementTotal', 'histogram', 'monitorDrop', 'numberSafety', 'productionAggregate']); assert.deepEqual(Object.keys(receipt.latency.counts).sort(), ['30-60s', '60-120s', '<=30s', '>120s']); assert.deepEqual(Object.keys(receipt.latency).sort(), ['counts', 'n', 'over120Ratio', 'p95Rank', 'ruleVersion']); assert.deepEqual(Object.keys(receipt.discord).sort(), ['attempts', 'status']); assert.notEqual(receipt.pendingAlertKey, receipt.receiptId); assert.ok(['number_safety', 'p95_latency', 'latency_tail'].includes(receipt.trigger)); assert.equal(receipt.window, receipt.trigger === 'number_safety' ? '15m' : '30m'); assert.doesNotMatch(JSON.stringify(receipt), /secret|token|pro-key|hmac|original/i); }
    assert.equal(obs.find((receipt) => receipt.trigger === 'p95_latency')?.countBand, '10-19'); assert.ok([...controls.keys()].some((key) => key.includes(':recovery:')));
    assert.equal(directAggregateSeed, 0);
  } finally { globalThis.fetch = originalFetch; globalThis.Date = RealDate; }
});
