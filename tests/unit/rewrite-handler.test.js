import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers';

import { createRewriteHandler } from '../../src/rewrite-handler.js';
import { createMemoryKv, createRateLimiter } from '../../src/rate-limit.js';
import { QUOTA_REASONS, WEB_TIERS } from '../../src/web-rewrite-contract.js';

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

/** A rate limiter that records every check/acquire/release call for assertions. */
function spyLimiter() {
  const calls = { check: [], acquire: [], release: [] };
  return {
    calls,
    async check(input) { calls.check.push(input); return { allowed: true, tier: input.tier }; },
    async acquireConcurrency(input) { calls.acquire.push(input); return { allowed: true, tier: input.tier }; },
    async releaseConcurrency(input) { calls.release.push(input); },
  };
}

/** A license validator stub that records its input and returns a fixed decision. */
function makeValidator(result) {
  const state = { calls: 0, lastInput: undefined };
  return {
    state,
    async validate(input) {
      state.calls += 1;
      state.lastInput = input;
      return result;
    },
  };
}

function proBody(overrides = {}) {
  return { mode: 'first', lang: 'en', tier: WEB_TIERS.PRO, text: 'Rewrite this sentence.', ...overrides };
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
test('send() tears down an already-committed response instead of throwing ERR_HTTP_HEADERS_SENT', async () => {
  let destroyed = false;
  const res = {
    statusCode: 0,
    headersSent: false,
    writableEnded: false,
    setHeader() {
      // Mirror Node: mutating headers after they are flushed throws.
      if (this.headersSent) throw new Error('ERR_HTTP_HEADERS_SENT');
    },
    write() {
      // Writing the first frame commits the response (headers flushed).
      this.headersSent = true;
    },
    end() {
      if (this.headersSent) throw new Error('ERR_HTTP_HEADERS_SENT');
    },
    destroy() { destroyed = true; },
  };
  const handler = createRewriteHandler({
    rateLimiter: allowedLimiter(),
    runRewrite({ res: r }) {
      r.write('{"type":"start"}\n'); // stream started -> response committed
      throw new Error('boom after the first frame');
    },
    logger: { error() {} },
  });

  await assert.doesNotReject(
    handler({ method: 'POST', headers: { 'x-real-ip': '203.0.113.24' }, body: validBody() }, res),
    'a committed-response 500 path must not re-throw ERR_HTTP_HEADERS_SENT',
  );
  assert.equal(destroyed, true, 'a committed response must be torn down, not re-headered');
});

test('pro path: valid Bearer + valid license runs the rewrite metered by the license subject', async () => {
  const res = makeRes();
  const limiter = spyLimiter();
  const validator = makeValidator({ ok: true, subject: 'S', tier: WEB_TIERS.PRO, status: 'active', cache: 'miss' });
  const RAW = 'LICENSE-RAW-abc123';
  let runnerArgs;
  const logs = [];
  const handler = createRewriteHandler({
    rateLimiter: limiter,
    licenseValidator: validator,
    runRewrite(args) { runnerArgs = args; return 'ran'; },
    logger: { error(v) { logs.push(v); } },
  });

  const result = await handler({
    method: 'POST',
    headers: { 'x-real-ip': '203.0.113.40', authorization: `Bearer ${RAW}` },
    body: proBody(),
  }, res);

  assert.equal(result, 'ran');
  // The license is validated exactly once, by its raw value.
  assert.equal(validator.state.calls, 1);
  assert.deepEqual(validator.state.lastInput, { licenseKey: RAW });
  // Metered by the HMAC subject on every limiter call — never the client IP.
  assert.equal(limiter.calls.check[0].tier, WEB_TIERS.PRO);
  assert.equal(limiter.calls.check[0].subject, 'S');
  assert.equal(limiter.calls.acquire[0].subject, 'S');
  assert.equal(limiter.calls.release[0].subject, 'S');
  // The runner's validated request carries no raw license and no resolved key.
  assert.equal(runnerArgs.request.apiKey, undefined);
  assert.equal('license' in runnerArgs.request, false);
  assert.equal('licenseKey' in runnerArgs.request, false);
  assert.equal(JSON.stringify(runnerArgs.request).includes(RAW), false);
  // No error path fired, so nothing — least of all the license — was logged.
  assert.equal(JSON.stringify(logs).includes(RAW), false);
});

test('pro path: a missing Bearer license is 401 LICENSE_REQUIRED before validate or the runner', async () => {
  const res = makeRes();
  const limiter = spyLimiter();
  const validator = makeValidator({ ok: true, subject: 'S', tier: WEB_TIERS.PRO, status: 'active', cache: 'miss' });
  let ran = false;
  const handler = createRewriteHandler({
    rateLimiter: limiter,
    licenseValidator: validator,
    runRewrite() { ran = true; },
  });
  await handler({ method: 'POST', headers: { 'x-real-ip': '203.0.113.41' }, body: proBody() }, res);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.json(), { error: QUOTA_REASONS.LICENSE_REQUIRED });
  assert.equal(validator.state.calls, 0);
  assert.equal(ran, false);
  assert.equal(limiter.calls.check.length, 0);
});

