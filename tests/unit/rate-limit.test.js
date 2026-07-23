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
  // The platform-controlled x-vercel-* header outranks x-real-ip: only the
  // former is guaranteed proxy-set under every deploy topology (#607).
  assert.equal(
    extractClientIp({ 'x-real-ip': '198.51.100.1', 'x-vercel-forwarded-for': '203.0.113.1' }),
    '203.0.113.1',
  );
  assert.equal(extractClientIp({ 'x-real-ip': '198.51.100.1' }), '198.51.100.1');
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

  const first = await limiter.acquireConcurrency({ tier: WEB_TIERS.FREE, ip: '203.0.113.30' });
  assert.equal(first.allowed, true);
  assert.equal(typeof first.lease, 'string');
  assert.deepEqual(await limiter.acquireConcurrency({ tier: WEB_TIERS.FREE, ip: '203.0.113.30' }), {
    allowed: false,
    status: 429,
    reason: 'concurrent limit exceeded',
  });
  await limiter.releaseConcurrency({ tier: WEB_TIERS.FREE, ip: '203.0.113.30', lease: first.lease });
  assert.equal((await limiter.acquireConcurrency({ tier: WEB_TIERS.FREE, ip: '203.0.113.30' })).allowed, true);
});
test('concurrency leases garbage-collect expired registry members under steady traffic and reject wrong, duplicate, and ABA releases', async () => {
  let clock = 1_000;
  const kv = createMemoryKv({ now: () => clock });
  const limiter = createRateLimiter({
    kv,
    hmacSecret: 'secret',
    concurrencyTtlMs: 10,
    leaseId: (() => {
      let n = 0;
      return () => `lease-${++n}`;
    })(),
    limits: { free: { maxChars: 4000, maxConcurrent: 1, reqPerDay: 99, burstPerHour: 99 }, byok: { maxChars: 20000, maxConcurrent: 2 } },
  });
  const input = { tier: WEB_TIERS.FREE, ip: '203.0.113.31' };
  const first = await limiter.acquireConcurrency(input);
  assert.equal(first.lease, 'lease-1');
  await limiter.releaseConcurrency({ ...input, lease: 'wrong' });
  assert.equal((await limiter.acquireConcurrency(input)).status, 429);
  clock += 11;
  const replacement = await limiter.acquireConcurrency(input);
  assert.equal(replacement.lease, 'lease-3');
  await limiter.releaseConcurrency({ ...input, lease: first.lease });
  assert.equal((await limiter.acquireConcurrency(input)).status, 429);
  await limiter.releaseConcurrency({ ...input, lease: replacement.lease });
  await limiter.releaseConcurrency({ ...input, lease: replacement.lease });
  assert.equal((await limiter.acquireConcurrency(input)).allowed, true);

  // Each later acquisition keeps the registry key alive, but only live members
  // count: expired members cannot accumulate into phantom occupancy.
  for (let i = 0; i < 4; i += 1) {
    clock += 11;
    assert.equal((await limiter.acquireConcurrency(input)).allowed, true);
  }
  const twoSlotLimiter = createRateLimiter({
    kv: createMemoryKv({ now: () => clock }),
    hmacSecret: 'secret',
    concurrencyTtlMs: 10,
    leaseId: (() => {
      let n = 0;
      return () => `two-slot-${++n}`;
    })(),
    limits: { free: { maxChars: 4000, maxConcurrent: 2, reqPerDay: 99, burstPerHour: 99 }, byok: { maxChars: 20000, maxConcurrent: 2 } },
  });
  const twoSlotInput = { tier: WEB_TIERS.FREE, ip: '203.0.113.32' };
  clock = 2_000;
  assert.equal((await twoSlotLimiter.acquireConcurrency(twoSlotInput)).allowed, true);
  clock += 5;
  assert.equal((await twoSlotLimiter.acquireConcurrency(twoSlotInput)).allowed, true);
  clock += 6;
  assert.equal((await twoSlotLimiter.acquireConcurrency(twoSlotInput)).allowed, true, 'the first expired member is garbage-collected while the registry remains alive');
  assert.equal((await twoSlotLimiter.acquireConcurrency(twoSlotInput)).status, 429, 'the cap counts the two remaining live leases');
});

