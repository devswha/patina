import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createMemoryKv,
  createRateLimiter,
  extractClientIp,
  quotaKeyHmac,
} from '../../src/rate-limit.js';
import { createRewriteHandler } from '../../src/rewrite-handler.js';
import { WEB_TIERS } from '../../src/web-rewrite-contract.js';

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
    assert.match(JSON.stringify(logs), /\[REDACTED\]/);
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
