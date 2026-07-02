import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers';

import { createRewriteHandler } from '../../src/rewrite-handler.js';
import { createMemoryKv, createRateLimiter } from '../../src/rate-limit.js';
import { WEB_TIERS } from '../../src/web-rewrite-contract.js';

function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    ended: undefined,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(body) {
      this.ended = body;
    },
    json() {
      return JSON.parse(this.ended);
    },
  };
}

function validBody(overrides = {}) {
  return {
    mode: 'first',
    lang: 'en',
    tier: WEB_TIERS.FREE,
    text: 'Rewrite this sentence.',
    ...overrides,
  };
}

function allowedLimiter() {
  return { async check() { return { allowed: true, tier: WEB_TIERS.FREE }; } };
}

function deferred() {
  /** @type {(value?: unknown) => void} */
  let resolve;
  /** @type {(reason?: unknown) => void} */
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}


test('factory throws without runRewrite or rateLimiter.check', () => {
  assert.throws(() => createRewriteHandler({ rateLimiter: allowedLimiter() }), TypeError);
  assert.throws(() => createRewriteHandler({ rateLimiter: {}, runRewrite() {} }), TypeError);
});

test('405 for non-POST and no-store header is always set', async () => {
  const res = makeRes();
  const handler = createRewriteHandler({ rateLimiter: allowedLimiter(), runRewrite() {} });
  await handler({ method: 'GET', headers: {}, body: validBody() }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(res.json(), { error: 'method not allowed' });
});

test('413 for oversize raw body', async () => {
  const res = makeRes();
  const handler = createRewriteHandler({ rateLimiter: allowedLimiter(), runRewrite() {}, maxBodyBytes: 8 });
  await handler({ method: 'POST', headers: {}, body: JSON.stringify(validBody()) }, res);
  assert.equal(res.statusCode, 413);
  assert.deepEqual(res.json(), { error: 'request body too large' });
});

test('400 for invalid JSON', async () => {
  const res = makeRes();
  const handler = createRewriteHandler({ rateLimiter: allowedLimiter(), runRewrite() {} });
  await handler({ method: 'POST', headers: {}, body: '{not json' }, res);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.json(), { error: 'invalid JSON' });
});

test('400 and 413 from validateRewriteRequest', async () => {
  const handler = createRewriteHandler({ rateLimiter: allowedLimiter(), runRewrite() {} });

  const badLang = makeRes();
  await handler({ method: 'POST', headers: {}, body: validBody({ lang: 'fr' }) }, badLang);
  assert.equal(badLang.statusCode, 400);
  assert.match(badLang.json().error, /lang must be one of/);

  const overCap = makeRes();
  await handler({ method: 'POST', headers: {}, body: validBody({ text: 'x'.repeat(4001) }) }, overCap);
  assert.equal(overCap.statusCode, 413);
  assert.match(overCap.json().error, /text exceeds 4000/);
});

test('429 denial from limiter does not call runRewrite', async () => {
  let calls = 0;
  const res = makeRes();
  const handler = createRewriteHandler({
    rateLimiter: { async check() { return { allowed: false, status: 429, reason: 'daily quota exceeded' }; } },
    runRewrite() { calls += 1; },
  });
  await handler({ method: 'POST', headers: { 'x-real-ip': '203.0.113.20' }, body: validBody() }, res);
  assert.equal(res.statusCode, 429);
  assert.equal(calls, 0);
  assert.deepEqual(res.json(), { error: 'daily quota exceeded' });
});

test('503 fail-closed limiter result does not call runRewrite', async () => {
  let calls = 0;
  const res = makeRes();
  const handler = createRewriteHandler({
    rateLimiter: { async check() { return { allowed: false, status: 503, reason: 'quota storage unavailable' }; } },
    runRewrite() { calls += 1; },
  });
  await handler({ method: 'POST', headers: { 'x-real-ip': '203.0.113.21' }, body: validBody() }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(calls, 0);
  assert.deepEqual(res.json(), { error: 'quota storage unavailable' });
});

test('happy path calls runRewrite once with validated request value and tier', async () => {
  let calls = 0;
  let observed;
  const res = makeRes();
  const handler = createRewriteHandler({
    rateLimiter: {
      async check({ tier, ip }) {
        assert.equal(tier, WEB_TIERS.FREE);
        assert.equal(ip, '203.0.113.22');
        return { allowed: true, tier };
      },
    },
    runRewrite(args) {
      calls += 1;
      observed = args.request;
      return 'runner-result';
    },
  });
  const result = await handler({ method: 'POST', headers: { 'x-real-ip': '203.0.113.22' }, body: validBody() }, res);
  assert.equal(result, 'runner-result');
  assert.equal(calls, 1);
  assert.equal(observed.tier, WEB_TIERS.FREE);
  assert.equal(observed.original, validBody().text);
  assert.equal(observed.provider, 'openai');
});

test('thrown handler error returns generic 500 and logs a redacted message', async () => {
  const logs = [];
  const res = makeRes();
  const handler = createRewriteHandler({
    rateLimiter: allowedLimiter(),
    runRewrite() {
      throw new Error('boom sk-secret123456789');
    },
    logger: { error(value) { logs.push(value); } },
  });
  await handler({ method: 'POST', headers: { 'x-real-ip': '203.0.113.23' }, body: validBody() }, res);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.json(), { error: 'internal error' });
  assert.equal(res.ended.includes('sk-secret'), false);
  assert.equal(JSON.stringify(logs).includes('sk-secret'), false);
  assert.match(JSON.stringify(logs), /\[REDACTED\]/);
});

