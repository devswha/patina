import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  AGGREGATE_TTL_SECONDS,
  WEB_OBSERVABILITY_FIELDS,
  WEB_OBSERVABILITY_SCHEMA,
  buildAggregateKey,
  buildWebObservabilityEvent,
  createWebObserver,
  sanitizeWebObservabilityEvent,
  utcQuarterStart,
} from '../../src/web-observability.js';

test('canonical web observability schema is deeply frozen', () => {
  assert.equal(WEB_OBSERVABILITY_SCHEMA.schemaVersion, 'v1');
  assert.equal(WEB_OBSERVABILITY_SCHEMA.schema, 'patina.web.v1');
  assert.equal(WEB_OBSERVABILITY_FIELDS, WEB_OBSERVABILITY_SCHEMA.fields);
  assert.ok(Object.isFrozen(WEB_OBSERVABILITY_SCHEMA));
  assert.ok(Object.isFrozen(WEB_OBSERVABILITY_SCHEMA.fields));
  assert.ok(Object.isFrozen(WEB_OBSERVABILITY_SCHEMA.values));
  for (const values of Object.values(WEB_OBSERVABILITY_SCHEMA.values)) assert.ok(Object.isFrozen(values));
  assert.throws(() => { WEB_OBSERVABILITY_SCHEMA.values.channel[0] = 'development'; }, TypeError);
  assert.throws(() => { WEB_OBSERVABILITY_SCHEMA.values.outcome.push('other'); }, TypeError);
});

test('builder output keys and closed values match the canonical schema', () => {
  const common = { channel: 'production', tier: 'pro', outcome: 'completed', latencyMs: 1, status: 200 };
  const events = [
    ...WEB_OBSERVABILITY_SCHEMA.values.channel.map((channel) => buildWebObservabilityEvent({ ...common, channel })),
    ...WEB_OBSERVABILITY_SCHEMA.values.tier.map((tier) => buildWebObservabilityEvent({ ...common, tier })),
    ...WEB_OBSERVABILITY_SCHEMA.values.outcome.map((outcome) => buildWebObservabilityEvent({ ...common, outcome })),
    ...[0, 30_001, 60_001, 120_001, -1].map((latencyMs) => buildWebObservabilityEvent({ ...common, latencyMs })),
    ...[100, 200, 300, 400, 500, 0].map((status) => buildWebObservabilityEvent({ ...common, status })),
    buildWebObservabilityEvent({ ...common, sampling: 'sampled_1_of_20' }),
  ];

  const observed = Object.fromEntries(Object.keys(WEB_OBSERVABILITY_SCHEMA.values).map((field) => [field, new Set()]));
  for (const event of events) {
    assert.deepEqual(Object.keys(event), WEB_OBSERVABILITY_SCHEMA.fields);
    assert.equal(event.schemaVersion, WEB_OBSERVABILITY_SCHEMA.schemaVersion);
    assert.equal(event.schema, WEB_OBSERVABILITY_SCHEMA.schema);
    for (const [field, values] of Object.entries(WEB_OBSERVABILITY_SCHEMA.values)) {
      assert.ok(values.includes(event[field]), `${field}: ${event[field]}`);
      observed[field].add(event[field]);
    }
  }
  for (const [field, values] of Object.entries(WEB_OBSERVABILITY_SCHEMA.values)) {
    assert.deepEqual(observed[field], new Set(values), field);
  }
});
test('patina.web.v1 is closed and rejects raw dimensions', () => {
  const event = buildWebObservabilityEvent(/** @type {any} */ ({
    channel: 'production', tier: 'pro', outcome: 'completed', status: 201, latencyMs: 30_001,
    text: 'customer document', prompt: 'secret prompt', output: 'rewritten document',
    apiKey: 'sk-secret', Authorization: 'Bearer secret', ip: '203.0.113.42',
    requestId: 'req_123', utm_source: 'campaign', license: 'raw-license', licenseHmac: 'hmac-license', error: 'raw-error-canary',
  }));
  assert.deepEqual(Object.keys(event).sort(), [...WEB_OBSERVABILITY_FIELDS].sort());
  assert.deepEqual(event, {
    schemaVersion: 'v1', schema: 'patina.web.v1', channel: 'production', evidenceClass: 'aggregate_only',
    tier: 'pro', outcome: 'completed', latencyBucket: '30-60s', statusClass: '2xx', sampling: 'full',
  });
  const json = JSON.stringify(sanitizeWebObservabilityEvent(/** @type {any} */ ({ ...event, prompt: 'secret' })));
  assert.doesNotMatch(json, /customer|secret|203\.0\.113\.42|req_123|campaign|raw-license|hmac-license|raw-error-canary/);
});

test('aggregate key uses compact UTC quarter starts, mandatory channel and tier, and exact TTL', () => {
  const base = buildWebObservabilityEvent({
    channel: 'production', tier: 'pro', outcome: 'completed', latencyMs: 30_000, status: 200,
  });
  assert.equal(
    buildAggregateKey(base, '2026-07-15T12:14:59.999Z'),
    'patina:mon:v1:production:pro:20260715T1200Z:completed:<=30s',
  );
  assert.equal(utcQuarterStart('2026-07-15T12:15:59.999Z'), '20260715T1215Z');
  assert.equal(buildAggregateKey({ ...base, channel: 'development' }, new Date()), null);
  assert.equal(buildAggregateKey({ ...base, channel: 'unknown' }, new Date()), null);
  assert.equal(buildAggregateKey({ ...base, tier: 'enterprise' }, new Date()), null);
  assert.equal(AGGREGATE_TTL_SECONDS, 7200);
});
test('aggregate key rejects sanitized unknown tiers instead of persisting them', () => {
  const event = buildWebObservabilityEvent({
    channel: 'production', tier: 'invalid-tier', outcome: 'completed', latencyMs: 1, status: 200,
  });
  assert.equal(event.tier, 'unknown');
  assert.equal(buildAggregateKey(event, '2026-07-15T12:00:00.000Z'), null);
});

