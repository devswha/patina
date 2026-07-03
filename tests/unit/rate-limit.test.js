import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMemoryKv,
  createRateLimiter,
  extractClientIp,
  quotaKeyHmac,
} from '../../src/rate-limit.js';
import { QUOTA_REASONS, WEB_TIERS } from '../../src/web-rewrite-contract.js';

test('quotaKeyHmac is deterministic, part-sensitive, and never exposes the raw IP', () => {
  const ip = '203.0.113.7';
  const key = quotaKeyHmac('secret', 'free', 'day', ip, 123);
  assert.equal(key, quotaKeyHmac('secret', 'free', 'day', ip, 123));
  assert.notEqual(key, quotaKeyHmac('secret', 'free', 'day', ip, 124));
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.equal(key.includes(ip), false);
});

test('extractClientIp honors trusted-header precedence and comma splitting', () => {
  assert.equal(
    extractClientIp({ 'x-real-ip': '198.51.100.1', 'x-vercel-forwarded-for': '203.0.113.1' }),
    '198.51.100.1',
  );
  assert.equal(extractClientIp({ 'x-vercel-forwarded-for': '203.0.113.2, 10.0.0.1' }), '203.0.113.2');
  assert.equal(extractClientIp({ 'x-forwarded-for': '198.51.100.9' }), null);
  assert.equal(extractClientIp({}), null);
});

test('createMemoryKv supports get, set, incr, decr, and TTL expiry', async () => {
  const originalNow = Date.now;
  let clock = 1_000;
  Date.now = () => clock;
  try {
    const kv = createMemoryKv();
    await kv.set('a', 'value', { ttlMs: 50 });
    assert.equal(await kv.get('a'), 'value');
    assert.equal(await kv.incr('n', { ttlMs: 50 }), 1);
    assert.equal(await kv.incr('n', { ttlMs: 50 }), 2);
    assert.equal(await kv.decr('n'), 1);
    assert.equal(await kv.get('n'), 1);
    clock += 51;
    assert.equal(await kv.get('a'), undefined);
    assert.equal(await kv.get('n'), undefined);
  } finally {
    Date.now = originalNow;
  }
});

test('BYOK tier bypasses shared quota', async () => {
  const limiter = createRateLimiter({ kv: null, hmacSecret: undefined, env: { NODE_ENV: 'production' } });
  assert.deepEqual(await limiter.check({ tier: WEB_TIERS.BYOK, ip: null }), { allowed: true, tier: WEB_TIERS.BYOK });
});

test('non-production memory KV allows free requests up to daily quota then returns 429', async () => {
  const limiter = createRateLimiter({
    kv: createMemoryKv(),
    hmacSecret: 'secret',
    now: () => 0,
    limits: { free: { maxChars: 4000, maxConcurrent: 1, reqPerDay: 2, burstPerHour: 99 }, byok: { maxChars: 20000, maxConcurrent: 2 } },
  });
  assert.equal((await limiter.check({ tier: WEB_TIERS.FREE, ip: '203.0.113.10' })).allowed, true);
  assert.equal((await limiter.check({ tier: WEB_TIERS.FREE, ip: '203.0.113.10' })).allowed, true);
  assert.deepEqual(await limiter.check({ tier: WEB_TIERS.FREE, ip: '203.0.113.10' }), {
    allowed: false,
    status: 429,
    reason: 'daily quota exceeded',
  });
});

test('hourly burst returns 429', async () => {
  const limiter = createRateLimiter({
    kv: createMemoryKv(),
    hmacSecret: 'secret',
    now: () => 0,
    limits: { free: { maxChars: 4000, maxConcurrent: 1, reqPerDay: 99, burstPerHour: 1 }, byok: { maxChars: 20000, maxConcurrent: 2 } },
  });
  assert.equal((await limiter.check({ tier: WEB_TIERS.FREE, ip: '203.0.113.11' })).allowed, true);
  assert.deepEqual(await limiter.check({ tier: WEB_TIERS.FREE, ip: '203.0.113.11' }), {
    allowed: false,
    status: 429,
    reason: 'hourly burst exceeded',
  });
});

test('production posture fails closed without durable KV', async () => {
  const noKv = createRateLimiter({ kv: null, hmacSecret: 'secret', env: { NODE_ENV: 'production' } });
  assert.deepEqual(await noKv.check({ tier: WEB_TIERS.FREE, ip: '203.0.113.12' }), {
    allowed: false,
    status: 503,
    reason: 'quota storage unavailable',
  });

  const memoryKv = createRateLimiter({ kv: createMemoryKv(), hmacSecret: 'secret', env: { VERCEL: '1' } });
  assert.deepEqual(await memoryKv.check({ tier: WEB_TIERS.FREE, ip: '203.0.113.12' }), {
    allowed: false,
    status: 503,
    reason: 'quota storage unavailable',
  });
});

test('production posture fails closed without HMAC secret', async () => {
  const kv = { async incr() { return 1; } };
  const limiter = createRateLimiter({ kv, env: { VERCEL_ENV: 'production' } });
  assert.deepEqual(await limiter.check({ tier: WEB_TIERS.FREE, ip: '203.0.113.13' }), {
    allowed: false,
    status: 503,
    reason: 'quota secret unavailable',
  });
});

test('KV incr errors fail closed with 503', async () => {
  const throwingIncr = createRateLimiter({
    kv: { async incr() { throw new Error('incr down'); } },
    hmacSecret: 'secret',
  });
  assert.deepEqual(await throwingIncr.check({ tier: WEB_TIERS.FREE, ip: '203.0.113.14' }), {
    allowed: false,
    status: 503,
    reason: 'quota storage unavailable',
  });
});