test('pro path: an invalid license returns the validator 403/reason and skips the runner', async () => {
  const res = makeRes();
  const limiter = spyLimiter();
  const validator = makeValidator({ ok: false, status: 403, reason: QUOTA_REASONS.LICENSE_INVALID });
  const RAW = 'LICENSE-RAW-invalid';
  let ran = false;
  const handler = createRewriteHandler({
    rateLimiter: limiter,
    licenseValidator: validator,
    runRewrite() { ran = true; },
  });
  await handler({ method: 'POST', headers: { 'x-real-ip': '203.0.113.42', authorization: `Bearer ${RAW}` }, body: proBody() }, res);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.json(), { error: QUOTA_REASONS.LICENSE_INVALID });
  assert.equal(ran, false);
  assert.equal(limiter.calls.check.length, 0);
  // The denial body never echoes the raw license.
  assert.equal(res.ended.includes(RAW), false);
});

test('pro path: an unavailable validator result returns 503 and skips the runner', async () => {
  const res = makeRes();
  const validator = makeValidator({ ok: false, status: 503, reason: QUOTA_REASONS.LICENSE_UNAVAILABLE });
  let ran = false;
  const handler = createRewriteHandler({
    rateLimiter: spyLimiter(),
    licenseValidator: validator,
    runRewrite() { ran = true; },
  });
  await handler({ method: 'POST', headers: { 'x-real-ip': '203.0.113.43', authorization: 'Bearer LICENSE-RAW-unavail' }, body: proBody() }, res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.json(), { error: QUOTA_REASONS.LICENSE_UNAVAILABLE });
  assert.equal(ran, false);
});

test('pro path: a missing licenseValidator fails closed with 503 LICENSE_UNAVAILABLE', async () => {
  const res = makeRes();
  let ran = false;
  const handler = createRewriteHandler({
    rateLimiter: spyLimiter(),
    runRewrite() { ran = true; },
  }); // no licenseValidator injected
  await handler({ method: 'POST', headers: { 'x-real-ip': '203.0.113.44', authorization: 'Bearer LICENSE-RAW-x' }, body: proBody() }, res);
  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.json(), { error: QUOTA_REASONS.LICENSE_UNAVAILABLE });
  assert.equal(ran, false);
});

