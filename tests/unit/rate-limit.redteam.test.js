import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMemoryKv,
  createRateLimiter,
  extractClientIp,
  quotaKeyHmac,
} from '../../src/rate-limit.js';
import { createRewriteHandler } from '../../src/rewrite-handler.js';
import { QUOTA_REASONS, TIER_LIMITS, WEB_TIERS } from '../../src/web-rewrite-contract.js';
import { createRestKv } from '../../api/rewrite.js';

function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    ended: '',
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(body) {
      this.ended = String(body ?? '');
    },
    json() {
      return JSON.parse(this.ended);
    },
  };
}

function freeBody(overrides = {}) {
  return {
    mode: 'first',
    lang: 'en',
    tier: WEB_TIERS.FREE,
    text: 'Rewrite this sentence safely.',
    ...overrides,
  };
}

function byokBody(overrides = {}) {
  return freeBody({
    tier: WEB_TIERS.BYOK,
    provider: 'openai',
    model: 'gpt-4.1-mini',
    apiKey: 'sk-user-owned-key',
    ...overrides,
  });
}

function assertNoStore(res) {
  assert.equal(res.headers['cache-control'], 'no-store');
}

async function callHandler(handler, req) {
  const res = makeRes();
  await handler(req, res);
  return res;
}

test('category 1 fail-open hunt: production degraded quota paths all deny with 503 and never allow', async () => {
  const envs = [{ NODE_ENV: 'production' }, { VERCEL: '1' }, { VERCEL_ENV: 'production' }];
  const degradedFactories = [
    (env) => ({ name: 'no kv', limiter: createRateLimiter({ kv: null, hmacSecret: 'secret', env }) }),
    (env) => ({ name: 'memory kv', limiter: createRateLimiter({ kv: createMemoryKv(), hmacSecret: 'secret', env }) }),
    (env) => ({ name: 'missing hmacSecret', limiter: createRateLimiter({ kv: { async incr() { return 1; } }, env }) }),
    (env) => ({
      name: 'kv incr returns malformed counter (undefined)',
      limiter: createRateLimiter({
        kv: { async incr() { return undefined; } },
        hmacSecret: 'secret',
        env,
      }),
    }),
    (env) => ({
      name: 'kv incr returns malformed counter (NaN)',
      limiter: createRateLimiter({
        kv: { async incr() { return NaN; } },
        hmacSecret: 'secret',
        env,
      }),
    }),
    (env) => ({
      name: 'kv incr throws',
      limiter: createRateLimiter({
        kv: { async incr() { throw new Error('incr unavailable'); } },
        hmacSecret: 'secret',
        env,
      }),
    }),
  ];

  for (const env of envs) {
    for (const make of degradedFactories) {
      const { name, limiter } = make(env);
      const result = await limiter.check({ tier: WEB_TIERS.FREE, ip: '203.0.113.10' });
      assert.equal(result.allowed, false, `${name} under ${JSON.stringify(env)} must not fail open`);
      assert.equal(result.status, 503, `${name} under ${JSON.stringify(env)} must fail closed with 503`);
    }
  }
});

test('category 2 IP spoof: untrusted forwarding headers produce no quota identity or independent spoof buckets', async () => {
  assert.equal(extractClientIp({ 'x-forwarded-for': '198.51.100.1', forwarded: 'for=198.51.100.1', 'x-client-ip': '198.51.100.1' }), null);

  const observed = [];
  const handler = createRewriteHandler({
    rateLimiter: {
      async check({ tier, ip }) {
        observed.push({ tier, ip });
        return ip == null
          ? { allowed: false, status: 400, reason: 'client ip unavailable' }
          : { allowed: true, tier };
      },
    },
    runRewrite() {
      throw new Error('runRewrite must not be called for spoof-only headers');
    },
  });

  for (const spoof of ['198.51.100.1', '198.51.100.2']) {
    const res = await callHandler(handler, {
      method: 'POST',
      headers: { 'x-forwarded-for': spoof, forwarded: `for=${spoof}`, 'x-client-ip': spoof },
      body: freeBody(),
    });
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.json(), { error: 'client ip unavailable' });
    assertNoStore(res);
  }

  assert.deepEqual(observed.map((entry) => entry.ip), [null, null]);
});