test('observer isolates staging, production, and tier aggregate keys from event input contamination', async () => {
  const calls = [];
  const kv = { increment: (key, options) => { calls.push([key, options]); } };
  const options = {
    kv, now: () => '2026-07-15T12:15:00.000Z', sample: () => true,
    setTimer: () => 0, clearTimer: () => {},
  };
  createWebObserver({ ...options, channel: 'staging' }).observe({
    channel: 'production', tier: 'free', outcome: 'completed', latencyMs: 1, status: 200,
  });
  createWebObserver({ ...options, channel: 'production' }).observe({
    channel: 'staging', tier: 'pro', outcome: 'completed', latencyMs: 1, status: 200,
  });
  await Promise.resolve();
  assert.deepEqual(calls.map(([key]) => key), [
    'patina:mon:v1:staging:free:20260715T1215Z:completed:<=30s',
    'patina:mon:v1:production:pro:20260715T1215Z:completed:<=30s',
  ]);
  assert.deepEqual(calls.map(([, options]) => options), [
    { ttlSeconds: 7200 },
    { ttlSeconds: 7200 },
  ]);
});

test('observer samples free and BYOK completions but retains pro and denials at 100 percent', async () => {
  const logs = [];
  const calls = [];
  let count = 0;
  const observer = createWebObserver({
    channel: 'production',
    logger: (event) => logs.push(event),
    kv: { increment: (key, options) => { calls.push({ key, options }); } },
    sample: () => ++count % 20 === 0,
    now: () => '2026-07-15T12:00:00.000Z',
    setTimer: () => 0,
    clearTimer: () => {},
  });
  for (const tier of ['free', 'byok']) {
    for (let i = 0; i < 20; i += 1) observer.observe({ tier, outcome: 'completed', latencyMs: 1, status: 200 });
  }
  observer.observe({ tier: 'pro', outcome: 'completed', latencyMs: 1, status: 200 });
  observer.observe({ tier: 'free', outcome: 'quota_denied', latencyMs: 1, status: 429 });
  await Promise.resolve();

  assert.deepEqual(logs.map((event) => [event.tier, event.outcome, event.sampling]), [
    ['free', 'completed', 'sampled_1_of_20'],
    ['byok', 'completed', 'sampled_1_of_20'],
    ['pro', 'completed', 'full'],
    ['free', 'quota_denied', 'full'],
  ]);
  assert.deepEqual(calls, [
    { key: 'patina:mon:v1:production:free:20260715T1200Z:completed:<=30s', options: { ttlSeconds: 7200 } },
    { key: 'patina:mon:v1:production:byok:20260715T1200Z:completed:<=30s', options: { ttlSeconds: 7200 } },
    { key: 'patina:mon:v1:production:pro:20260715T1200Z:completed:<=30s', options: { ttlSeconds: 7200 } },
    { key: 'patina:mon:v1:production:free:20260715T1200Z:quota_denied:<=30s', options: { ttlSeconds: 7200 } },
  ]);
});

test('observer drops failed or timed-out aggregate writes once without recursive KV', () => {
  const logs = [];
  const timers = [];
  let increments = 0;
  const observer = createWebObserver({
    channel: 'production',
    logger: (event) => logs.push(event),
    kv: { increment: () => { increments += 1; return new Promise(() => {}); } },
    setTimer: (fn) => { timers.push(fn); return timers.length; },
    clearTimer: () => {},
    sample: () => true,
  });
  observer.observe({ tier: 'pro', outcome: 'completed', latencyMs: 1, status: 200 });
  timers[0]();
  timers[0]();
  assert.equal(increments, 1);
  assert.equal(logs.filter((event) => event.outcome === 'monitor_drop').length, 1);
  assert.equal(logs.length, 2);
});

test('observer logs one monitor drop when a valid channel lacks a KV adapter', () => {
  const logs = [];
  const observer = createWebObserver({
    channel: 'production',
    logger: (event) => logs.push(event),
    sample: () => true,
  });

  assert.doesNotThrow(() => observer.observe({ tier: 'pro', outcome: 'completed', latencyMs: 1, status: 200 }));
  assert.deepEqual(logs.map((event) => event.outcome), ['completed', 'monitor_drop']);
  assert.equal(logs.filter((event) => event.outcome === 'monitor_drop').length, 1);
});
test('logger and KV failures are isolated from each other', () => {
  let increments = 0;
  const observer = createWebObserver({
    channel: 'production',
    logger: () => { throw new Error('logger unavailable'); },
    kv: { increment: () => { increments += 1; throw new Error('KV unavailable'); } },
    setTimer: () => 0,
    clearTimer: () => {},
    sample: () => true,
  });
  assert.doesNotThrow(() => observer.observe({ tier: 'pro', outcome: 'terminal_failed', latencyMs: 1, status: 500 }));
  assert.equal(increments, 1);
});