test('free and byok stay metered without a license subject (no regression)', async () => {
  // FREE: a validator is present but must never be consulted for a non-pro tier.
  const freeLimiter = spyLimiter();
  const freeValidator = makeValidator({ ok: false, status: 503, reason: 'must-not-be-called' });
  const freeRes = makeRes();
  let freeRan = false;
  const freeHandler = createRewriteHandler({
    rateLimiter: freeLimiter,
    licenseValidator: freeValidator,
    runRewrite() { freeRan = true; return 'free-ran'; },
  });
  const freeResult = await freeHandler({ method: 'POST', headers: { 'x-real-ip': '203.0.113.45' }, body: validBody() }, freeRes);
  assert.equal(freeResult, 'free-ran');
  assert.equal(freeRan, true);
  assert.equal(freeValidator.state.calls, 0);
  assert.equal(freeLimiter.calls.check[0].tier, WEB_TIERS.FREE);
  assert.equal(freeLimiter.calls.check[0].ip, '203.0.113.45');
  assert.equal(freeLimiter.calls.check[0].subject, undefined);
  assert.equal(freeLimiter.calls.acquire[0].subject, undefined);
  assert.equal(freeLimiter.calls.release[0].subject, undefined);

  // BYOK: no validator needed; still no subject on any limiter call.
  const byokLimiter = spyLimiter();
  const byokRes = makeRes();
  const byokHandler = createRewriteHandler({
    rateLimiter: byokLimiter,
    runRewrite() { return 'byok-ran'; },
  });
  const byokResult = await byokHandler(
    { method: 'POST', headers: { 'x-real-ip': '203.0.113.46' }, body: validBody({ tier: WEB_TIERS.BYOK, provider: 'openai', model: 'gpt-5.5', apiKey: 'sk-caller-byok' }) },
    byokRes,
  );
  assert.equal(byokResult, 'byok-ran');
  assert.equal(byokLimiter.calls.check[0].tier, WEB_TIERS.BYOK);
  assert.equal(byokLimiter.calls.check[0].subject, undefined);
});

// ─────────────────────────────────────────────────────────────────────────────
// G004 red-team: adversarial pro-path license-isolation + fail-closed matrix.
// Product code is unchanged; every dependency (rateLimiter, licenseValidator,
// runRewrite, req/res) is an injected mock/spy. These target gaps beyond the
// existing pro happy-path/denial tests above.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A pro-capable spy limiter that can deny at check or acquire, records every
 * input, and logs call order (with the runner able to push 'run').
 */
function proSpyLimiter({ denyCheck, denyAcquire } = {}) {
  const calls = { check: [], acquire: [], release: [] };
  const order = [];
  return {
    calls,
    order,
    async check(input) {
      calls.check.push(input);
      order.push('check');
      return denyCheck ? { allowed: false, status: denyCheck.status, reason: denyCheck.reason } : { allowed: true, tier: input.tier };
    },
    async acquireConcurrency(input) {
      calls.acquire.push(input);
      order.push('acquire');
      return denyAcquire ? { allowed: false, status: denyAcquire.status, reason: denyAcquire.reason } : { allowed: true, tier: input.tier };
    },
    async releaseConcurrency(input) {
      calls.release.push(input);
      order.push('release');
    },
  };
}

/** A distinctive raw license used to assert it never escapes the handler frame. */
const PRO_RAW = 'LICENSE-RAW-e2e-DEADBEEF-4b2f-secret-token';

test('redteam(1): a valid pro request leaks the raw license nowhere (runner request, limiter args, response body, logs) — only the HMAC subject meters', async () => {
  const res = makeRes();
  const limiter = proSpyLimiter();
  const validator = makeValidator({ ok: true, subject: 'SUBJECT-HMAC', tier: WEB_TIERS.PRO, status: 'active', cache: 'miss' });
  const logs = [];
  let runnerArgs;
  const handler = createRewriteHandler({
    rateLimiter: limiter,
    licenseValidator: validator,
    // A realistic runner: echo the *validated request* it receives into the body.
    runRewrite(args) {
      runnerArgs = args;
      args.res.statusCode = 200;
      args.res.end(JSON.stringify({ echoed: args.request }));
      return 'ran';
    },
    logger: { error(v) { logs.push(v); } },
  });

  const result = await handler({
    method: 'POST',
    headers: { 'x-real-ip': '203.0.113.60', authorization: `Bearer ${PRO_RAW}` },
    body: proBody(),
  }, res);

  assert.equal(result, 'ran');
  // Only the validator ever sees the raw license, and exactly once.
  assert.equal(validator.state.calls, 1);
  assert.deepEqual(validator.state.lastInput, { licenseKey: PRO_RAW });

  // (b) Every limiter arg is metered by the HMAC subject and carries NO license material.
  const limiterInputs = [...limiter.calls.check, ...limiter.calls.acquire, ...limiter.calls.release];
  assert.equal(limiterInputs.length, 3);
  for (const input of limiterInputs) {
    assert.equal(input.subject, 'SUBJECT-HMAC');
    assert.equal(input.tier, WEB_TIERS.PRO);
    assert.equal(input.ip, '203.0.113.60');
    for (const k of Object.keys(input)) assert.ok(['chars', 'ip', 'subject', 'tier'].includes(k), `unexpected limiter arg key: ${k}`);
    assert.equal('license' in input, false);
    assert.equal('licenseKey' in input, false);
  }
  assert.equal(JSON.stringify(limiter.calls).includes(PRO_RAW), false);

  // (a) The runner's validated request has no raw license and no resolved key.
  assert.equal(runnerArgs.request.apiKey, undefined);
  assert.equal('license' in runnerArgs.request, false);
  assert.equal('licenseKey' in runnerArgs.request, false);
  assert.equal(JSON.stringify(runnerArgs.request).includes(PRO_RAW), false);

  // (c) The response body the client sees never contains the raw license.
  assert.equal(res.ended.includes(PRO_RAW), false);
  assert.equal(res.json().echoed.apiKey, undefined);

  // (d) Nothing (least of all the license) is logged on the success path.
  assert.equal(logs.length, 0);
  assert.equal(JSON.stringify(logs).includes(PRO_RAW), false);
});