test('category 3 quota exhaustion + reset: daily/hourly caps reset by bucket and HMAC keys hide raw IP', async () => {
  let clock = 0;
  const limiter = createRateLimiter({ kv: createMemoryKv(), hmacSecret: 'secret', now: () => clock });
  const ip = '203.0.113.30';

  assert.equal(quotaKeyHmac('secret', 'free', 'day', ip, 0).includes(ip), false);
  assert.match(quotaKeyHmac('secret', 'free', 'hour', ip, 0), /^[a-f0-9]{64}$/);

  for (let i = 0; i < 5; i += 1) {
    const result = await limiter.check({ tier: WEB_TIERS.FREE, ip: `${ip}-${i}` });
    assert.equal(result.allowed, true, `daily request ${i + 1} should be allowed`);
  }
  assert.deepEqual(await limiter.check({ tier: WEB_TIERS.FREE, ip: `${ip}-daily` }), {
    allowed: true,
    tier: WEB_TIERS.FREE,
    remainingDay: 4,
  });

  const dailyLimiter = createRateLimiter({
    kv: createMemoryKv(),
    hmacSecret: 'secret',
    now: () => clock,
    limits: { free: { maxChars: 4000, maxConcurrent: 1, reqPerDay: 5, burstPerHour: 99 }, byok: { maxChars: 20000, maxConcurrent: 2 } },
  });
  for (let i = 0; i < 5; i += 1) assert.equal((await dailyLimiter.check({ tier: WEB_TIERS.FREE, ip })).allowed, true);
  assert.deepEqual(await dailyLimiter.check({ tier: WEB_TIERS.FREE, ip }), { allowed: false, status: 429, reason: 'daily quota exceeded' });
  clock = 86_400_001;
  assert.equal((await dailyLimiter.check({ tier: WEB_TIERS.FREE, ip })).allowed, true);

  clock = 0;
  const burstLimiter = createRateLimiter({ kv: createMemoryKv(), hmacSecret: 'secret', now: () => clock });
  assert.equal((await burstLimiter.check({ tier: WEB_TIERS.FREE, ip: '203.0.113.31' })).allowed, true);
  assert.equal((await burstLimiter.check({ tier: WEB_TIERS.FREE, ip: '203.0.113.31' })).allowed, true);
  assert.deepEqual(await burstLimiter.check({ tier: WEB_TIERS.FREE, ip: '203.0.113.31' }), { allowed: false, status: 429, reason: 'hourly burst exceeded' });
  clock = 3_600_001;
  assert.equal((await burstLimiter.check({ tier: WEB_TIERS.FREE, ip: '203.0.113.31' })).allowed, true);
});

test('category 4 BYOK bypasses shared quota degradation but handler still enforces BYOK contract validation', async () => {
  const limiter = createRateLimiter({ kv: null, hmacSecret: undefined, env: { NODE_ENV: 'production' } });
  assert.deepEqual(await limiter.check({ tier: WEB_TIERS.BYOK, ip: null }), { allowed: true, tier: WEB_TIERS.BYOK });

  let checks = 0;
  let runs = 0;
  const handler = createRewriteHandler({
    rateLimiter: { async check(input) { checks += 1; return limiter.check(input); } },
    runRewrite() { runs += 1; },
    env: { NODE_ENV: 'production' },
  });
  const res = await callHandler(handler, {
    method: 'POST',
    headers: {},
    body: byokBody({ apiKey: undefined }),
  });
  assert.equal(res.statusCode, 400);
  assert.match(res.json().error, /requires an apiKey/);
  assert.equal(checks, 0, 'invalid BYOK contract must be rejected before quota bypass');
  assert.equal(runs, 0);
  assertNoStore(res);
});

