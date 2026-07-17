// Tests for the external aggregate-only log-query service
// (services/log-query): drain parsing, closed counting, window math, strict
// fail-closed boundaries, and the two HTTP handlers, including compatibility
// with the monitor's parseAggregate contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  LOGQ_OUTCOMES,
  LOGQ_TTL_SECONDS,
  answerQuery,
  extractWebEvents,
  logqKey,
  parseDrainDelivery,
  strictCounterValue,
  utc15mBucket,
  windowBuckets,
} from '../../services/log-query/lib/log-aggregate.js';
import { createIngestHandler } from '../../services/log-query/api/ingest.js';
import { createQueryHandler } from '../../services/log-query/api/query.js';
import { OBSERVED_OUTCOMES, overlappingQuarterBuckets, utc15mBucket as monitorBucket } from '../../src/pro-monitor.js';

const NOW = Date.UTC(2026, 6, 17, 12, 7, 0);

/** Mirror of api/pro-monitor.js#parseAggregate (kept verbatim so shape drift fails here). */
function parseAggregate(payload, window) {
  const value = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
  const keys = window === '15m' ? ['numberSafety', 'entitlementNonOk', 'entitlementTotal'] : ['monitorDrop'];
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some((key) => !Number.isSafeInteger(value[key]) || value[key] < 0)) throw new Error('log_shape');
  return value;
}

function inspectEvent({ channel = 'production', tier = 'pro', outcome = 'completed', evidenceClass = 'aggregate_only' } = {}) {
  return [
    '{',
    "  schemaVersion: 'v1',",
    "  schema: 'patina.web.v1',",
    `  channel: '${channel}',`,
    `  evidenceClass: '${evidenceClass}',`,
    `  tier: '${tier}',`,
    `  outcome: '${outcome}',`,
    "  latencyBucket: '<=30s',",
    "  statusClass: '2xx',",
    "  sampling: 'full'",
    '}',
  ].join('\n');
}

function jsonEvent(overrides = {}) {
  return JSON.stringify({
    schemaVersion: 'v1', schema: 'patina.web.v1', channel: 'production', evidenceClass: 'aggregate_only',
    tier: 'pro', outcome: 'completed', latencyBucket: '<=30s', statusClass: '2xx', sampling: 'full', ...overrides,
  });
}

function memoryKv() {
  const store = new Map();
  return {
    store,
    incrAllCalls: 0,
    getManyCalls: 0,
    async incrAll(increments, ttlSeconds) {
      assert.equal(ttlSeconds, LOGQ_TTL_SECONDS);
      this.incrAllCalls += 1;
      for (const { key, count } of increments) store.set(key, (store.get(key) ?? 0) + count);
      return increments.length;
    },
    async getMany(keys) {
      this.getManyCalls += 1;
      return keys.map((key) => store.get(key) ?? null);
    },
  };
}

function fakeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(chunk) { this.body = chunk ?? ''; this.ended = true; },
  };
}

function fakeReq({ method = 'POST', url = '/api/ingest', headers = {}, body = Buffer.alloc(0) } = {}) {
  const req = Readable.from([body]);
  req.method = method;
  req.url = url;
  req.headers = headers;
  return req;
}

function sign(secret, body) { return createHmac('sha1', secret).update(body).digest('hex'); }

test('closed outcome list stays in parity with the monitor OBSERVED_OUTCOMES', () => {
  assert.deepEqual([...LOGQ_OUTCOMES], OBSERVED_OUTCOMES.filter((outcome) => outcome !== 'unknown'));
});

test('extractWebEvents reads console-inspect and JSON renderings with closed dimensions only', () => {
  assert.deepEqual(extractWebEvents(inspectEvent()), [{ channel: 'production', tier: 'pro', outcome: 'completed' }]);
  assert.deepEqual(extractWebEvents(jsonEvent({ outcome: 'number_safety_failed' })), [
    { channel: 'production', tier: 'pro', outcome: 'number_safety_failed' },
  ]);
  const doubled = `${inspectEvent({ outcome: 'entitlement_denied' })}\n${inspectEvent({ outcome: 'completed' })}`;
  assert.equal(extractWebEvents(doubled).length, 2);
});