test('redteam(2): every malformed pro Authorization (absent/blank/non-Bearer/no-token/multi-key/multi-value) is 401 LICENSE_REQUIRED before validate or the runner', async () => {
  const cases = [
    { name: 'absent', headers: { 'x-real-ip': '203.0.113.61' } },
    { name: 'blank', headers: { 'x-real-ip': '203.0.113.61', authorization: '' } },
    { name: 'non-Bearer scheme', headers: { 'x-real-ip': '203.0.113.61', authorization: 'Basic QWxhZGRpbjpvcGVu' } },
    { name: 'scheme with no token', headers: { 'x-real-ip': '203.0.113.61', authorization: 'Bearer' } },
    { name: 'multiple header keys', headers: { 'x-real-ip': '203.0.113.61', authorization: 'Bearer aaaaaaaa', Authorization: 'Bearer bbbbbbbb' } },
    { name: 'multiple header values', headers: { 'x-real-ip': '203.0.113.61', authorization: ['Bearer aaaaaaaa', 'Bearer bbbbbbbb'] } },
  ];
  for (const c of cases) {
    const res = makeRes();
    const limiter = proSpyLimiter();
    const validator = makeValidator({ ok: true, subject: 'S', tier: WEB_TIERS.PRO, status: 'active', cache: 'miss' });
    let ran = false;
    const handler = createRewriteHandler({
      rateLimiter: limiter,
      licenseValidator: validator,
      runRewrite() { ran = true; },
    });
    await handler({ method: 'POST', headers: c.headers, body: proBody() }, res);
    assert.equal(res.statusCode, 401, `${c.name}: status`);
    assert.deepEqual(res.json(), { error: QUOTA_REASONS.LICENSE_REQUIRED }, `${c.name}: reason`);
    assert.equal(validator.state.calls, 0, `${c.name}: validator must not run`);
    assert.equal(limiter.calls.check.length, 0, `${c.name}: limiter.check must not run`);
    assert.equal(ran, false, `${c.name}: runner must not run`);
    assert.equal(res.headers['cache-control'], 'no-store', `${c.name}: no-store`);
  }
});

test('redteam(2): a validator denial (401/403/503) is passed through verbatim and skips both the limiter and the runner', async () => {
  const denials = [
    { status: 401, reason: 'license authentication failed' },
    { status: 403, reason: QUOTA_REASONS.LICENSE_INVALID },
    { status: 503, reason: QUOTA_REASONS.LICENSE_UNAVAILABLE },
  ];
  for (const d of denials) {
    const res = makeRes();
    const limiter = proSpyLimiter();
    const validator = makeValidator({ ok: false, status: d.status, reason: d.reason });
    let ran = false;
    const handler = createRewriteHandler({
      rateLimiter: limiter,
      licenseValidator: validator,
      runRewrite() { ran = true; },
    });
    await handler({
      method: 'POST',
      headers: { 'x-real-ip': '203.0.113.62', authorization: `Bearer ${PRO_RAW}` },
      body: proBody(),
    }, res);
    assert.equal(res.statusCode, d.status, `status ${d.status}`);
    assert.deepEqual(res.json(), { error: d.reason }, `reason ${d.status}`);
    assert.equal(validator.state.calls, 1, `validator consulted ${d.status}`);
    assert.equal(limiter.calls.check.length, 0, `no metering ${d.status}`);
    assert.equal(ran, false, `no runner ${d.status}`);
    assert.equal(res.ended.includes(PRO_RAW), false, `no license in body ${d.status}`);
    assert.equal(res.headers['cache-control'], 'no-store', `no-store ${d.status}`);
  }
});