test('concurrency slot TTL defaults to 5m and honors an override so an extended stream never expires the slot', async () => {
  const defaultCalls = [];
  const defaultKv = {
    async acquireLease(_registryKey, _lease, _maxConcurrent, opts) { defaultCalls.push(opts); return true; },
    async releaseLease() { return true; },
  };
  const defaultLimiter = createRateLimiter({ kv: defaultKv, hmacSecret: 'secret', now: () => 0 });
  await defaultLimiter.acquireConcurrency({ tier: WEB_TIERS.FREE, ip: '203.0.113.40' });
  assert.equal(defaultCalls[0].ttlMs, 5 * 60 * 1000);

  const overrideCalls = [];
  const overrideKv = {
    async acquireLease(_registryKey, _lease, _maxConcurrent, opts) { overrideCalls.push(opts); return true; },
    async releaseLease() { return true; },
  };
  const overrideLimiter = createRateLimiter({ kv: overrideKv, hmacSecret: 'secret', now: () => 0, concurrencyTtlMs: 12 * 60 * 1000 });
  await overrideLimiter.acquireConcurrency({ tier: WEB_TIERS.FREE, ip: '203.0.113.40' });
  assert.equal(overrideCalls[0].ttlMs, 12 * 60 * 1000);
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
    LICENSE_REQUIRED: 'license required',
    LICENSE_INVALID: 'license not entitled',
    LICENSE_UNAVAILABLE: 'license validation unavailable',
    MONTHLY_CHARS: 'monthly character limit reached',
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

test('pro tier meters a subject-keyed daily quota (200 pass, 201st is 429 DAILY) and never uses the IP', async () => {
  // Default TIER_LIMITS.pro.reqPerDay is 200. No IP is ever supplied: pro is
  // metered on the license subject, so it works with subject alone.
  const limiter = createRateLimiter({ kv: createMemoryKv(), hmacSecret: 'secret', now: () => 0 });
  const subject = 'lic-subject-abc';
  const first = await limiter.check({ tier: WEB_TIERS.PRO, subject });
  assert.deepEqual(first, { allowed: true, tier: WEB_TIERS.PRO, remainingDay: 199 });
  for (let i = 1; i < 200; i += 1) {
    assert.equal((await limiter.check({ tier: WEB_TIERS.PRO, subject })).allowed, true, `pro daily request ${i + 1} should be allowed`);
  }
  assert.deepEqual(await limiter.check({ tier: WEB_TIERS.PRO, subject }), {
    allowed: false,
    status: 429,
    reason: QUOTA_REASONS.DAILY,
  });
});

test('pro quota is keyed on the subject, not the IP: differing IPs share one subject bucket', async () => {
  const limiter = createRateLimiter({
    kv: createMemoryKv(),
    hmacSecret: 'secret',
    now: () => 0,
    limits: {
      free: { maxChars: 4000, maxConcurrent: 1, reqPerDay: 5, burstPerHour: 2 },
      byok: { maxChars: 20000, maxConcurrent: 2 },
      pro: { maxChars: 20000, reqPerDay: 2, maxConcurrent: 3 },
    },
  });
  const subject = 'lic-subject-shared';
  // Same subject, different IPs: all count against the SAME subject bucket, so
  // the 3rd is denied even though every IP differs (and the last has none).
  assert.equal((await limiter.check({ tier: WEB_TIERS.PRO, subject, ip: '203.0.113.1' })).allowed, true);
  assert.equal((await limiter.check({ tier: WEB_TIERS.PRO, subject, ip: '203.0.113.2' })).allowed, true);
  assert.deepEqual(await limiter.check({ tier: WEB_TIERS.PRO, subject }), {
    allowed: false,
    status: 429,
    reason: QUOTA_REASONS.DAILY,
  });
});

test('pro concurrency is subject-keyed: 3 slots pass, the 4th is 429 CONCURRENT, and a release re-admits', async () => {
  // Default TIER_LIMITS.pro.maxConcurrent is 3.
  const limiter = createRateLimiter({ kv: createMemoryKv(), hmacSecret: 'secret', now: () => 0 });
  const subject = 'lic-subject-conc';
  const leases = [];
  for (let i = 0; i < 3; i += 1) {
    const acquired = await limiter.acquireConcurrency({ tier: WEB_TIERS.PRO, subject });
    assert.equal(acquired.allowed, true);
    leases.push(acquired.lease);
  }
  assert.deepEqual(await limiter.acquireConcurrency({ tier: WEB_TIERS.PRO, subject }), {
    allowed: false,
    status: 429,
    reason: QUOTA_REASONS.CONCURRENT,
  });
  await limiter.releaseConcurrency({ tier: WEB_TIERS.PRO, subject, lease: leases[0] });
  assert.equal((await limiter.acquireConcurrency({ tier: WEB_TIERS.PRO, subject })).allowed, true);
});

test('pro tier fails closed with 401 LICENSE_REQUIRED when no subject is supplied (defense-in-depth)', async () => {
  const limiter = createRateLimiter({ kv: createMemoryKv(), hmacSecret: 'secret', now: () => 0 });
  const expected = { allowed: false, status: 401, reason: QUOTA_REASONS.LICENSE_REQUIRED };
  assert.deepEqual(await limiter.check({ tier: WEB_TIERS.PRO, subject: undefined }), expected);
  assert.deepEqual(await limiter.check({ tier: WEB_TIERS.PRO, subject: '' }), expected);
  assert.deepEqual(await limiter.acquireConcurrency({ tier: WEB_TIERS.PRO, subject: null }), expected);
});

test('pro tier fails closed with 503 in production without durable KV or without an HMAC secret', async () => {
  const subject = 'lic-subject-prod';
  const noKv = createRateLimiter({ kv: null, hmacSecret: 'secret', env: { NODE_ENV: 'production' } });
  assert.deepEqual(await noKv.check({ tier: WEB_TIERS.PRO, subject }), {
    allowed: false,
    status: 503,
    reason: QUOTA_REASONS.STORAGE_UNAVAILABLE,
  });

  const memoryKv = createRateLimiter({ kv: createMemoryKv(), hmacSecret: 'secret', env: { VERCEL: '1' } });
  assert.deepEqual(await memoryKv.check({ tier: WEB_TIERS.PRO, subject }), {
    allowed: false,
    status: 503,
    reason: QUOTA_REASONS.STORAGE_UNAVAILABLE,
  });

  const noSecret = createRateLimiter({ kv: { async incr() { return 1; } }, env: { VERCEL_ENV: 'production' } });
  assert.deepEqual(await noSecret.check({ tier: WEB_TIERS.PRO, subject }), {
    allowed: false,
    status: 503,
    reason: QUOTA_REASONS.SECRET_UNAVAILABLE,
  });
});

test('an unknown tier is a stable 400 on check and concurrency (defense-in-depth)', async () => {
  const limiter = createRateLimiter({ kv: createMemoryKv(), hmacSecret: 'secret', now: () => 0 });
  const expected = { allowed: false, status: 400, reason: 'unsupported tier' };
  assert.deepEqual(await limiter.check({ tier: 'enterprise', ip: '203.0.113.99', subject: 'x' }), expected);
  assert.deepEqual(await limiter.acquireConcurrency({ tier: '', ip: '203.0.113.99' }), expected);
});

test('pro subject guard rejects truthy non-string subjects with 401 (defense-in-depth, fail-closed)', async () => {
  const limiter = createRateLimiter({ kv: createMemoryKv(), hmacSecret: 'secret', now: () => 0 });
  for (const bad of [{}, [], 123, true]) {
    const chk = await limiter.check({ tier: WEB_TIERS.PRO, ip: '203.0.113.50', subject: /** @type {any} */ (bad) });
    assert.equal(chk.allowed, false);
    assert.equal(chk.status, 401);
    assert.equal(chk.reason, QUOTA_REASONS.LICENSE_REQUIRED);
    const acq = await limiter.acquireConcurrency({ tier: WEB_TIERS.PRO, ip: '203.0.113.50', subject: /** @type {any} */ (bad) });
    assert.equal(acq.allowed, false);
    assert.equal(acq.status, 401);
    assert.equal(acq.reason, QUOTA_REASONS.LICENSE_REQUIRED);
  }
});

test('pro monthly char cap: accumulates per-license, allows at the cap, and 429s over it with remaining guidance', async () => {
  const subject = 'seat-month';
  // Small cap to exercise the boundary cheaply; env would normally set 1,000,000.
  const limits = { free: { maxChars: 4000, maxConcurrent: 1, reqPerDay: 5, burstPerHour: 2 }, byok: { maxChars: 20000, maxConcurrent: 2 }, pro: { maxChars: 20000, reqPerDay: 200, maxConcurrent: 3, charsPerMonth: 1000 } };
  const limiter = createRateLimiter({ kv: createMemoryKv(), hmacSecret: 'secret', now: () => 0, limits });

  // 400 + 400 = 800 (<= 1000) both allowed; the daily counter is unaffected.
  assert.equal((await limiter.check({ tier: WEB_TIERS.PRO, subject, chars: 400 })).allowed, true);
  assert.equal((await limiter.check({ tier: WEB_TIERS.PRO, subject, chars: 400 })).allowed, true);
  // 800 + 200 = 1000 == cap: still allowed (cap is the max total, not "one under").
  assert.equal((await limiter.check({ tier: WEB_TIERS.PRO, subject, chars: 200 })).allowed, true);
  // Any further chars cross the cap -> 429 MONTHLY_CHARS with remaining=0 + the limit.
  assert.deepEqual(await limiter.check({ tier: WEB_TIERS.PRO, subject, chars: 1 }), {
    allowed: false,
    status: 429,
    reason: QUOTA_REASONS.MONTHLY_CHARS,
    remainingMonthlyChars: 0,
    limitMonthlyChars: 1000,
  });
});

test('pro monthly char cap resets at the UTC month boundary', async () => {
  const subject = 'seat-reset';
  const limits = { free: { maxChars: 4000, maxConcurrent: 1, reqPerDay: 5, burstPerHour: 2 }, byok: { maxChars: 20000, maxConcurrent: 2 }, pro: { maxChars: 20000, reqPerDay: 999999, maxConcurrent: 3, charsPerMonth: 1000 } };
  // reqPerDay lifted so only the monthly cap can gate.
  let t = Date.UTC(2026, 0, 15); // 2026-01-15
  const limiter = createRateLimiter({ kv: createMemoryKv(), hmacSecret: 'secret', now: () => t, limits });

  assert.equal((await limiter.check({ tier: WEB_TIERS.PRO, subject, chars: 1000 })).allowed, true);
  assert.equal((await limiter.check({ tier: WEB_TIERS.PRO, subject, chars: 1 })).status, 429);

  // Cross into February: a fresh month bucket, so the cap resets and admits again.
  t = Date.UTC(2026, 1, 1);
  assert.equal((await limiter.check({ tier: WEB_TIERS.PRO, subject, chars: 1000 })).allowed, true);
  // A different UTC month bucket keys a separate counter (no cross-month leakage).
  assert.equal((await limiter.check({ tier: WEB_TIERS.PRO, subject, chars: 1 })).status, 429);
});

test('pro monthly char cap counts concurrent requests atomically (no over-allow race)', async () => {
  const subject = 'seat-conc';
  const limits = { free: { maxChars: 4000, maxConcurrent: 1, reqPerDay: 5, burstPerHour: 2 }, byok: { maxChars: 20000, maxConcurrent: 2 }, pro: { maxChars: 20000, reqPerDay: 999999, maxConcurrent: 3, charsPerMonth: 1000 } };
  const limiter = createRateLimiter({ kv: createMemoryKv(), hmacSecret: 'secret', now: () => 0, limits });

  // Fire 10 concurrent 200-char checks against a 1000 cap. The atomic incrBy
  // means EXACTLY 5 succeed (5*200=1000) and the rest are denied — no race lets
  // the running total exceed the cap.
  const results = await Promise.all(
    Array.from({ length: 10 }, () => limiter.check({ tier: WEB_TIERS.PRO, subject, chars: 200 })),
  );
  const allowed = results.filter((r) => r.allowed).length;
  const denied = results.filter((r) => !r.allowed);
  assert.equal(allowed, 5, 'exactly cap/chars requests admitted');
  assert.equal(denied.length, 5);
  for (const d of denied) {
    assert.equal(d.status, 429);
    assert.equal(d.reason, QUOTA_REASONS.MONTHLY_CHARS);
  }
});

test('pro monthly char cap is skipped when no chars are supplied or the cap is unset (backward-compatible)', async () => {
  const subject = 'seat-skip';
  // Default TIER_LIMITS.pro.charsPerMonth applies, but with no chars the monthly
  // dimension never engages: the response shape stays the daily-only contract.
  const limiter = createRateLimiter({ kv: createMemoryKv(), hmacSecret: 'secret', now: () => 0 });
  assert.deepEqual(await limiter.check({ tier: WEB_TIERS.PRO, subject }), { allowed: true, tier: WEB_TIERS.PRO, remainingDay: 199 });

  // With chars but a limits object lacking charsPerMonth, monthly is not enforced.
  const noCap = { free: { maxChars: 4000, maxConcurrent: 1, reqPerDay: 5, burstPerHour: 2 }, byok: { maxChars: 20000, maxConcurrent: 2 }, pro: { maxChars: 20000, reqPerDay: 200, maxConcurrent: 3 } };
  const limiter2 = createRateLimiter({ kv: createMemoryKv(), hmacSecret: 'secret', now: () => 0, limits: noCap });
  assert.deepEqual(await limiter2.check({ tier: WEB_TIERS.PRO, subject, chars: 5_000_000 }), { allowed: true, tier: WEB_TIERS.PRO, remainingDay: 199 });
});