test('extractWebEvents drops non-aggregate, unknown-dimension, oversized, and unrelated messages', () => {
  assert.deepEqual(extractWebEvents(inspectEvent({ evidenceClass: 'raw' })), []);
  assert.deepEqual(extractWebEvents(inspectEvent({ channel: 'unknown' })), []);
  assert.deepEqual(extractWebEvents(inspectEvent({ tier: 'unknown' })), []);
  assert.deepEqual(extractWebEvents(inspectEvent({ outcome: 'unknown' })), []);
  assert.deepEqual(extractWebEvents(inspectEvent({ outcome: 'exfiltrate' })), []);
  assert.deepEqual(extractWebEvents('plain provider error text'), []);
  assert.deepEqual(extractWebEvents(null), []);
  assert.deepEqual(extractWebEvents(`x${'a'.repeat(70000)}patina.web.v1`), []);
});

test('extractWebEvents rejects forged fragments: missing fields, reordering, glued identifiers', () => {
  // Missing schemaVersion — an event-like fragment without the full envelope.
  const noVersion = jsonEvent();
  assert.deepEqual(extractWebEvents(noVersion.replace('"schemaVersion":"v1",', '')), []);
  // Missing sampling terminator field.
  assert.deepEqual(extractWebEvents(noVersion.replace(',"sampling":"full"', '')), []);
  // Reordered fields break the canonical envelope.
  assert.deepEqual(extractWebEvents(
    '{"schema":"patina.web.v1","schemaVersion":"v1","channel":"production","evidenceClass":"aggregate_only","tier":"pro","outcome":"completed","latencyBucket":"<=30s","statusClass":"2xx","sampling":"full"}',
  ), []);
  // Field name glued onto another identifier must not match (boundary guard).
  assert.deepEqual(extractWebEvents(noVersion.replace('"schemaVersion"', '"XschemaVersion"')), []);
  // A field smuggled as a VALUE inside another log line must not count: the
  // envelope requires the exact quoted field sequence.
  assert.deepEqual(extractWebEvents('user text mentioning patina.web.v1 and outcome: completed'), []);
});

test('parseDrainDelivery handles JSON arrays and NDJSON, merges counts, drops expired entries', () => {
  const body = JSON.stringify([
    { message: inspectEvent({ outcome: 'completed' }), timestamp: NOW - 1000 },
    { message: inspectEvent({ outcome: 'completed' }), timestamp: NOW - 2000 },
    { message: jsonEvent({ outcome: 'monitor_drop' }), timestamp: NOW - 1000 },
    { message: inspectEvent(), timestamp: NOW - (LOGQ_TTL_SECONDS + 60) * 1000 }, // beyond retention: dropped
    { message: inspectEvent(), timestamp: NOW + 16 * 60 * 1000 }, // beyond future horizon: dropped
    { message: 'noise without events', timestamp: NOW },
  ]);
  const parsed = parseDrainDelivery(body, { now: NOW });
  assert.equal(parsed.ok, true);
  const byKey = Object.fromEntries(parsed.increments.map(({ key, count }) => [key, count]));
  const bucket = utc15mBucket(NOW - 1000);
  assert.equal(byKey[logqKey({ channel: 'production', tier: 'pro', bucket, outcome: 'completed' })], 2);
  assert.equal(byKey[logqKey({ channel: 'production', tier: 'pro', bucket, outcome: 'monitor_drop' })], 1);
  assert.equal(parsed.increments.length, 2);

  const ndjson = [
    JSON.stringify({ message: jsonEvent({ outcome: 'entitlement_denied' }), timestamp: NOW }),
    JSON.stringify({ message: jsonEvent({ outcome: 'entitlement_denied' }), timestamp: NOW }),
  ].join('\n');
  const fromNdjson = parseDrainDelivery(ndjson, { now: NOW });
  assert.equal(fromNdjson.ok, true);
  assert.equal(fromNdjson.increments.length, 1);
  assert.equal(fromNdjson.increments[0].count, 2);
});