test('redteam(2): an unwired validator (absent, empty, or non-function validate) fails closed with 503 LICENSE_UNAVAILABLE even with a valid Bearer', async () => {
  for (const injected of [undefined, {}, { validate: 'not-a-function' }]) {
    const res = makeRes();
    const limiter = proSpyLimiter();
    let ran = false;
    const handler = createRewriteHandler({
      rateLimiter: limiter,
      licenseValidator: injected,
      runRewrite() { ran = true; },
    });
    await handler({
      method: 'POST',
      headers: { 'x-real-ip': '203.0.113.63', authorization: `Bearer ${PRO_RAW}` },
      body: proBody(),
    }, res);
    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.json(), { error: QUOTA_REASONS.LICENSE_UNAVAILABLE });
    assert.equal(ran, false);
    assert.equal(limiter.calls.check.length, 0);
    assert.equal(res.ended.includes(PRO_RAW), false);
    assert.equal(res.headers['cache-control'], 'no-store');
  }
});

test('redteam(2): a throwing validator is caught as a redacted generic 500 — no license in the body, redacted in the log, runner and limiter never reached', async () => {
  const res = makeRes();
  const limiter = proSpyLimiter();
  const logs = [];
  let ran = false;
  // A careless validator that echoes the bearer credential into its error text.
  const validator = {
    calls: 0,
    validate(input) {
      this.calls += 1;
      throw new Error(`LS upstream 500 for Bearer ${input.licenseKey}`);
    },
  };
  const handler = createRewriteHandler({
    rateLimiter: limiter,
    licenseValidator: validator,
    runRewrite() { ran = true; },
    logger: { error(v) { logs.push(v); } },
  });
  await handler({
    method: 'POST',
    headers: { 'x-real-ip': '203.0.113.64', authorization: `Bearer ${PRO_RAW}` },
    body: proBody(),
  }, res);
  assert.equal(validator.calls, 1);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.json(), { error: 'internal error' }); // generic, no internals
  assert.equal(res.ended.includes(PRO_RAW), false); // license never in the response body
  assert.equal(ran, false); // runner never reached
  assert.equal(limiter.calls.check.length, 0); // metering never reached
  // Defense-in-depth: the logged message is passed through redactSecrets.
  assert.equal(JSON.stringify(logs).includes(PRO_RAW), false);
  assert.match(JSON.stringify(logs), /\[REDACTED\]/);
  assert.equal(res.headers['cache-control'], 'no-store');
});

test('redteam(3): a pro check denial skips acquire, the runner, and release (subject threaded into check)', async () => {
  const res = makeRes();
  const limiter = proSpyLimiter({ denyCheck: { status: 429, reason: QUOTA_REASONS.DAILY } });
  const validator = makeValidator({ ok: true, subject: 'SUBJ', tier: WEB_TIERS.PRO, status: 'active', cache: 'miss' });
  let ran = false;
  const handler = createRewriteHandler({
    rateLimiter: limiter,
    licenseValidator: validator,
    runRewrite() { ran = true; },
  });
  await handler({
    method: 'POST',
    headers: { 'x-real-ip': '203.0.113.65', authorization: `Bearer ${PRO_RAW}` },
    body: proBody(),
  }, res);
  assert.equal(res.statusCode, 429);
  assert.deepEqual(res.json(), { error: QUOTA_REASONS.DAILY });
  assert.equal(ran, false);
  assert.equal(limiter.calls.check.length, 1);
  assert.equal(limiter.calls.check[0].subject, 'SUBJ');
  assert.equal(limiter.calls.acquire.length, 0);
  assert.equal(limiter.calls.release.length, 0);
});