test('category 5 handler abuse: rejects abusive inputs, avoids runner on denial, and redacts runner secrets', async () => {
  const statuses = [];

  {
    let calls = 0;
    const res = await callHandler(createRewriteHandler({ rateLimiter: { async check() { return { allowed: true, tier: WEB_TIERS.FREE }; } }, runRewrite() { calls += 1; } }), {
      method: 'GET', headers: {}, body: freeBody(),
    });
    assert.equal(res.statusCode, 405);
    assert.equal(calls, 0);
    statuses.push(res);
  }

  {
    let calls = 0;
    const res = await callHandler(createRewriteHandler({ rateLimiter: { async check() { return { allowed: true, tier: WEB_TIERS.FREE }; } }, runRewrite() { calls += 1; }, maxBodyBytes: 10 }), {
      method: 'POST', headers: {}, body: JSON.stringify(freeBody()),
    });
    assert.equal(res.statusCode, 413);
    assert.equal(calls, 0);
    statuses.push(res);
  }

  {
    const res = await callHandler(createRewriteHandler({ rateLimiter: { async check() { return { allowed: true, tier: WEB_TIERS.FREE }; } }, runRewrite() {} }), {
      method: 'POST', headers: {}, body: '{bad json',
    });
    assert.equal(res.statusCode, 400);
    statuses.push(res);
  }

  {
    let calls = 0;
    const res = await callHandler(createRewriteHandler({ rateLimiter: { async check() { return { allowed: true, tier: WEB_TIERS.FREE }; } }, runRewrite() { calls += 1; } }), {
      method: 'POST', headers: {}, body: freeBody({ text: 'x'.repeat(4001) }),
    });
    assert.equal(res.statusCode, 413);
    assert.equal(calls, 0);
    statuses.push(res);
  }

  {
    let calls = 0;
    const res = await callHandler(createRewriteHandler({ rateLimiter: { async check() { return { allowed: false, status: 429, reason: 'daily quota exceeded' }; } }, runRewrite() { calls += 1; } }), {
      method: 'POST', headers: { 'x-real-ip': '203.0.113.40' }, body: freeBody(),
    });
    assert.equal(res.statusCode, 429);
    assert.equal(calls, 0);
    statuses.push(res);
  }

  {
    const logs = [];
    const res = await callHandler(createRewriteHandler({
      rateLimiter: { async check() { return { allowed: true, tier: WEB_TIERS.FREE }; } },
      async runRewrite() { throw new Error('upstream exploded sk-secret-LEAK123456789'); },
      logger: { error(value) { logs.push(value); } },
    }), {
      method: 'POST', headers: { 'x-real-ip': '203.0.113.41' }, body: freeBody(),
    });
    assert.equal(res.statusCode, 500);
    assert.deepEqual(res.json(), { error: 'internal error' });
    assert.equal(res.ended.includes('sk-secret-LEAK'), false);
    assert.equal(JSON.stringify(logs).includes('sk-secret-LEAK'), false);
    assert.equal(JSON.stringify(logs).includes('upstream exploded'), false);
    assert.deepEqual(logs, [{ code: 'rewrite_handler_failed', stage: 'handler' }]);
    statuses.push(res);
  }

  for (const res of statuses) assertNoStore(res);
});

test('category 6 header tamper: no-store is present on 405, 413, 400, 429, 503, and 500 errors', async () => {
  const allowed = { async check() { return { allowed: true, tier: WEB_TIERS.FREE }; } };
  const cases = [
    { want: 405, handler: createRewriteHandler({ rateLimiter: allowed, runRewrite() {} }), req: { method: 'GET', headers: {}, body: freeBody() } },
    { want: 413, handler: createRewriteHandler({ rateLimiter: allowed, runRewrite() {}, maxBodyBytes: 1 }), req: { method: 'POST', headers: {}, body: JSON.stringify(freeBody()) } },
    { want: 400, handler: createRewriteHandler({ rateLimiter: allowed, runRewrite() {} }), req: { method: 'POST', headers: {}, body: '{' } },
    { want: 429, handler: createRewriteHandler({ rateLimiter: { async check() { return { allowed: false, status: 429, reason: 'daily quota exceeded' }; } }, runRewrite() {} }), req: { method: 'POST', headers: { 'x-real-ip': '203.0.113.50' }, body: freeBody() } },
    { want: 503, handler: createRewriteHandler({ rateLimiter: { async check() { return { allowed: false, status: 503, reason: 'quota storage unavailable' }; } }, runRewrite() {} }), req: { method: 'POST', headers: { 'x-real-ip': '203.0.113.51' }, body: freeBody() } },
    { want: 500, handler: createRewriteHandler({ rateLimiter: allowed, runRewrite() { throw new Error('boom'); }, logger: { error() {} } }), req: { method: 'POST', headers: { 'x-real-ip': '203.0.113.52' }, body: freeBody() } },
  ];

  for (const { want, handler, req } of cases) {
    const res = await callHandler(handler, req);
    assert.equal(res.statusCode, want);
    assertNoStore(res);
  }
});

test('category 7 stream body DoS: async body over maxBodyBytes aborts at 413 before consuming the whole stream', async () => {
  let yielded = 0;
  let calls = 0;
  const req = {
    method: 'POST',
    headers: {},
    async *[Symbol.asyncIterator]() {
      for (const chunk of ['{"text":"', 'x'.repeat(20), 'SHOULD_NOT_BE_READ', '"}']) {
        yielded += 1;
        yield chunk;
      }
    },
  };
  const handler = createRewriteHandler({
    rateLimiter: { async check() { return { allowed: true, tier: WEB_TIERS.FREE }; } },
    runRewrite() { calls += 1; },
    maxBodyBytes: 16,
  });

  const res = await callHandler(handler, req);
  assert.equal(res.statusCode, 413);
  assert.equal(calls, 0);
  assert.ok(yielded < 4, `stream should stop before all chunks are consumed; yielded ${yielded}`);
  assertNoStore(res);
});

// ---------------------------------------------------------------------------
// G003 red-team: pro subject metering (src/rate-limit.js switch(tier)) +
// createRestKv atomicity/coercion (api/rewrite.js). These probe gaps beyond the
// existing unit suite. Product code is frozen; tests assert the OBSERVED
// contract and any deviation from the expected security contract is a FINDING.
// ---------------------------------------------------------------------------

