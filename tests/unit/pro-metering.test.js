import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProMetering, PRO_LIMITS } from '../../src/pro-metering.js';

/** A counter KV (incr only), like the rate limiter uses. */
function counterKv() {
  const map = new Map();
  return { map, async incr(k) { const n = (map.get(k) ?? 0) + 1; map.set(k, n); return n; } };
}

test('PRO_LIMITS pins the agreed caps', () => {
  assert.deepEqual(PRO_LIMITS, { reqPerDay: 100, reqPerHour: 20, reqPerMinute: 6, maxChars: 12000 });
});

test('allows up to the per-minute cap, then 429s the burst', async () => {
  const meter = createProMetering({ kv: counterKv(), now: () => 1_000_000 });
  for (let i = 0; i < PRO_LIMITS.reqPerMinute; i++) {
    const r = await meter.check({ entitlementId: 'eid' });
    assert.equal(r.allowed, true, `request ${i + 1} should be allowed`);
  }
  const over = await meter.check({ entitlementId: 'eid' });
  assert.equal(over.allowed, false);
  assert.equal(over.status, 429);
  assert.match(over.reason, /rate too high/);
});

test('enforces the daily cap independently (injected low limit)', async () => {
  let t = 0;
  const meter = createProMetering({
    kv: counterKv(),
    now: () => t,
    limits: { reqPerDay: 3, reqPerHour: 1000, reqPerMinute: 1000, maxChars: 12000 },
  });
  for (let i = 0; i < 3; i++) {
    assert.equal((await meter.check({ entitlementId: 'eid' })).allowed, true);
    t += 60_000; // advance a minute so we are clearly testing the day cap
  }
  const over = await meter.check({ entitlementId: 'eid' });
  assert.equal(over.allowed, false);
  assert.equal(over.status, 429);
  assert.match(over.reason, /daily cap/);
});

test('different entitlements are metered independently', async () => {
  const meter = createProMetering({ kv: counterKv(), now: () => 1_000_000, limits: { reqPerDay: 1, reqPerHour: 1, reqPerMinute: 1, maxChars: 12000 } });
  assert.equal((await meter.check({ entitlementId: 'a' })).allowed, true);
  assert.equal((await meter.check({ entitlementId: 'b' })).allowed, true); // separate counters
  assert.equal((await meter.check({ entitlementId: 'a' })).allowed, false); // a is now over
});

test('fails closed: no entitlement -> 403, missing/garbage counter -> 503', async () => {
  const meter = createProMetering({ kv: counterKv(), now: () => 1_000_000 });
  assert.equal((await meter.check({ entitlementId: '' })).status, 403);
  assert.equal((await meter.check({})).status, 403);

  const badKv = { async incr() { return undefined; } };
  const badMeter = createProMetering({ kv: /** @type {any} */ (badKv), now: () => 1_000_000 });
  assert.equal((await badMeter.check({ entitlementId: 'eid' })).status, 503);

  const noKv = createProMetering({ kv: /** @type {any} */ ({}), now: () => 1_000_000 });
  assert.equal((await noKv.check({ entitlementId: 'eid' })).status, 503);

  const throwKv = { async incr() { throw new Error('kv down'); } };
  const throwMeter = createProMetering({ kv: /** @type {any} */ (throwKv), now: () => 1_000_000 });
  assert.equal((await throwMeter.check({ entitlementId: 'eid' })).status, 503);
});