test('parseDrainDelivery rejects malformed bodies, lines, entries, and event timestamps', () => {
  assert.deepEqual(parseDrainDelivery('', { now: NOW }), { ok: false, reason: 'empty_body' });
  assert.deepEqual(parseDrainDelivery('[{broken', { now: NOW }), { ok: false, reason: 'malformed_json' });
  assert.deepEqual(parseDrainDelivery('{"an":"object"}\nmalformed{{{', { now: NOW }), { ok: false, reason: 'malformed_ndjson_line' });
  assert.deepEqual(parseDrainDelivery('["not an object"]', { now: NOW }), { ok: false, reason: 'malformed_entry' });
  // An event-bearing entry without a valid timestamp rejects the delivery
  // rather than being silently re-dated to the current quarter.
  for (const timestamp of [undefined, null, 'yesterday', -5, 1.5]) {
    const body = JSON.stringify([{ message: jsonEvent(), timestamp }]);
    assert.deepEqual(parseDrainDelivery(body, { now: NOW }), { ok: false, reason: 'invalid_event_timestamp' });
  }
  // Entries WITHOUT events do not need timestamps.
  const harmless = JSON.stringify([{ message: 'no events here' }]);
  assert.deepEqual(parseDrainDelivery(harmless, { now: NOW }), { ok: true, increments: [] });
});

test('windowBuckets mirrors the monitor overlapping-quarter rule', () => {
  for (const at of [NOW, Date.UTC(2026, 6, 17, 12, 0, 0), Date.UTC(2026, 6, 17, 12, 14, 59)]) {
    assert.deepEqual(windowBuckets('30m', at), overlappingQuarterBuckets(new Date(at)));
  }
  assert.deepEqual(windowBuckets('15m', Date.UTC(2026, 6, 17, 12, 0, 0)), ['20260717T1145Z', '20260717T1200Z']);
  assert.deepEqual(windowBuckets('15m', Date.UTC(2026, 6, 17, 12, 14, 59)), ['20260717T1145Z', '20260717T1200Z']);
  assert.deepEqual(windowBuckets('15m', Date.UTC(2026, 6, 17, 12, 15, 0)), ['20260717T1200Z', '20260717T1215Z']);
  assert.equal(utc15mBucket(NOW), monitorBucket(new Date(NOW)));
});

test('strictCounterValue accepts only absence or canonical non-negative safe integers', () => {
  assert.equal(strictCounterValue(null), 0);
  assert.equal(strictCounterValue(undefined), 0);
  assert.equal(strictCounterValue(0), 0);
  assert.equal(strictCounterValue('0'), 0);
  assert.equal(strictCounterValue('42'), 42);
  assert.equal(strictCounterValue(7), 7);
  for (const bad of ['bad', '-1', '1.5', '01', ' 3', '3 ', -1, 1.5, NaN, Infinity, {}, [], true, '9007199254740993']) {
    assert.throws(() => strictCounterValue(bad), /malformed_counter/, `value: ${String(bad)}`);
  }
});