test('redteam(3): a pro acquire denial skips the runner and does NOT release (release only pairs a granted slot)', async () => {
  const res = makeRes();
  const limiter = proSpyLimiter({ denyAcquire: { status: 429, reason: QUOTA_REASONS.CONCURRENT } });
  const validator = makeValidator({ ok: true, subject: 'SUBJ', tier: WEB_TIERS.PRO, status: 'active', cache: 'miss' });
  let ran = false;
  const handler = createRewriteHandler({
    rateLimiter: limiter,
    licenseValidator: validator,
    runRewrite() { ran = true; },
  });
  await handler({
    method: 'POST',
    headers: { 'x-real-ip': '203.0.113.66', authorization: `Bearer ${PRO_RAW}` },
    body: proBody(),
  }, res);
  assert.equal(res.statusCode, 429);
  assert.deepEqual(res.json(), { error: QUOTA_REASONS.CONCURRENT });
  assert.equal(ran, false);
  assert.equal(limiter.calls.check.length, 1);
  assert.equal(limiter.calls.acquire.length, 1);
  assert.equal(limiter.calls.acquire[0].subject, 'SUBJ');
  assert.equal(limiter.calls.release.length, 0); // key contract: no release without a granted slot
});

test('redteam(3): the pro success path threads the subject through check→acquire→run→release in order', async () => {
  const res = makeRes();
  const limiter = proSpyLimiter();
  const validator = makeValidator({ ok: true, subject: 'SUBJ', tier: WEB_TIERS.PRO, status: 'active', cache: 'miss' });
  const handler = createRewriteHandler({
    rateLimiter: limiter,
    licenseValidator: validator,
    runRewrite() { limiter.order.push('run'); return 'ran'; },
  });
  const result = await handler({
    method: 'POST',
    headers: { 'x-real-ip': '203.0.113.67', authorization: `Bearer ${PRO_RAW}` },
    body: proBody(),
  }, res);
  assert.equal(result, 'ran');
  assert.deepEqual(limiter.order, ['check', 'acquire', 'run', 'release']);
  assert.equal(limiter.calls.release.length, 1);
  assert.equal(limiter.calls.release[0].subject, 'SUBJ');
});

test('redteam(3): when the pro runner throws, release still runs in finally (subject-scoped) and the handler returns a redacted 500', async () => {
  const res = makeRes();
  const limiter = proSpyLimiter();
  const validator = makeValidator({ ok: true, subject: 'SUBJ', tier: WEB_TIERS.PRO, status: 'active', cache: 'miss' });
  const logs = [];
  const handler = createRewriteHandler({
    rateLimiter: limiter,
    licenseValidator: validator,
    runRewrite() { limiter.order.push('run'); throw new Error('runner exploded'); },
    logger: { error(v) { logs.push(v); } },
  });
  await handler({
    method: 'POST',
    headers: { 'x-real-ip': '203.0.113.68', authorization: `Bearer ${PRO_RAW}` },
    body: proBody(),
  }, res);
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.json(), { error: 'internal error' });
  assert.equal(limiter.calls.release.length, 1);
  assert.equal(limiter.calls.release[0].subject, 'SUBJ');
  assert.deepEqual(limiter.order, ['check', 'acquire', 'run', 'release']);
});

