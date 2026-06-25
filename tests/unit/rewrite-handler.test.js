import test from 'node:test';
import assert from 'node:assert/strict';

import { createRewriteHandler } from '../../src/rewrite-handler.js';
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
