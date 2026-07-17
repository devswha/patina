// Tests for the external aggregate-only log-query service
// (services/log-query): drain parsing, closed counting, window math, and the
// two HTTP handlers, including compatibility with the monitor's parseAggregate
// contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  LOGQ_TTL_SECONDS,
  answerQuery,
  extractWebEvents,
  logqKey,
  parseDrainDelivery,
  utc15mBucket,
  windowBuckets,
} from '../../services/log-query/lib/log-aggregate.js';
import { createIngestHandler } from '../../services/log-query/api/ingest.js';
import { createQueryHandler } from '../../services/log-query/api/query.js';
import { overlappingQuarterBuckets, utc15mBucket as monitorBucket } from '../../src/pro-monitor.js';

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
    async incrBy(key, count, ttlSeconds) {
      assert.equal(ttlSeconds, LOGQ_TTL_SECONDS);
      const next = (store.get(key) ?? 0) + count;
      store.set(key, next);
      return next;
    },
    async get(key) { return store.get(key) ?? 0; },
  };
}

function fakeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(chunk) { this.body = chunk ?? ''; this.ended = true; },
  };
  return res;
}

function fakeReq({ method = 'POST', url = '/api/ingest', headers = {}, body = Buffer.alloc(0) } = {}) {
  const req = Readable.from([body]);
  req.method = method;
  req.url = url;
  req.headers = headers;
  return req;
}

function sign(secret, body) { return createHmac('sha1', secret).update(body).digest('hex'); }