test('redteam(4): free and byok ignore an attacker-supplied Authorization header — no validator, no subject, no license in the runner request', async () => {
  // FREE: a validator is injected but must never be consulted; the stray Bearer is ignored.
  const freeLimiter = proSpyLimiter();
  const freeValidator = makeValidator({ ok: false, status: 503, reason: 'must-not-run' });
  const freeRes = makeRes();
  let freeArgs;
  const freeHandler = createRewriteHandler({
    rateLimiter: freeLimiter,
    licenseValidator: freeValidator,
    runRewrite(args) { freeArgs = args; return 'free-ran'; },
  });
  const freeResult = await freeHandler({
    method: 'POST',
    headers: { 'x-real-ip': '203.0.113.70', authorization: `Bearer ${PRO_RAW}` },
    body: validBody(),
  }, freeRes);
  assert.equal(freeResult, 'free-ran');
  assert.equal(freeValidator.state.calls, 0);
  assert.equal(freeLimiter.calls.check[0].tier, WEB_TIERS.FREE);
  assert.equal(freeLimiter.calls.check[0].ip, '203.0.113.70');
  assert.equal(freeLimiter.calls.check[0].subject, undefined);
  assert.equal(freeLimiter.calls.acquire[0].subject, undefined);
  assert.equal(freeLimiter.calls.release[0].subject, undefined);
  assert.equal(freeArgs.request.apiKey, undefined);
  assert.equal('license' in freeArgs.request, false);
  assert.equal(JSON.stringify(freeArgs.request).includes(PRO_RAW), false);

  // BYOK: the caller key stays in the body; the stray Bearer is ignored; still no validator/subject.
  const byokLimiter = proSpyLimiter();
  const byokValidator = makeValidator({ ok: false, status: 503, reason: 'must-not-run' });
  const byokRes = makeRes();
  let byokArgs;
  const byokHandler = createRewriteHandler({
    rateLimiter: byokLimiter,
    licenseValidator: byokValidator,
    runRewrite(args) { byokArgs = args; return 'byok-ran'; },
  });
  const byokResult = await byokHandler({
    method: 'POST',
    headers: { 'x-real-ip': '203.0.113.71', authorization: `Bearer ${PRO_RAW}` },
    body: validBody({ tier: WEB_TIERS.BYOK, provider: 'openai', model: 'gpt-5.5', apiKey: 'sk-caller-byok-key' }),
  }, byokRes);
  assert.equal(byokResult, 'byok-ran');
  assert.equal(byokValidator.state.calls, 0);
  assert.equal(byokLimiter.calls.check[0].tier, WEB_TIERS.BYOK);
  assert.equal(byokLimiter.calls.check[0].subject, undefined);
  assert.equal(byokArgs.request.apiKey, 'sk-caller-byok-key');
  assert.equal('license' in byokArgs.request, false);
  assert.equal(JSON.stringify(byokArgs.request).includes(PRO_RAW), false);
});

test('redteam(5): pro fail-closed responses (401/403/503) carry the full no-store security header set', async () => {
  // 401 — missing Bearer.
  const res401 = makeRes();
  const h401 = createRewriteHandler({
    rateLimiter: proSpyLimiter(),
    licenseValidator: makeValidator({ ok: true, subject: 'S', tier: WEB_TIERS.PRO, status: 'active', cache: 'miss' }),
    runRewrite() {},
  });
  await h401({ method: 'POST', headers: { 'x-real-ip': '203.0.113.72' }, body: proBody() }, res401);

  // 403 — invalid license.
  const res403 = makeRes();
  const h403 = createRewriteHandler({
    rateLimiter: proSpyLimiter(),
    licenseValidator: makeValidator({ ok: false, status: 403, reason: QUOTA_REASONS.LICENSE_INVALID }),
    runRewrite() {},
  });
  await h403({ method: 'POST', headers: { 'x-real-ip': '203.0.113.72', authorization: `Bearer ${PRO_RAW}` }, body: proBody() }, res403);

  // 503 — validator unavailable.
  const res503 = makeRes();
  const h503 = createRewriteHandler({ rateLimiter: proSpyLimiter(), runRewrite() {} });
  await h503({ method: 'POST', headers: { 'x-real-ip': '203.0.113.72', authorization: `Bearer ${PRO_RAW}` }, body: proBody() }, res503);

  for (const [label, res, status] of [['401', res401, 401], ['403', res403, 403], ['503', res503, 503]]) {
    assert.equal(res.statusCode, status, `${label}: status`);
    assert.equal(res.headers['cache-control'], 'no-store', `${label}: cache-control`);
    assert.equal(res.headers['x-content-type-options'], 'nosniff', `${label}: nosniff`);
    assert.equal(res.headers['content-type'], 'application/json', `${label}: content-type`);
  }
});