test('answerQuery returns exactly the closed shapes parseAggregate accepts, including zeroes', async () => {
  const kv = memoryKv();
  const bucket = utc15mBucket(NOW);
  await kv.incrAll([
    { key: logqKey({ channel: 'production', tier: 'pro', bucket, outcome: 'number_safety_failed' }), count: 1 },
    { key: logqKey({ channel: 'production', tier: 'pro', bucket, outcome: 'entitlement_denied' }), count: 2 },
    { key: logqKey({ channel: 'production', tier: 'pro', bucket, outcome: 'entitlement_unavailable' }), count: 1 },
    { key: logqKey({ channel: 'production', tier: 'pro', bucket, outcome: 'completed' }), count: 5 },
    { key: logqKey({ channel: 'production', tier: 'pro', bucket, outcome: 'monitor_drop' }), count: 4 },
  ], LOGQ_TTL_SECONDS);

  const safety = await answerQuery({ channel: 'production', tier: 'pro', window: '15m', readCounters: (keys) => kv.getMany(keys), now: NOW });
  assert.deepEqual(safety, { numberSafety: 1, entitlementNonOk: 3, entitlementTotal: 9 });
  assert.deepEqual(parseAggregate(safety, '15m'), safety);

  const drops = await answerQuery({ channel: 'production', tier: 'pro', window: '30m', readCounters: (keys) => kv.getMany(keys), now: NOW });
  assert.deepEqual(drops, { monitorDrop: 4 });
  assert.deepEqual(parseAggregate(drops, '30m'), drops);

  const empty = await answerQuery({ channel: 'staging', tier: 'pro', window: '15m', readCounters: (keys) => kv.getMany(keys), now: NOW });
  assert.deepEqual(parseAggregate(empty, '15m'), { numberSafety: 0, entitlementNonOk: 0, entitlementTotal: 0 });
});

test('answerQuery reads the whole window in ONE snapshot call and accepts string counters', async () => {
  const calls = [];
  const readCounters = async (keys) => { calls.push(keys); return keys.map(() => '2'); };
  const result = await answerQuery({ channel: 'production', tier: 'pro', window: '15m', readCounters, now: NOW });
  assert.equal(calls.length, 1, 'one snapshot round trip');
  assert.ok(calls[0].length > 0 && calls[0].every((key) => key.startsWith('patina:logq:v1:production:pro:')));
  assert.deepEqual(parseAggregate(result, '15m'), result);
});

test('answerQuery throws on malformed persisted counters and snapshot shape drift', async () => {
  for (const poison of ['bad', '-1', '1.5', true]) {
    await assert.rejects(
      () => answerQuery({ channel: 'production', tier: 'pro', window: '30m', readCounters: async (keys) => keys.map((_, i) => (i === 0 ? poison : null)), now: NOW }),
      /malformed_counter/,
    );
  }
  await assert.rejects(
    () => answerQuery({ channel: 'production', tier: 'pro', window: '15m', readCounters: async () => ['1'], now: NOW }),
    /snapshot_shape/,
  );
  await assert.rejects(
    () => answerQuery({ channel: 'production', tier: 'pro', window: '15m', readCounters: async (keys) => keys.map(() => String(Number.MAX_SAFE_INTEGER)), now: NOW }),
    /counter_overflow|malformed_counter/,
  );
});

test('answerQuery rejects out-of-scope dimensions and non-function readers', async () => {
  const reader = async (keys) => keys.map(() => null);
  await assert.rejects(() => answerQuery({ channel: 'prod', tier: 'pro', window: '15m', readCounters: reader }), TypeError);
  await assert.rejects(() => answerQuery({ channel: 'production', tier: 'free', window: '15m', readCounters: reader }), TypeError);
  await assert.rejects(() => answerQuery({ channel: 'production', tier: 'pro', window: '1h', readCounters: reader }), TypeError);
  await assert.rejects(() => answerQuery({ channel: 'production', tier: 'pro', window: '15m', readCounters: null }), TypeError);
});

test('ingest verification responds only with the configured team code and never echoes', async () => {
  // Without a configured code there is NO pre-authentication response path.
  const noCode = createIngestHandler({ env: {}, kv: null });
  const denied = fakeRes();
  await noCode(fakeReq({ method: 'GET', headers: { 'x-vercel-verify': 'attacker-token' } }), denied);
  assert.equal(denied.statusCode, 405);
  assert.equal(denied.headers['x-vercel-verify'], undefined);
  // With a configured code, the response carries ONLY the configured value.
  const handler = createIngestHandler({ env: { LOGQ_VERCEL_VERIFY: 'team-code-abc' }, kv: null });
  const challenged = fakeRes();
  await handler(fakeReq({ headers: { 'x-vercel-verify': 'ignored-request-token' } }), challenged);
  assert.equal(challenged.statusCode, 200);
  assert.equal(challenged.headers['x-vercel-verify'], 'team-code-abc');
  assert.equal(challenged.body, 'team-code-abc');
  assert.ok(!challenged.body.includes('ignored-request-token'));
});