test('extractWebEvents reads console-inspect and JSON renderings with closed dimensions only', () => {
  assert.deepEqual(extractWebEvents(inspectEvent()), [{ channel: 'production', tier: 'pro', outcome: 'completed' }]);
  assert.deepEqual(extractWebEvents(jsonEvent({ outcome: 'number_safety_failed' })), [
    { channel: 'production', tier: 'pro', outcome: 'number_safety_failed' },
  ]);
  // Two events inside one message are both counted.
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

test('parseDrainDelivery handles JSON arrays and NDJSON, merges counts, drops stale entries', () => {
  const body = JSON.stringify([
    { message: inspectEvent({ outcome: 'completed' }), timestamp: NOW - 1000 },
    { message: inspectEvent({ outcome: 'completed' }), timestamp: NOW - 2000 },
    { message: jsonEvent({ outcome: 'monitor_drop' }), timestamp: NOW - 1000 },
    { message: inspectEvent(), timestamp: NOW - (LOGQ_TTL_SECONDS + 60) * 1000 }, // beyond retention
    { message: 'noise without events', timestamp: NOW },
    'not an object',
  ]);
  const increments = parseDrainDelivery(body, { now: NOW });
  const byKey = Object.fromEntries(increments.map(({ key, count }) => [key, count]));
  const bucket = utc15mBucket(NOW - 1000);
  assert.equal(byKey[logqKey({ channel: 'production', tier: 'pro', bucket, outcome: 'completed' })], 2);
  assert.equal(byKey[logqKey({ channel: 'production', tier: 'pro', bucket, outcome: 'monitor_drop' })], 1);
  assert.equal(increments.length, 2);

  const ndjson = [
    JSON.stringify({ message: jsonEvent({ outcome: 'entitlement_denied' }), timestamp: NOW }),
    'malformed{{{',
    JSON.stringify({ message: jsonEvent({ outcome: 'entitlement_denied' }), timestamp: NOW }),
  ].join('\n');
  const fromNdjson = parseDrainDelivery(ndjson, { now: NOW });
  assert.equal(fromNdjson.length, 1);
  assert.equal(fromNdjson[0].count, 2);
});

test('windowBuckets mirrors the monitor overlapping-quarter rule', () => {
  // 30m window must select exactly the buckets the monitor reads.
  for (const at of [NOW, Date.UTC(2026, 6, 17, 12, 0, 0), Date.UTC(2026, 6, 17, 12, 14, 59)]) {
    assert.deepEqual(windowBuckets('30m', at), overlappingQuarterBuckets(new Date(at)));
  }
  // 15m window: current quarter plus any quarter whose END is strictly after
  // now-15m (mirrors the documented strictly-after bucket-end rule).
  assert.deepEqual(windowBuckets('15m', Date.UTC(2026, 6, 17, 12, 0, 0)), ['20260717T1145Z', '20260717T1200Z']);
  assert.deepEqual(windowBuckets('15m', Date.UTC(2026, 6, 17, 12, 14, 59)), ['20260717T1145Z', '20260717T1200Z']);
  assert.deepEqual(windowBuckets('15m', Date.UTC(2026, 6, 17, 12, 15, 0)), ['20260717T1200Z', '20260717T1215Z']);
  // Bucket format parity with the monitor.
  assert.equal(utc15mBucket(NOW), monitorBucket(new Date(NOW)));
});

test('answerQuery returns exactly the closed shapes parseAggregate accepts, including zeroes', async () => {
  const kv = memoryKv();
  const bucket = utc15mBucket(NOW);
  await kv.incrBy(logqKey({ channel: 'production', tier: 'pro', bucket, outcome: 'number_safety_failed' }), 1, LOGQ_TTL_SECONDS);
  await kv.incrBy(logqKey({ channel: 'production', tier: 'pro', bucket, outcome: 'entitlement_denied' }), 2, LOGQ_TTL_SECONDS);
  await kv.incrBy(logqKey({ channel: 'production', tier: 'pro', bucket, outcome: 'entitlement_unavailable' }), 1, LOGQ_TTL_SECONDS);
  await kv.incrBy(logqKey({ channel: 'production', tier: 'pro', bucket, outcome: 'completed' }), 5, LOGQ_TTL_SECONDS);
  await kv.incrBy(logqKey({ channel: 'production', tier: 'pro', bucket, outcome: 'monitor_drop' }), 4, LOGQ_TTL_SECONDS);

  const safety = await answerQuery({ channel: 'production', tier: 'pro', window: '15m', readCounter: (key) => kv.get(key), now: NOW });
  assert.deepEqual(safety, { numberSafety: 1, entitlementNonOk: 3, entitlementTotal: 9 });
  assert.deepEqual(parseAggregate(safety, '15m'), safety);

  const drops = await answerQuery({ channel: 'production', tier: 'pro', window: '30m', readCounter: (key) => kv.get(key), now: NOW });
  assert.deepEqual(drops, { monitorDrop: 4 });
  assert.deepEqual(parseAggregate(drops, '30m'), drops);

  // Empty store still yields explicit zeroes in the exact closed shape.
  const empty = await answerQuery({ channel: 'staging', tier: 'pro', window: '15m', readCounter: (key) => kv.get(key), now: NOW });
  assert.deepEqual(parseAggregate(empty, '15m'), { numberSafety: 0, entitlementNonOk: 0, entitlementTotal: 0 });
});

test('answerQuery rejects out-of-scope dimensions and non-function readers', async () => {
  const reader = async () => 0;
  await assert.rejects(() => answerQuery({ channel: 'prod', tier: 'pro', window: '15m', readCounter: reader }), TypeError);
  await assert.rejects(() => answerQuery({ channel: 'production', tier: 'free', window: '15m', readCounter: reader }), TypeError);
  await assert.rejects(() => answerQuery({ channel: 'production', tier: 'pro', window: '1h', readCounter: reader }), TypeError);
  await assert.rejects(() => answerQuery({ channel: 'production', tier: 'pro', window: '15m', readCounter: null }), TypeError);
});

test('ingest echoes the x-vercel-verify challenge before any secret checks', async () => {
  const handler = createIngestHandler({ env: {}, kv: null });
  const res = fakeRes();
  await handler(fakeReq({ headers: { 'x-vercel-verify': 'verify-token-123' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['x-vercel-verify'], 'verify-token-123');
});

test('ingest advertises the configured team verification code on every response', async () => {
  const handler = createIngestHandler({ env: { LOGQ_VERCEL_VERIFY: 'team-code-abc' }, kv: null });
  const challenged = fakeRes();
  await handler(fakeReq({ headers: { 'x-vercel-verify': 'ignored-request-token' } }), challenged);
  assert.equal(challenged.statusCode, 200);
  assert.equal(challenged.headers['x-vercel-verify'], 'team-code-abc');
  assert.equal(challenged.body, 'team-code-abc');
  const plain = fakeRes();
  await handler(fakeReq({ method: 'GET' }), plain);
  assert.equal(plain.headers['x-vercel-verify'], 'team-code-abc');
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

test('ingest stores closed counters for a signed delivery and never echoes content', async () => {
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
  const bucket = utc15mBucket(NOW);
  assert.equal(kv.store.get(logqKey({ channel: 'production', tier: 'pro', bucket, outcome: 'number_safety_failed' })), 1);
  assert.equal(kv.store.get(logqKey({ channel: 'production', tier: 'pro', bucket, outcome: 'completed' })), 1);
  assert.equal(kv.store.size, 2);
});

test('query enforces bearer auth, closed scope, and answers the monitor contract end to end', async () => {
  const kv = memoryKv();
  const bucket = utc15mBucket(NOW);
  await kv.incrBy(logqKey({ channel: 'production', tier: 'pro', bucket, outcome: 'monitor_drop' }), 3, LOGQ_TTL_SECONDS);
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

test('query returns 503 when the counter store fails instead of fabricating zeroes', async () => {
  const kv = { async get() { throw new Error('kv down'); }, async incrBy() { throw new Error('kv down'); } };
  const handler = createQueryHandler({ env: { LOGQ_QUERY_TOKEN: 'query-token' }, kv, now: () => NOW });
  const res = fakeRes();
  await handler(fakeReq({ method: 'GET', url: '/api/query?channel=production&tier=pro&window=15m&aggregate_only=true', headers: { authorization: 'Bearer query-token' } }), res);
  assert.equal(res.statusCode, 503);
});
