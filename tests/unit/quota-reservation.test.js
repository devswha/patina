import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createMemoryKv, createRateLimiter } from '../../src/rate-limit.js';
import { createRewriteHandler } from '../../src/rewrite-handler.js';
import { QUOTA_REASONS, TIER_LIMITS } from '../../src/web-rewrite-contract.js';

function setup(overrides = {}) {
  let time = Date.UTC(2026, 8, 4, 12);
  const now = () => time;
  const kv = createMemoryKv({ now });
  const limits = { ...TIER_LIMITS, pro: { ...TIER_LIMITS.pro, reqPerDay: 10, reqPerMonth: 2, charsPerMonth: 1000, ...overrides } };
  const limiter = createRateLimiter({ kv, hmacSecret: 'test-secret', now, limits });
  const check = (requestId, chars = 100) => limiter.check({ tier: 'pro', subject: 'subject', requestId, chars });
  return { kv, limiter, check, advance(value) { time = value; } };
}

// The monitor's probe is a real pro request carrying two server-side facts: the
// trusted observer marker and a license the validator accepts.
const OBSERVER_SECRET = 'observer-secret-value';
function probeHeaders(marker) {
  return { authorization: 'Bearer synthetic-license', 'x-real-ip': '203.0.113.1', ...(marker === undefined ? {} : { 'x-patina-synthetic-observer': marker }) };
}
function proRequest(headers, body = {}) {
  return { method: 'POST', headers, body: { mode: 'first', tier: 'pro', lang: 'en', text: 'Patina monitor health check.', ...body } };
}
function capture() { return { statusCode: 200, setHeader() {}, end(value) { this.body = value; }, body: undefined }; }
function proHandler(limiter, overrides = {}) {
  const runs = { count: 0 };
  return { runs, handler: createRewriteHandler({
    rateLimiter: limiter,
    env: { PATINA_SYNTHETIC_OBSERVER_SECRET: OBSERVER_SECRET },
    licenseValidator: { async validate() { return { ok: true, subject: 'subject', tier: 'pro', status: 'active', cache: 'miss' }; } },
    runRewrite: async () => { runs.count += 1; return { ok: true }; },
    ...overrides,
  }) };
}
async function spendMonthlyAllowance(limiter) {
  const first = await limiter.check({ tier: 'pro', subject: 'subject', chars: 100, requestId: 'customer-1' });
  const second = await limiter.check({ tier: 'pro', subject: 'subject', chars: 100, requestId: 'customer-2' });
  assert.equal(first.allowed && second.allowed, true);
  return first.reservation;
}

test('failed rewrite restores allowance exactly once while attempts remain counted', async () => {
  const { kv, limiter, check } = setup();
  const first = await check('one'); assert.equal(first.allowed, true);
  const plan = first.reservation;
  assert.deepEqual(await Promise.all(plan.keys.slice(0, 4).map((key) => kv.get(key))), [1, 1, 100, 1]);
  assert.equal(await limiter.settleReservation({ reservation: plan, refund: true }), true);
  assert.equal(await limiter.settleReservation({ reservation: plan, refund: true }), true);
  assert.deepEqual(await Promise.all(plan.keys.slice(0, 4).map((key) => kv.get(key))), [0, 0, 0, 1]);
  assert.equal((await check('two')).allowed, true);
  assert.equal((await check('three')).allowed, true);
  assert.equal((await check('four')).allowed, false);
});

test('successful settlement cannot later be changed to a refund', async () => {
  const { kv, limiter, check } = setup();
  const first = await check('one');
  assert.equal(await limiter.settleReservation({ reservation: first.reservation, refund: false }), true);
  assert.equal(await limiter.settleReservation({ reservation: first.reservation, refund: true }), false);
  assert.equal(await kv.get(first.reservation.keys[1]), 1);
});

test('reservation retries are idempotent but settled nonces cannot buy another call', async () => {
  const { kv, limiter, check } = setup();
  const first = await check('one'); const retry = await check('one');
  assert.deepEqual(retry, first);
  assert.equal(await kv.get(first.reservation.keys[3]), 1);
  await limiter.settleReservation({ reservation: first.reservation, refund: true });
  assert.equal((await check('one')).allowed, false);
  assert.equal(await kv.get(first.reservation.keys[3]), 1);
});

test('a conflicting nonce retry cannot refund an earlier admitted request', async () => {
  const { kv, check } = setup();
  const original = await check('one', 100);
  assert.equal((await check('one', 200)).allowed, false);
  assert.deepEqual(await Promise.all(original.reservation.keys.slice(0, 4).map((key) => kv.get(key))), [1, 1, 100, 1]);
});

test('all-failing input exhausts the independent processing budget without losing allowance', async () => {
  const { kv, limiter, check } = setup();
  let plan;
  for (let i = 0; i < 4; i++) {
    const result = await check(`request-${i}`); assert.equal(result.allowed, true); plan = result.reservation;
    await limiter.settleReservation({ reservation: plan, refund: true });
  }
  const denied = await check('five');
  assert.equal(denied.allowed, false); assert.match(denied.reason, /processing attempt/);
  assert.deepEqual(await Promise.all(plan.keys.slice(0, 4).map((key) => kv.get(key))), [0, 0, 0, 4]);
});