test('ingest fails closed without a drain secret or KV, and rejects bad signatures', async () => {
  const kv = memoryKv();
  const noSecret = createIngestHandler({ env: {}, kv });
  const res1 = fakeRes();
  await noSecret(fakeReq(), res1);
  assert.equal(res1.statusCode, 503);

  const handler = createIngestHandler({ env: { LOGQ_DRAIN_SECRET: 's3cret' }, kv, now: () => NOW });
  const body = Buffer.from(JSON.stringify([{ message: jsonEvent(), timestamp: NOW }]));
  const wrong = fakeRes();
  await handler(fakeReq({ headers: { 'x-vercel-signature': sign('other-secret', body) }, body }), wrong);
  assert.equal(wrong.statusCode, 403);
  assert.equal(kv.store.size, 0);

  const missing = fakeRes();
  await handler(fakeReq({ body }), missing);
  assert.equal(missing.statusCode, 403);

  const nonPost = fakeRes();
  await handler(fakeReq({ method: 'GET' }), nonPost);
  assert.equal(nonPost.statusCode, 405);
});

test('ingest rejects oversized bodies with 413 before any signature or store work', async () => {
  const kv = memoryKv();
  const handler = createIngestHandler({ env: { LOGQ_DRAIN_SECRET: 's3cret' }, kv, now: () => NOW });
  const huge = Buffer.alloc(1024 * 1024 + 1, 0x5b);
  const res = fakeRes();
  await handler(fakeReq({ headers: { 'x-vercel-signature': sign('s3cret', huge) }, body: huge }), res);
  assert.equal(res.statusCode, 413);
  assert.equal(kv.store.size, 0);
});

test('ingest stores closed counters atomically for a signed delivery and never echoes content', async () => {
  const kv = memoryKv();
  const handler = createIngestHandler({ env: { LOGQ_DRAIN_SECRET: 's3cret' }, kv, now: () => NOW });
  const body = Buffer.from(JSON.stringify([
    { message: inspectEvent({ outcome: 'number_safety_failed' }), timestamp: NOW },
    { message: jsonEvent({ outcome: 'completed' }), timestamp: NOW },
    { message: 'Authorization: Bearer sk-super-secret raw log line', timestamp: NOW },
  ]));
  const res = fakeRes();
  await handler(fakeReq({ headers: { 'x-vercel-signature': sign('s3cret', body) }, body }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true, counters: 2 });
  assert.ok(!res.body.includes('sk-super-secret'));
  assert.equal(kv.incrAllCalls, 1, 'one atomic commit');
  const bucket = utc15mBucket(NOW);
  assert.equal(kv.store.get(logqKey({ channel: 'production', tier: 'pro', bucket, outcome: 'number_safety_failed' })), 1);
  assert.equal(kv.store.get(logqKey({ channel: 'production', tier: 'pro', bucket, outcome: 'completed' })), 1);
  assert.equal(kv.store.size, 2);
});

test('ingest returns non-2xx for malformed deliveries and store failures (no silent loss)', async () => {
  const kv = memoryKv();
  const handler = createIngestHandler({ env: { LOGQ_DRAIN_SECRET: 's3cret' }, kv, now: () => NOW, logger: { warn() {} } });
  // Malformed delivery → 400, closed reason, nothing stored.
  const malformed = Buffer.from('[{broken');
  const badRes = fakeRes();
  await handler(fakeReq({ headers: { 'x-vercel-signature': sign('s3cret', malformed) }, body: malformed }), badRes);
  assert.equal(badRes.statusCode, 400);
  assert.deepEqual(JSON.parse(badRes.body), { error: 'malformed_delivery', reason: 'malformed_json' });
  assert.equal(kv.store.size, 0);
  // Store failure → 503 so the drain redelivers.
  const failing = { async incrAll() { throw new Error('kv down'); }, async getMany() { return []; } };
  const failHandler = createIngestHandler({ env: { LOGQ_DRAIN_SECRET: 's3cret' }, kv: failing, now: () => NOW, logger: { warn() {} } });
  const body = Buffer.from(JSON.stringify([{ message: jsonEvent(), timestamp: NOW }]));
  const failRes = fakeRes();
  await failHandler(fakeReq({ headers: { 'x-vercel-signature': sign('s3cret', body) }, body }), failRes);
  assert.equal(failRes.statusCode, 503);
  assert.deepEqual(JSON.parse(failRes.body), { error: 'store_failed' });
});