const PRO = WEB_TIERS.PRO;
const FREE = WEB_TIERS.FREE;
const BYOK = WEB_TIERS.BYOK;

/** Wrap createMemoryKv counting incr/decr so a compensating decr is observable. */
function spyMemoryKv() {
  const mem = createMemoryKv();
  const counts = { incr: 0, decr: 0 };
  return {
    counts,
    get: (key) => mem.get(key),
    async incr(key, opts) { counts.incr += 1; return mem.incr(key, opts); },
    async decr(key) { counts.decr += 1; return mem.decr(key); },
  };
}

/** Swap globalThis.fetch for the duration of `run`, always restoring it. */
async function withMockFetch(fetchImpl, run) {
  const original = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (fetchImpl);
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

/** Faithful Upstash/Vercel REST mock: POST SET stores verbatim; GET returns it. */
function restKvMock() {
  const store = new Map();
  const posts = [];
  const reads = [];
  const fetchImpl = async (url, init) => {
    const u = String(url);
    if (init && init.method === 'POST') {
      const args = JSON.parse(String(init.body));
      posts.push({ args, headers: init.headers });
      if (args[0] === 'SET') store.set(args[1], args[2]);
      return { ok: true, async json() { return { result: 'OK' }; } };
    }
    reads.push(u);
    const m = u.match(/\/get\/(.+)$/);
    if (m) {
      const key = decodeURIComponent(m[1]);
      return { ok: true, async json() { return { result: store.has(key) ? store.get(key) : null }; } };
    }
    return { ok: true, async json() { return { result: null }; } };
  };
  return { fetchImpl, posts, reads, store };
}

test('category 8 pro subject injection: falsy AND truthy non-string subjects both fail closed with 401', async () => {
  const need401 = { allowed: false, status: 401, reason: QUOTA_REASONS.LICENSE_REQUIRED };

  // Every non-string (or empty-string) subject must fail closed with 401 on
  // BOTH the metering check and the concurrency-slot acquire. The guard is a
  // strict `typeof subject !== 'string' || subject === ''`, closing the earlier
  // falsy-only defense-in-depth gap where a truthy non-string subject (object/
  // array/non-zero number) slipped past and was String()-coerced, collapsing
  // distinct license objects onto one shared '[object Object]' bucket.
  for (const subject of [undefined, null, '', 0, Number.NaN, { license: 'A' }, ['x'], 42, true]) {
    const limiter = createRateLimiter({ kv: createMemoryKv(), hmacSecret: 'secret', now: () => 0 });
    assert.deepEqual(await limiter.check({ tier: PRO, subject: /** @type {any} */ (subject), ip: '203.0.113.7' }), need401, `check subject=${String(subject)}`);
    assert.deepEqual(await limiter.acquireConcurrency({ tier: PRO, subject: /** @type {any} */ (subject), ip: '203.0.113.7' }), need401, `acquire subject=${String(subject)}`);
  }
});

test('category 9 pro is subject-keyed and never IP-keyed: same subject/diff IP shares a bucket, diff subject/same IP does not', async () => {
  const limits = {
    free: { maxChars: 4000, maxConcurrent: 1, reqPerDay: 5, burstPerHour: 2 },
    byok: { maxChars: 20000, maxConcurrent: 2 },
    pro: { maxChars: 20000, reqPerDay: 1, maxConcurrent: 3 },
  };
  const limiter = createRateLimiter({ kv: createMemoryKv(), hmacSecret: 'secret', now: () => 0, limits });
  // Same subject, different IPs (and a missing IP) all hit the SAME bucket.
  assert.equal((await limiter.check({ tier: PRO, subject: 'seat-1', ip: '203.0.113.1' })).allowed, true);
  assert.deepEqual(await limiter.check({ tier: PRO, subject: 'seat-1', ip: '198.51.100.9' }), { allowed: false, status: 429, reason: QUOTA_REASONS.DAILY });
  assert.deepEqual(await limiter.check({ tier: PRO, subject: 'seat-1' }), { allowed: false, status: 429, reason: QUOTA_REASONS.DAILY });
  // A DIFFERENT subject on the SAME IP is a fresh bucket (the IP is irrelevant).
  assert.equal((await limiter.check({ tier: PRO, subject: 'seat-2', ip: '203.0.113.1' })).allowed, true);

  // The pro keys are derived from the subject only and never leak the raw
  // subject/IP; adding an IP can never change the day key.
  const dayKey = quotaKeyHmac('secret', 'pro', 'day', 'seat-1', 0);
  assert.match(dayKey, /^[a-f0-9]{64}$/);
  assert.equal(dayKey.includes('seat-1'), false);
  assert.equal(quotaKeyHmac('secret', 'pro', 'concurrent', 'seat-1').includes('203.0.113.1'), false);
});

test('category 10 pro daily boundary: the request AT the cap is allowed with remainingDay 0 and the next crosses to 429 DAILY', async () => {
  assert.equal(TIER_LIMITS.pro.reqPerDay, 200, 'boundary pinned to the frozen default (200)');
  const cap = TIER_LIMITS.pro.reqPerDay;
  const limiter = createRateLimiter({ kv: createMemoryKv(), hmacSecret: 'secret', now: () => 0 });
  const subject = 'seat-boundary';
  let last;
  for (let i = 0; i < cap; i += 1) last = await limiter.check({ tier: PRO, subject });
  assert.deepEqual(last, { allowed: true, tier: PRO, remainingDay: 0 }, 'the 200th (== cap) is allowed with 0 remaining');
  assert.deepEqual(await limiter.check({ tier: PRO, subject }), { allowed: false, status: 429, reason: QUOTA_REASONS.DAILY }, 'the 201st crosses the cap');
});

test('category 11 pro concurrency boundary: N acquire, the (N+1)th is compensated by a decr and denied, and a release re-admits', async () => {
  assert.equal(TIER_LIMITS.pro.maxConcurrent, 3, 'boundary pinned to the frozen default (3)');
  const cap = TIER_LIMITS.pro.maxConcurrent;
  const kv = spyMemoryKv();
  const limiter = createRateLimiter({ kv, hmacSecret: 'secret', now: () => 0 });
  const subject = 'seat-conc';
  for (let i = 0; i < cap; i += 1) {
    assert.deepEqual(await limiter.acquireConcurrency({ tier: PRO, subject }), { allowed: true, tier: PRO }, `slot ${i + 1}`);
  }
  assert.deepEqual(await limiter.acquireConcurrency({ tier: PRO, subject }), { allowed: false, status: 429, reason: QUOTA_REASONS.CONCURRENT });

  // The over-limit acquire incremented THEN COMPENSATED with a decr, so the live
  // counter never leaks past the cap (cap+1 incr, 1 decr => cap). Without the
  // compensating decr the slot would be permanently poisoned and lock everyone out.
  const key = quotaKeyHmac('secret', 'pro', 'concurrent', subject);
  assert.equal(await kv.get(key), cap, 'counter compensated back to the cap, not stuck at cap+1');
  assert.equal(kv.counts.incr, cap + 1);
  assert.equal(kv.counts.decr, 1);

  // Releasing one slot frees capacity and re-admits.
  await limiter.releaseConcurrency({ tier: PRO, subject });
  assert.equal(await kv.get(key), cap - 1);
  assert.deepEqual(await limiter.acquireConcurrency({ tier: PRO, subject }), { allowed: true, tier: PRO });
});

test('category 12 pro degraded KV never fails open: NaN/negative/zero/object/undefined/throwing incr all deny with 503 on check and acquire', async () => {
  const fail503 = { allowed: false, status: 503, reason: QUOTA_REASONS.STORAGE_UNAVAILABLE };
  const badReturns = [Number.NaN, -1, -999, 0, {}, undefined];
  for (const bad of badReturns) {
    const limiter = createRateLimiter({ kv: { async incr() { return /** @type {any} */ (bad); }, async decr() { return 0; } }, hmacSecret: 'secret', now: () => 0 });
    assert.deepEqual(await limiter.check({ tier: PRO, subject: 'seat' }), fail503, `check incr->${String(bad)}`);
    assert.deepEqual(await limiter.acquireConcurrency({ tier: PRO, subject: 'seat' }), fail503, `acquire incr->${String(bad)}`);
  }
  const thrower = createRateLimiter({ kv: { async incr() { throw new Error('kv down'); }, async decr() {} }, hmacSecret: 'secret', now: () => 0 });
  assert.deepEqual(await thrower.check({ tier: PRO, subject: 'seat' }), fail503, 'check incr throws');
  assert.deepEqual(await thrower.acquireConcurrency({ tier: PRO, subject: 'seat' }), fail503, 'acquire incr throws');
});

test('category 13 free tier no-regression: IP-keyed metering ignores subject, fails closed, and never embeds the raw IP in a key', async () => {
  const ip = '203.0.113.60';

  // Fail-closed in production without a durable KV; exact shape/reason unchanged.
  const prod = createRateLimiter({ kv: null, hmacSecret: 'secret', env: { NODE_ENV: 'production' } });
  assert.deepEqual(await prod.check({ tier: FREE, ip }), { allowed: false, status: 503, reason: QUOTA_REASONS.STORAGE_UNAVAILABLE });
  // Missing IP is a stable 400 even if a bogus subject is supplied.
  assert.deepEqual(await createRateLimiter({ kv: createMemoryKv(), hmacSecret: 'secret' }).check({ tier: FREE, ip: null, subject: /** @type {any} */ ('ignored') }), { allowed: false, status: 400, reason: QUOTA_REASONS.IP_UNAVAILABLE });

  // The daily cap (5) is enforced per IP and a supplied subject is IGNORED: the
  // 6th request with a DIFFERENT subject but the SAME IP is still 429 DAILY.
  // burstPerHour is lifted so the daily cap (not the hourly burst) is the gate.
  const limits = { free: { maxChars: 4000, maxConcurrent: 1, reqPerDay: 5, burstPerHour: 99 }, byok: { maxChars: 20000, maxConcurrent: 2 }, pro: { maxChars: 20000, reqPerDay: 200, maxConcurrent: 3 } };
  const limiter = createRateLimiter({ kv: createMemoryKv(), hmacSecret: 'secret', now: () => 0, limits });
  for (let i = 0; i < 5; i += 1) {
    assert.equal((await limiter.check({ tier: FREE, ip, subject: /** @type {any} */ (`seat-${i}`) })).allowed, true, `free request ${i + 1}`);
  }
  assert.deepEqual(await limiter.check({ tier: FREE, ip, subject: /** @type {any} */ ('brand-new-subject') }), { allowed: false, status: 429, reason: QUOTA_REASONS.DAILY });

  // A first free response shape is exactly {allowed, tier, remainingDay}.
  const fresh = createRateLimiter({ kv: createMemoryKv(), hmacSecret: 'secret', now: () => 0 });
  assert.deepEqual(await fresh.check({ tier: FREE, ip, subject: /** @type {any} */ ('ignored') }), { allowed: true, tier: FREE, remainingDay: 4 });

  // Free concurrency (max 1) enforces; a subject can neither widen nor bypass it.
  const conc = createRateLimiter({ kv: createMemoryKv(), hmacSecret: 'secret', now: () => 0 });
  assert.deepEqual(await conc.acquireConcurrency({ tier: FREE, ip, subject: /** @type {any} */ ('x') }), { allowed: true, tier: FREE });
  assert.deepEqual(await conc.acquireConcurrency({ tier: FREE, ip, subject: /** @type {any} */ ('y') }), { allowed: false, status: 429, reason: QUOTA_REASONS.CONCURRENT });
  await conc.releaseConcurrency({ tier: FREE, ip });
  assert.deepEqual(await conc.acquireConcurrency({ tier: FREE, ip }), { allowed: true, tier: FREE });

  // Every free key is a 64-hex HMAC that never leaks the raw IP.
  for (const key of [
    quotaKeyHmac('secret', 'free', 'day', ip, 0),
    quotaKeyHmac('secret', 'free', 'hour', ip, 0),
    quotaKeyHmac('secret', 'free', 'concurrent', ip),
  ]) {
    assert.match(key, /^[a-f0-9]{64}$/);
    assert.equal(key.includes(ip), false);
  }
});

test('category 14 byok tier no-regression: unmetered allow/no-op that never touches the KV, regardless of ip/subject', async () => {
  const boom = {
    async get() { throw new Error('byok must not read kv'); },
    async set() { throw new Error('byok must not write kv'); },
    async incr() { throw new Error('byok must not meter'); },
    async decr() { throw new Error('byok must not release'); },
  };
  const limiter = createRateLimiter({ kv: boom, hmacSecret: 'secret', env: { NODE_ENV: 'production' }, now: () => 0 });

  // Unmetered allow on check even in production with a hostile kv and any identity.
  assert.deepEqual(await limiter.check({ tier: BYOK, ip: null, subject: null }), { allowed: true, tier: BYOK });
  assert.deepEqual(await limiter.check({ tier: BYOK, ip: '203.0.113.9', subject: /** @type {any} */ ('ignored') }), { allowed: true, tier: BYOK });
  // Concurrency acquire is a no-op allow; release is a no-op. Neither hits kv, so
  // `boom` never throwing proves the byok path never touches storage.
  assert.deepEqual(await limiter.acquireConcurrency({ tier: BYOK, ip: '203.0.113.9', subject: /** @type {any} */ ('ignored') }), { allowed: true, tier: BYOK });
  await limiter.releaseConcurrency({ tier: BYOK, ip: '203.0.113.9', subject: /** @type {any} */ ('ignored') });
});

test('category 15 createRestKv set/get: atomic single-command SET(+PX) round-trips objects/arrays/nested/special chars; get coerces; !ok throws', async () => {
  const { fetchImpl, posts } = restKvMock();
  await withMockFetch(fetchImpl, async () => {
    const kv = createRestKv({ KV_REST_API_URL: 'https://kv.example.test/', KV_REST_API_TOKEN: 'token' });
    assert.ok(kv);

    const cases = [
      { key: 'obj', val: { decision: 'allow', tier: 'pro', nested: { a: 1 } } },
      { key: 'arr', val: [1, 'two', { three: 3 }, null, true] },
      { key: 'deep', val: { a: { b: { c: { d: [{ e: 'f' }] } } } } },
      { key: 'special chars', val: { s: 'quote"\ttab\nnewline\\backslash\u0000nul😀emoji', k: '한국어' } },
      { key: 'json-looking-string', val: '{"not":"an object"}' },
      { key: 'num', val: 42 },
      { key: 'bool', val: false },
    ];
    for (const { key, val } of cases) {
      posts.length = 0;
      await kv.set(key, val, { ttlMs: 300_000 });
      // Atomic: exactly ONE POST carrying SET ... PX ms (never SET then EXPIRE),
      // so a crash cannot leave a TTL-less permanent entitlement-cache entry.
      assert.equal(posts.length, 1, `set ${key} is a single atomic command`);
      assert.deepEqual(posts[0].args, ['SET', key, JSON.stringify(val), 'PX', '300000'], `set ${key} args`);
      assert.equal(posts[0].headers?.['Content-Type'], 'application/json');
      assert.equal(posts[0].headers?.Authorization, 'Bearer token');
      // Round-trip: object/array/nested come back deep-equal; a JSON-looking
      // string comes back as the SAME string (never double-parsed into an object).
      assert.deepEqual(await kv.get(key), val, `round-trip ${key}`);
    }

    // No TTL / non-positive TTL => plain SET, PX omitted.
    for (const arg of [undefined, { ttlMs: 0 }, { ttlMs: -5 }]) {
      posts.length = 0;
      await kv.set('k', { a: 1 }, /** @type {any} */ (arg));
      assert.deepEqual(posts[0].args, ['SET', 'k', JSON.stringify({ a: 1 })], `ttl=${JSON.stringify(arg)} omits PX`);
    }
    // A positive fractional TTL is floored to >= 1ms so a sub-ms cache entry
    // never silently becomes permanent; a >1 fractional TTL uses ceil.
    posts.length = 0;
    await kv.set('k', { a: 1 }, { ttlMs: 0.4 });
    assert.deepEqual(posts[0].args, ['SET', 'k', JSON.stringify({ a: 1 }), 'PX', '1'], 'fractional ttl floors to 1ms');
    posts.length = 0;
    await kv.set('k', { a: 1 }, { ttlMs: 1500.2 });
    assert.deepEqual(posts[0].args, ['SET', 'k', JSON.stringify({ a: 1 }), 'PX', '1501'], 'fractional ttl uses ceil');
  });

  // get() coercion on non-object REST results: null -> undefined; non-JSON string
  // -> verbatim; valid numeric string -> number; invalid-JSON numeric string
  // (leading zero) -> verbatim string (JSON.parse fails, value is not dropped).
  await withMockFetch(async (url, init) => {
    if (init && init.method === 'POST') return { ok: true, async json() { return { result: 'OK' }; } };
    const u = String(url);
    if (u.endsWith('/null')) return { ok: true, async json() { return { result: null }; } };
    if (u.endsWith('/legacy')) return { ok: true, async json() { return { result: 'plain-legacy-value' }; } };
    if (u.endsWith('/num')) return { ok: true, async json() { return { result: '7' }; } };
    if (u.endsWith('/leadingzero')) return { ok: true, async json() { return { result: '007' }; } };
    return { ok: true, async json() { return { result: null }; } };
  }, async () => {
    const kv = createRestKv({ KV_REST_API_URL: 'https://kv.example.test', KV_REST_API_TOKEN: 'token' });
    assert.equal(await kv.get('null'), undefined);
    assert.equal(await kv.get('legacy'), 'plain-legacy-value');
    assert.equal(await kv.get('num'), 7);
    assert.equal(await kv.get('leadingzero'), '007');
  });

  // A non-ok REST response is fail-closed: get throws (read) and set throws (command).
  await withMockFetch(async () => ({ ok: false, status: 500, async json() { return {}; } }), async () => {
    const kv = createRestKv({ KV_REST_API_URL: 'https://kv.example.test', KV_REST_API_TOKEN: 'token' });
    await assert.rejects(() => kv.get('k'), /kv request failed/);
    await assert.rejects(() => kv.set('k', { a: 1 }), /kv command failed/);
    await assert.rejects(() => kv.set('k', { a: 1 }, { ttlMs: 1000 }), /kv command failed/);
  });
});

test('category 16 createRestKv incr/decr: numeric REST path is parsed independently of get and fails closed on an invalid counter', async () => {
  // A TTL'd incr is ONE atomic root-POST EVAL(INCRBY+PEXPIRE) — never an /incr
  // followed by a separate /expire the process could die before issuing (#605:
  // a lost expire on the stable concurrency key would pin that identity near
  // its cap until manual cleanup). No-ttl incr keeps the plain GET path. Both
  // parse number|numeric-string|nested {result} via parseKvNumber.
  {
    const calls = [];
    const posts = [];
    await withMockFetch(async (url, init) => {
      if (init && init.method === 'POST') {
        posts.push(JSON.parse(String(init.body)));
        return { ok: true, async json() { return { result: '7' }; } };
      }
      const u = String(url);
      calls.push(u);
      if (u.includes('/incr/')) return { ok: true, async json() { return { result: '7' }; } };
      if (u.includes('/decr/')) return { ok: true, async json() { return { result: { result: 3 } }; } };
      return { ok: true, async json() { return { result: null }; } };
    }, async () => {
      const kv = createRestKv({ KV_REST_API_URL: 'https://kv.example.test', KV_REST_API_TOKEN: 'token' });
      assert.equal(await kv.incr('c', { ttlMs: 60_000 }), 7, 'numeric-string EVAL result parses to a number');
      assert.equal(posts.length, 1, 'ttl incr is a single atomic command');
      assert.deepEqual(calls, [], 'ttl incr never touches the GET path');
      assert.equal(posts[0][0], 'EVAL');
      assert.match(posts[0][1], /INCRBY/);
      assert.match(posts[0][1], /PEXPIRE/);
      assert.deepEqual(posts[0].slice(2), ['1', 'c', '1', '60000'], 'one key; amount 1; ttl in ms');
      posts.length = 0;
      assert.equal(await kv.incr('c'), 7, 'incr without a ttl issues no expire');
      assert.deepEqual(calls, ['https://kv.example.test/incr/c']);
      assert.equal(posts.length, 0, 'no-ttl incr stays on the GET path');
      assert.equal(await kv.decr('c'), 3, 'nested {result} decr result parses to a number');
    });
  }

  // A malformed counter (non-numeric, null, non-integer, object) fails closed by
  // THROWING -- never silently returns a bogus count the limiter would trust
  // (the limiter converts that throw into a 503, verified in category 12).
  // Checked on the GET path (no ttl) AND the atomic EVAL path (ttl).
  for (const bad of [{ result: 'not-a-number' }, { result: null }, { result: 1.5 }, { result: {} }, {}]) {
    await withMockFetch(async () => ({ ok: true, async json() { return bad; } }), async () => {
      const kv = createRestKv({ KV_REST_API_URL: 'https://kv.example.test', KV_REST_API_TOKEN: 'token' });
      await assert.rejects(() => kv.incr('c'), /kv incr returned invalid counter/, `incr rejects ${JSON.stringify(bad)}`);
      await assert.rejects(() => kv.incr('c', { ttlMs: 1_000 }), /kv incr returned invalid counter/, `ttl incr rejects ${JSON.stringify(bad)}`);
      await assert.rejects(() => kv.incrBy('c', 5, { ttlMs: 1_000 }), /kv incr returned invalid counter/, `ttl incrBy rejects ${JSON.stringify(bad)}`);
      await assert.rejects(() => kv.decr('c'), /kv decr returned invalid counter/, `decr rejects ${JSON.stringify(bad)}`);
    });
  }

  // The adapter is null (not a partial object) when REST env is absent, so the
  // rate-limiter treats it as storage-unavailable rather than a broken adapter.
  assert.equal(createRestKv({}), null);
  assert.equal(createRestKv({ KV_REST_API_URL: 'https://kv.example.test' }), null);
  assert.equal(createRestKv({ KV_REST_API_TOKEN: 'token' }), null);
});

test('category 17 unknown/malformed tier is a stable 400 on check and acquire, and a silent no-op on release', async () => {
  const limiter = createRateLimiter({ kv: createMemoryKv(), hmacSecret: 'secret', now: () => 0 });
  const expected = { allowed: false, status: 400, reason: 'unsupported tier' };
  const tiers = ['enterprise', 'admin', 'PRO', 'FREE', 'Byok', ' free', 'free ', 'pro\u0000', null, undefined, 123, {}, []];
  for (const tier of tiers) {
    assert.deepEqual(await limiter.check({ tier: /** @type {any} */ (tier), ip: '203.0.113.99', subject: 'x' }), expected, `check tier=${String(tier)}`);
    assert.deepEqual(await limiter.acquireConcurrency({ tier: /** @type {any} */ (tier), ip: '203.0.113.99', subject: 'x' }), expected, `acquire tier=${String(tier)}`);
    // release must never throw for an unknown tier (no key resolved => no-op).
    await limiter.releaseConcurrency({ tier: /** @type {any} */ (tier), ip: '203.0.113.99', subject: 'x' });
  }
});