test('concurrent admission never overbooks monthly request or character capacity', async () => {
  const { kv, check } = setup();
  const rows = await Promise.all(Array.from({ length: 20 }, (_, i) => check(`parallel-${i}`, 400)));
  const allowed = rows.filter((row) => row.allowed);
  assert.equal(allowed.length, 2);
  assert.deepEqual(await Promise.all(allowed[0].reservation.keys.slice(0, 4).map((key) => kv.get(key))), [2, 2, 800, 2]);
});

test('refund at a UTC rollover never recreates an expired counter or credits the new bucket', async () => {
  const { kv, limiter, check, advance } = setup();
  advance(Date.UTC(2026, 8, 30, 23, 59, 59));
  const previous = await check('previous', 100);
  advance(Date.UTC(2026, 9, 1, 0, 0, 1));
  const current = await check('current', 200);
  assert.equal(await limiter.settleReservation({ reservation: previous.reservation, refund: true }), true);
  assert.equal(await kv.get(previous.reservation.keys[0]), undefined);
  assert.equal(await kv.get(previous.reservation.keys[1]), undefined);
  assert.deepEqual(await Promise.all(current.reservation.keys.slice(0, 4).map((key) => kv.get(key))), [1, 1, 200, 1]);
});

test('corrupted storage fails closed before partial refunds', async () => {
  const { kv, limiter, check } = setup();
  const result = await check('one'); const plan = result.reservation;
  await kv.set(plan.keys[2], 'corrupt');
  assert.equal(await limiter.settleReservation({ reservation: plan, refund: true }), false);
  assert.equal(await kv.get(plan.keys[0]), 1); assert.equal(await kv.get(plan.keys[1]), 1);
});

test('unknown reservation response is compensated before rejecting the request', async () => {
  const { kv } = setup(); const reserve = kv.reserveQuota.bind(kv);
  let saved;
  kv.reserveQuota = async (plan) => { saved = plan; await reserve(plan); throw new Error('lost acknowledgement'); };
  const limiter = createRateLimiter({ kv, hmacSecret: 'secret' });
  const result = await limiter.check({ tier: 'pro', subject: 'subject', requestId: 'one', chars: 10 });
  assert.equal(result.allowed, false);
  assert.deepEqual(await Promise.all(saved.keys.slice(0, 4).map((key) => kv.get(key))), [0, 0, 0, 1]);
});

test('handler refunds a trusted safety failure before response end and settles once', async () => {
  const { kv, limiter } = setup(); let plan;
  const original = limiter.check.bind(limiter);
  limiter.check = async (input) => { const result = await original(input); plan = result.reservation; return result; };
  const res = { statusCode: 200, setHeader() {}, end() {} };
  const handler = createRewriteHandler({ rateLimiter: limiter,
    licenseValidator: { async validate() { return { ok: true, subject: 'subject', tier: 'pro', status: 'active', cache: 'miss' }; } },
    runRewrite: async ({ beforeResponseEnd }) => {
      await beforeResponseEnd({ ok: false, code: 'number_safety_failed' });
      assert.equal(await kv.get(plan.keys[1]), 0);
      return { ok: false, code: 'number_safety_failed' };
    } });
  await handler({ method: 'POST', headers: { authorization: 'Bearer test-license', 'x-real-ip': '203.0.113.1' }, body: { mode: 'first', tier: 'pro', lang: 'en', text: 'There are 12 updates.' } }, res);
  assert.equal(await kv.get(plan.keys[1]), 0); assert.equal(await kv.get(plan.keys[3]), 1);
});

test('a disconnect during admission does not start a runner or masquerade as a refundable server failure', async () => {
  const { kv, limiter } = setup();
  const req = Object.assign(new EventEmitter(), { method: 'POST', headers: { authorization: 'Bearer test-license', 'x-real-ip': '203.0.113.1' }, body: { mode: 'first', tier: 'pro', lang: 'en', text: 'There are 12 updates.' } });
  const res = Object.assign(new EventEmitter(), { statusCode: 200, setHeader() {}, end() {} });
  const check = limiter.check.bind(limiter); let plan; let ran = false;
  limiter.check = async (input) => { const result = await check(input); plan = result.reservation; req.emit('aborted'); return result; };
  const handler = createRewriteHandler({ rateLimiter: limiter,
    licenseValidator: { async validate() { return { ok: true, subject: 'subject', tier: 'pro', status: 'active', cache: 'miss' }; } },
    runRewrite() { ran = true; return { ok: false, code: 'stream_failed' }; } });
  await handler(req, res);
  assert.equal(ran, false);
  assert.equal(await kv.get(plan.keys[1]), 1);
  assert.equal(req.listenerCount('aborted'), 0); assert.equal(res.listenerCount('close'), 0);
});