test('redteam(6): the runner request has its Authorization header stripped; non-secret headers and on/off delegation survive', async () => {
  const res = makeRes();
  const limiter = proSpyLimiter();
  const validator = makeValidator({ ok: true, subject: 'SUBJ', tier: WEB_TIERS.PRO, status: 'active', cache: 'miss' });
  let runnerArgs;
  const onEvents = [];
  const realReq = {
    method: 'POST',
    headers: { 'x-real-ip': '203.0.113.80', authorization: `Bearer ${PRO_RAW}`, 'content-type': 'application/json' },
    body: proBody(),
    on: (event) => { onEvents.push(event); },
    off: () => {},
  };
  const handler = createRewriteHandler({
    rateLimiter: limiter,
    licenseValidator: validator,
    runRewrite(args) { runnerArgs = args; args.res.statusCode = 200; args.res.end('ok'); return 'ran'; },
  });
  await handler(realReq, res);

  // The runner must never observe the raw Bearer license through req.headers.
  const runnerHeaders = runnerArgs.req.headers || {};
  for (const k of Object.keys(runnerHeaders)) {
    assert.notEqual(k.toLowerCase(), 'authorization', `runner req retained header ${k}`);
  }
  assert.equal(JSON.stringify(runnerArgs.req).includes(PRO_RAW), false);
  // Non-secret headers survive, and cancellation (on) delegates to the REAL req.
  assert.equal(runnerHeaders['x-real-ip'], '203.0.113.80');
  assert.equal(typeof runnerArgs.req.on, 'function');
  runnerArgs.req.on('aborted', () => {});
  assert.deepEqual(onEvents, ['aborted']);
});

test('pro path passes the request char count to the limiter (monthly cap plumbing); free passes 0', async () => {
  const PRO_RAW = 'LICENSE-RAW-chars';
  const proLimiter = spyLimiter();
  const proHandler = createRewriteHandler({
    rateLimiter: proLimiter,
    licenseValidator: makeValidator({ ok: true, subject: 'SUBJ-chars', tier: WEB_TIERS.PRO, status: 'active', cache: 'miss' }),
    runRewrite() { return 'ran'; },
  });
  const text = 'Rewrite this exact sentence.';
  await proHandler({ method: 'POST', headers: { 'x-real-ip': '203.0.113.90', authorization: `Bearer ${PRO_RAW}` }, body: proBody({ text }) }, makeRes());
  assert.equal(proLimiter.calls.check[0].tier, WEB_TIERS.PRO);
  assert.equal(proLimiter.calls.check[0].chars, text.length);
  assert.equal(proLimiter.calls.check[0].subject, 'SUBJ-chars');

  // Free carries no monthly char dimension: chars is 0 and no license is validated.
  const freeLimiter = spyLimiter();
  const freeHandler = createRewriteHandler({ rateLimiter: freeLimiter, runRewrite() { return 'free'; } });
  await freeHandler({ method: 'POST', headers: { 'x-real-ip': '203.0.113.91' }, body: validBody() }, makeRes());
  assert.equal(freeLimiter.calls.check[0].chars, 0);
  assert.equal(freeLimiter.calls.check[0].subject, undefined);
});

test('pro path forwards the monthly-char 429 with remaining/limit guidance and never runs the runner', async () => {
  const res = makeRes();
  let ran = false;
  const handler = createRewriteHandler({
    rateLimiter: {
      async check() {
        return { allowed: false, status: 429, reason: QUOTA_REASONS.MONTHLY_CHARS, remainingMonthlyChars: 0, limitMonthlyChars: 1000 };
      },
    },
    licenseValidator: makeValidator({ ok: true, subject: 'SUBJ-over', tier: WEB_TIERS.PRO, status: 'active', cache: 'miss' }),
    runRewrite() { ran = true; },
  });
  await handler({ method: 'POST', headers: { 'x-real-ip': '203.0.113.92', authorization: 'Bearer LICENSE-RAW-over' }, body: proBody() }, res);
  assert.equal(res.statusCode, 429);
  assert.deepEqual(res.json(), { error: QUOTA_REASONS.MONTHLY_CHARS, remainingMonthlyChars: 0, limitMonthlyChars: 1000 });
  assert.equal(ran, false);
});