test('malformed KV incr return values fail closed with 503 (no fail-open)', async () => {
  for (const bad of [undefined, null, NaN, Infinity, 0, -1, 2.5, '1', {}, []]) {
    const limiter = createRateLimiter({
      kv: { async incr() { return bad; } },
      hmacSecret: 'secret',
    });
    const result = await limiter.check({ tier: WEB_TIERS.FREE, ip: '203.0.113.14' });
    assert.equal(result.allowed, false, `incr() => ${String(bad)} must not be allowed`);
    assert.equal(result.status, 503);
  }
});

test('missing client IP returns 400', async () => {
  const limiter = createRateLimiter({ kv: createMemoryKv(), hmacSecret: 'secret' });
  assert.deepEqual(await limiter.check({ tier: WEB_TIERS.FREE, ip: null }), {
    allowed: false,
    status: 400,
    reason: 'client ip unavailable',
  });
});

test('free concurrency limit rejects a second active slot and releases after completion', async () => {
  const limiter = createRateLimiter({
    kv: createMemoryKv(),
    hmacSecret: 'secret',
    now: () => 0,
    limits: { free: { maxChars: 4000, maxConcurrent: 1, reqPerDay: 99, burstPerHour: 99 }, byok: { maxChars: 20000, maxConcurrent: 2 } },
  });

  assert.deepEqual(await limiter.acquireConcurrency({ tier: WEB_TIERS.FREE, ip: '203.0.113.30' }), {
    allowed: true,
    tier: WEB_TIERS.FREE,
  });
  assert.deepEqual(await limiter.acquireConcurrency({ tier: WEB_TIERS.FREE, ip: '203.0.113.30' }), {
    allowed: false,
    status: 429,
    reason: 'concurrent limit exceeded',
  });
  await limiter.releaseConcurrency({ tier: WEB_TIERS.FREE, ip: '203.0.113.30' });
  assert.equal((await limiter.acquireConcurrency({ tier: WEB_TIERS.FREE, ip: '203.0.113.30' })).allowed, true);
});

test('BYOK concurrency bypasses shared free slot limit', async () => {
  const limiter = createRateLimiter({
    kv: createMemoryKv(),
    hmacSecret: 'secret',
    limits: { free: { maxChars: 4000, maxConcurrent: 1, reqPerDay: 99, burstPerHour: 99 }, byok: { maxChars: 20000, maxConcurrent: 2 } },
  });

  assert.equal((await limiter.acquireConcurrency({ tier: WEB_TIERS.BYOK, ip: null })).allowed, true);
  assert.equal((await limiter.acquireConcurrency({ tier: WEB_TIERS.BYOK, ip: null })).allowed, true);
});

test('QUOTA_REASONS values stay backward-compatible with the emitted reason strings', () => {
  // The browser classifier and any deployed clients key off these exact
  // strings; this pins the contract so a constant rename cannot silently
  // change the wire format.
  assert.deepEqual(QUOTA_REASONS, {
    DAILY: 'daily quota exceeded',
    HOURLY: 'hourly burst exceeded',
    CONCURRENT: 'concurrent limit exceeded',
    IP_UNAVAILABLE: 'client ip unavailable',
    STORAGE_UNAVAILABLE: 'quota storage unavailable',
    SECRET_UNAVAILABLE: 'quota secret unavailable',
    SERVICE_UNAVAILABLE: 'rewrite service unavailable',
  });
});

test('abuse accounting is pinned: an hourly-denied attempt still consumes daily quota', async () => {
  // Deliberate product/architecture decision (ralplan G003, architect review):
  // the daily counter increments BEFORE the hourly burst check and is not
  // rolled back on an hourly denial. Burst hammering therefore burns daily
  // quota — an abuse deterrent. Changing this order without an atomic limiter
  // would open an unlimited-hammering vector; this test locks the behavior.
  const HOUR_MS = 3_600_000;
  let t = 0;
  const limiter = createRateLimiter({
    kv: createMemoryKv(),
    hmacSecret: 'secret',
    now: () => t,
    limits: { free: { maxChars: 4000, maxConcurrent: 1, reqPerDay: 3, burstPerHour: 1 }, byok: { maxChars: 20000, maxConcurrent: 2 } },
  });
  const ip = '203.0.113.42';

  // Hour 1: one allowed (day=1), one hourly-denied (day=2 — consumed anyway).
  assert.equal((await limiter.check({ tier: WEB_TIERS.FREE, ip })).allowed, true);
  assert.deepEqual(await limiter.check({ tier: WEB_TIERS.FREE, ip }), {
    allowed: false,
    status: 429,
    reason: QUOTA_REASONS.HOURLY,
  });

  // Hour 2: burst window reset; one allowed (day=3).
  t = HOUR_MS;
  assert.equal((await limiter.check({ tier: WEB_TIERS.FREE, ip })).allowed, true);

  // Next attempt hits the DAILY cap (day=4 > 3), not the hourly one — proving
  // the hour-1 denial consumed a daily slot. Under quota-fairness accounting
  // this would still be an hourly denial (day would only be 3 here).
  assert.deepEqual(await limiter.check({ tier: WEB_TIERS.FREE, ip }), {
    allowed: false,
    status: 429,
    reason: QUOTA_REASONS.DAILY,
  });
});