test('free concurrent requests allow one runner and reject the second before runRewrite', async () => {
  const gate = deferred();
  let calls = 0;
  const limiter = createRateLimiter({
    kv: createMemoryKv(),
    hmacSecret: 'secret',
    now: () => 0,
    limits: { free: { maxChars: 4000, maxConcurrent: 1, reqPerDay: 99, burstPerHour: 99 }, byok: { maxChars: 20000, maxConcurrent: 2 } },
  });
  const handler = createRewriteHandler({
    rateLimiter: limiter,
    async runRewrite({ res }) {
      calls += 1;
      res.statusCode = 200;
      await gate.promise;
      res.end(JSON.stringify({ ok: true }));
    },
  });

  const firstRes = makeRes();
  const first = handler({ method: 'POST', headers: { 'x-real-ip': '203.0.113.31' }, body: validBody() }, firstRes);
  await new Promise((resolve) => setImmediate(resolve));

  const secondRes = makeRes();
  await handler({ method: 'POST', headers: { 'x-real-ip': '203.0.113.31' }, body: validBody() }, secondRes);

  assert.equal(calls, 1);
  assert.equal(secondRes.statusCode, 429);
  assert.deepEqual(secondRes.json(), { error: 'concurrent limit exceeded' });

  gate.resolve();
  await first;
  assert.equal(firstRes.statusCode, 200);
  assert.deepEqual(firstRes.json(), { ok: true });

  const thirdRes = makeRes();
  await handler({ method: 'POST', headers: { 'x-real-ip': '203.0.113.31' }, body: validBody() }, thirdRes);
  assert.equal(thirdRes.statusCode, 200);
  assert.equal(calls, 2);
});

test('free concurrency slot is released when runRewrite throws', async () => {
  let calls = 0;
  const limiter = createRateLimiter({
    kv: createMemoryKv(),
    hmacSecret: 'secret',
    now: () => 0,
    limits: { free: { maxChars: 4000, maxConcurrent: 1, reqPerDay: 99, burstPerHour: 99 }, byok: { maxChars: 20000, maxConcurrent: 2 } },
  });
  const handler = createRewriteHandler({
    rateLimiter: limiter,
    runRewrite() {
      calls += 1;
      if (calls === 1) throw new Error('boom');
      return 'ok';
    },
    logger: { error() {} },
  });

  const firstRes = makeRes();
  await handler({ method: 'POST', headers: { 'x-real-ip': '203.0.113.32' }, body: validBody() }, firstRes);
  assert.equal(firstRes.statusCode, 500);

  const secondRes = makeRes();
  const result = await handler({ method: 'POST', headers: { 'x-real-ip': '203.0.113.32' }, body: validBody() }, secondRes);
  assert.equal(result, 'ok');
  assert.equal(calls, 2);
});

test('BYOK concurrent requests bypass free concurrency limit', async () => {
  const gate = deferred();
  let calls = 0;
  const limiter = createRateLimiter({
    kv: createMemoryKv(),
    hmacSecret: 'secret',
    now: () => 0,
    limits: { free: { maxChars: 4000, maxConcurrent: 1, reqPerDay: 99, burstPerHour: 99 }, byok: { maxChars: 20000, maxConcurrent: 2 } },
  });
  const handler = createRewriteHandler({
    rateLimiter: limiter,
    async runRewrite({ res }) {
      calls += 1;
      res.statusCode = 200;
      await gate.promise;
      res.end(JSON.stringify({ ok: true }));
    },
  });
  const body = validBody({
    tier: WEB_TIERS.BYOK,
    provider: 'openai',
    model: 'gpt-5.5',
    apiKey: 'sk-test-byok-key',
  });

  const firstRes = makeRes();
  const secondRes = makeRes();
  const first = handler({ method: 'POST', headers: { 'x-real-ip': '203.0.113.33' }, body }, firstRes);
  const second = handler({ method: 'POST', headers: { 'x-real-ip': '203.0.113.33' }, body }, secondRes);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(calls, 2);
  gate.resolve();
  await Promise.all([first, second]);
  assert.equal(firstRes.statusCode, 200);
  assert.equal(secondRes.statusCode, 200);
});