test('query enforces bearer auth, closed scope, and answers the monitor contract end to end', async () => {
  const kv = memoryKv();
  const bucket = utc15mBucket(NOW);
  await kv.incrAll([{ key: logqKey({ channel: 'production', tier: 'pro', bucket, outcome: 'monitor_drop' }), count: 3 }], LOGQ_TTL_SECONDS);
  const handler = createQueryHandler({ env: { LOGQ_QUERY_TOKEN: 'query-token' }, kv, now: () => NOW });

  const unauthorized = fakeRes();
  await handler(fakeReq({ method: 'GET', url: '/api/query?channel=production&tier=pro&window=30m&aggregate_only=true', headers: { authorization: 'Bearer wrong' } }), unauthorized);
  assert.equal(unauthorized.statusCode, 401);

  const badScope = fakeRes();
  await handler(fakeReq({ method: 'GET', url: '/api/query?channel=production&tier=free&window=30m&aggregate_only=true', headers: { authorization: 'Bearer query-token' } }), badScope);
  assert.equal(badScope.statusCode, 400);

  const missingFlag = fakeRes();
  await handler(fakeReq({ method: 'GET', url: '/api/query?channel=production&tier=pro&window=30m', headers: { authorization: 'Bearer query-token' } }), missingFlag);
  assert.equal(missingFlag.statusCode, 400);

  const ok = fakeRes();
  await handler(fakeReq({ method: 'GET', url: '/api/query?channel=production&tier=pro&window=30m&aggregate_only=true', headers: { authorization: 'Bearer query-token' } }), ok);
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(parseAggregate(JSON.parse(ok.body), '30m'), { monitorDrop: 3 });
  assert.equal(ok.headers['cache-control'], 'no-store, max-age=0');

  const unconfigured = fakeRes();
  await createQueryHandler({ env: {}, kv: null })(fakeReq({ method: 'GET', url: '/api/query', headers: {} }), unconfigured);
  assert.equal(unconfigured.statusCode, 503);
});

test('query returns 503 for store failure AND malformed persisted values, never fabricated zeroes', async () => {
  const down = { async getMany() { throw new Error('kv down'); }, async incrAll() { throw new Error('kv down'); } };
  const downHandler = createQueryHandler({ env: { LOGQ_QUERY_TOKEN: 'query-token' }, kv: down, now: () => NOW });
  const downRes = fakeRes();
  await downHandler(fakeReq({ method: 'GET', url: '/api/query?channel=production&tier=pro&window=15m&aggregate_only=true', headers: { authorization: 'Bearer query-token' } }), downRes);
  assert.equal(downRes.statusCode, 503);

  const poisoned = { async getMany(keys) { return keys.map((_, i) => (i === 0 ? 'not-a-number' : null)); }, async incrAll() { return 0; } };
  const poisonedHandler = createQueryHandler({ env: { LOGQ_QUERY_TOKEN: 'query-token' }, kv: poisoned, now: () => NOW });
  const poisonedRes = fakeRes();
  await poisonedHandler(fakeReq({ method: 'GET', url: '/api/query?channel=production&tier=pro&window=15m&aggregate_only=true', headers: { authorization: 'Bearer query-token' } }), poisonedRes);
  assert.equal(poisonedRes.statusCode, 503);
  assert.deepEqual(JSON.parse(poisonedRes.body), { error: 'aggregate_unavailable' });
});