test('a trusted synthetic probe outlives the monthly cap and leaves the seat allowance untouched', async () => {
  const { kv, limiter } = setup();
  const customer = await spendMonthlyAllowance(limiter);
  const monthlyKeys = customer.keys.slice(1, 4);
  const spent = await Promise.all(monthlyKeys.map((key) => kv.get(key)));
  assert.deepEqual(spent, [2, 200, 2]);
  const exhausted = await limiter.check({ tier: 'pro', subject: 'subject', chars: 100, requestId: 'customer-3' });
  assert.deepEqual({ allowed: exhausted.allowed, reason: exhausted.reason }, { allowed: false, reason: QUOTA_REASONS.MONTHLY_REQUESTS });

  const plans = [];
  const check = limiter.check.bind(limiter);
  limiter.check = async (input) => { const result = await check(input); if (result.reservation) plans.push(result.reservation); return result; };
  const { handler, runs } = proHandler(limiter);
  const res = capture();
  await handler(proRequest(probeHeaders(OBSERVER_SECRET)), res);

  assert.equal(runs.count, 1, 'the probe is admitted after the seat is exhausted');
  assert.equal(res.body, undefined);
  // An exemption, not a credit: the seat's monthly counters never move.
  assert.deepEqual(await Promise.all(monthlyKeys.map((key) => kv.get(key))), spent);
  // It still ran the real atomic reservation, only against observer-scoped
  // monthly keys; the daily counter stays the seat's own.
  const probe = plans.at(-1);
  assert.equal(probe.keys[0], customer.keys[0]);
  assert.equal(probe.keys.slice(1, 4).some((key) => monthlyKeys.includes(key)), false);
  assert.deepEqual(await Promise.all(probe.keys.slice(1, 4).map((key) => kv.get(key))), [1, undefined, 1]);
  assert.equal(await kv.get(probe.keys[0]), 3);
});

test('only the exact observer marker exempts a probe, and never a request body field', async () => {
  const { limiter } = setup();
  await spendMonthlyAllowance(limiter);
  const attempts = [
    ['no marker', proRequest(probeHeaders())],
    ['marker of equal length', proRequest(probeHeaders('observer-secret-valve'))],
    ['marker of different length', proRequest(probeHeaders('observer'))],
    ['body field', proRequest(probeHeaders(), { synthetic: true })],
    ['body field beside a wrong marker', proRequest(probeHeaders('observer'), { synthetic: true })],
  ];
  for (const [label, request] of attempts) {
    const { handler, runs } = proHandler(limiter);
    const res = capture();
    await handler(request, res);
    assert.equal(runs.count, 0, label);
    assert.equal(res.statusCode, 429, label);
    assert.deepEqual(JSON.parse(res.body), { error: QUOTA_REASONS.MONTHLY_REQUESTS }, label);
  }
});

test('the probe exemption widens neither the daily cap, the concurrency lease, nor license validation', async () => {
  const daily = setup({ reqPerDay: 1 });
  const first = proHandler(daily.limiter);
  await first.handler(proRequest(probeHeaders(OBSERVER_SECRET)), capture());
  assert.equal(first.runs.count, 1);
  const second = proHandler(daily.limiter);
  const dailyRes = capture();
  await second.handler(proRequest(probeHeaders(OBSERVER_SECRET)), dailyRes);
  assert.equal(second.runs.count, 0);
  assert.equal(dailyRes.statusCode, 429);
  assert.deepEqual(JSON.parse(dailyRes.body), { error: QUOTA_REASONS.DAILY });

  const busy = setup({ maxConcurrent: 1 });
  assert.equal((await busy.limiter.acquireConcurrency({ tier: 'pro', subject: 'subject' })).allowed, true);
  const blocked = proHandler(busy.limiter);
  const blockedRes = capture();
  await blocked.handler(proRequest(probeHeaders(OBSERVER_SECRET)), blockedRes);
  assert.equal(blocked.runs.count, 0);
  assert.equal(blockedRes.statusCode, 429);
  assert.deepEqual(JSON.parse(blockedRes.body), { error: QUOTA_REASONS.CONCURRENT });

  const unlicensed = setup();
  const denied = proHandler(unlicensed.limiter, {
    licenseValidator: { async validate() { return { ok: false, status: 403, reason: QUOTA_REASONS.LICENSE_INVALID }; } },
  });
  const deniedRes = capture();
  await denied.handler(proRequest(probeHeaders(OBSERVER_SECRET)), deniedRes);
  assert.equal(denied.runs.count, 0);
  assert.equal(deniedRes.statusCode, 403);
  assert.deepEqual(JSON.parse(deniedRes.body), { error: QUOTA_REASONS.LICENSE_INVALID });
});

test('asynchronous settlement diagnostics cannot escape the response boundary', async () => {
  const { kv, check } = setup(); const result = await check('one');
  kv.settleQuota = async () => { throw new Error('store unavailable'); };
  const limiter = createRateLimiter({ kv, logger: { async warn() { throw new Error('logger unavailable'); } } });
  assert.equal(await limiter.settleReservation({ reservation: result.reservation, refund: true }), false);
  await new Promise((resolve) => setTimeout(resolve, 0));
});
