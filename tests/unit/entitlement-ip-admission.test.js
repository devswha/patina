// @ts-nocheck
// ---------------------------------------------------------------------------
// Per-client admission for license validation (src/entitlement.js, step 4c).
//
// License validation runs ahead of every per-IP limiter, and each cache-missing
// key — entitled or not — used to charge the ONE shared per-minute budget for
// calls to the license provider. A caller sending a handful of uncached keys a
// minute could therefore drain that budget, and any paying subject whose
// positive cache had lapsed was answered 503 for the rest of the minute.
//
// These tests drive the production wiring rather than a stub: the real
// validator over a shared (non-memory) KV in production posture, the real rate
// limiter, and the real /api/rewrite handler. They pin that
// one caller can spend at most its own slice, that every other caller keeps
// validating, that a cached subject is never charged, and that each fail-closed
// edge (no address in production, a broken meter) denies without calling the
// provider or touching the shared budget.
// ---------------------------------------------------------------------------

import test from 'node:test';
import assert from 'node:assert/strict';

import { createLicenseValidator } from '../../src/entitlement.js';
import { createMemoryKv, createRateLimiter, quotaKeyHmac } from '../../src/rate-limit.js';
import { createRewriteHandler } from '../../src/rewrite-handler.js';
import { QUOTA_REASONS, WEB_TIERS } from '../../src/web-rewrite-contract.js';

const FIXED_NOW = 1_700_000_000_000;
const MINUTE = Math.floor(FIXED_NOW / 60_000);
const SECRET = 'ip-admission-test-secret';
const VALIDATE_URL = 'https://license.test/validate';
/** Any key with this prefix is entitled; anything else is a definitive denial. */
const ENTITLED_PREFIX = 'LK-seat-';
const FLOOD_IP = '198.51.100.7';
const OTHER_IP = '203.0.113.9';

/** Minimal provider descriptor shaped like the Polar one (404 = verdict). */
const TEST_PROVIDER = {
  id: 'test',
  url: () => VALIDATE_URL,
  configured: (env) => Boolean(env.TEST_STORE_ID),
  request: (license) => ({
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ license_key: license }),
  }),
  isDefinitiveDenial: (status, body) => status === 404 && Boolean(body) && body.error === 'ResourceNotFound',
  evaluate: (data) => (data && data.valid === true
    ? { ok: true, status: 'active', expiresAt: null }
    : { ok: false, status: 403, reason: QUOTA_REASONS.LICENSE_INVALID, detail: 'not-valid' }),
  defaultRpm: 10,
};

/**
 * A shared store: the memory KV's behaviour without its `__memory` marker, so
 * production posture accepts it. Records every string key it is handed.
 */
function sharedKv() {
  const inner = createMemoryKv();
  const keys = [];
  const kv = { _keys: keys };
  for (const [name, method] of Object.entries(inner)) {
    if (typeof method !== 'function') continue;
    kv[name] = async (key, ...rest) => {
      if (typeof key === 'string') keys.push(key);
      return method(key, ...rest);
    };
  }
  return kv;
}

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, async json() { return body; } };
}

/** A provider stub that records every license it is asked about. */
function providerFetch(calls) {
  return async (url, options) => {
    const license = JSON.parse(String(options.body)).license_key;
    calls.push(license);
    return license.startsWith(ENTITLED_PREFIX)
      ? jsonResponse(200, { valid: true })
      : jsonResponse(404, { error: 'ResourceNotFound', valid: false });
  };
}

function spyLogger() {
  const entries = [];
  return { _entries: entries, warn: (...args) => entries.push(args), log: (...args) => entries.push(args) };
}

function makeValidator({ kv, fetchImpl, env = {}, now = () => FIXED_NOW, logger = { warn() {} } } = {}) {
  return createLicenseValidator({
    provider: TEST_PROVIDER,
    kv,
    hmacSecret: SECRET,
    env: {
      VERCEL: '1', // production posture: shared KV + secret + client address required
      TEST_STORE_ID: '1',
      PATINA_TEST_VALIDATE_RPM: '10',
      PATINA_TEST_VALIDATE_IP_RPM: '3',
      ...env,
    },
    fetchImpl,
    now,
    logger,
  });
}

/** How many tokens of the SHARED per-minute provider budget were spent. */
async function sharedBudgetSpent(kv, minute = MINUTE) {
  const spent = await kv.get(quotaKeyHmac(SECRET, 'test-rpm', minute));
  return spent === undefined ? 0 : spent;
}

function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    ended: undefined,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(body) { this.ended = body; },
    json() { return this.ended ? JSON.parse(this.ended) : null; },
  };
}

const PRO_ENV = Object.freeze({ VERCEL: '1', PATINA_PRO_PROVIDER: 'openai', PATINA_PRO_MODEL: 'gpt-4.1-mini' });

function makeRewriteHandler({ kv, validator, now = () => FIXED_NOW }) {
  const rateLimiter = createRateLimiter({ kv, hmacSecret: SECRET, env: PRO_ENV, now, logger: { warn() {} } });
  const runs = [];
  const handler = createRewriteHandler({
    rateLimiter,
    licenseValidator: validator,
    env: PRO_ENV,
    now,
    logger: { error() {} },
    runRewrite(args) {
      runs.push(args.request.tier);
      args.res.statusCode = 200;
      args.res.end(JSON.stringify({ ok: true }));
      return { ok: true };
    },
  });
  return { handler, runs };
}

function proRequest({ license, ip }) {
  return {
    method: 'POST',
    headers: { 'x-vercel-forwarded-for': ip, authorization: `Bearer ${license}` },
    rawHeaders: ['x-vercel-forwarded-for', ip, 'authorization', `Bearer ${license}`],
    body: { mode: 'first', lang: 'en', tier: WEB_TIERS.PRO, text: 'Rewrite this sentence.' },
  };
}

// ---------------------------------------------------------------------------
// /api/rewrite, end to end
// ---------------------------------------------------------------------------

test('rewrite: one caller cannot spend the shared provider budget on uncached keys', async () => {
  const kv = sharedKv();
  const calls = [];
  const logger = spyLogger();
  const validator = makeValidator({ kv, fetchImpl: providerFetch(calls), logger });
  const { handler, runs } = makeRewriteHandler({ kv, validator });

  // An entitled seat behind the SAME address, validated and now warm in cache.
  const warm = makeRes();
  await handler(proRequest({ license: `${ENTITLED_PREFIX}warm`, ip: FLOOD_IP }), warm);
  assert.equal(warm.statusCode, 200);
  assert.equal(calls.length, 1);

  // Six never-seen keys from that one address, all inside the same minute.
  const answers = [];
  for (let index = 0; index < 6; index += 1) {
    const res = makeRes();
    await handler(proRequest({ license: `LK-unknown-${index}`, ip: FLOOD_IP }), res);
    answers.push([res.statusCode, res.json().error]);
  }

  // The slice is 3 provider calls per minute per caller and the warm seat spent
  // one of them, so only two of the six keys ever reach the provider.
  assert.equal(calls.length, 3, `provider calls: ${calls.join(', ')}`);
  assert.equal(await sharedBudgetSpent(kv), 3, 'the shared budget is charged only where the slice allowed a call');
  assert.deepEqual(answers.map(([status]) => status), [403, 403, 429, 429, 429, 429]);
  assert.deepEqual(answers.slice(2).map(([, error]) => error), Array(4).fill(QUOTA_REASONS.LICENSE_VALIDATION_BURST));
  assert.deepEqual(runs, [WEB_TIERS.PRO], 'a denied request never reaches the runner');

  // A DIFFERENT caller's entitled seat still validates in that same minute.
  const otherSeat = makeRes();
  await handler(proRequest({ license: `${ENTITLED_PREFIX}other`, ip: OTHER_IP }), otherSeat);
  assert.equal(otherSeat.statusCode, 200);
  assert.equal(calls.length, 4);
  assert.equal(await sharedBudgetSpent(kv), 4);

  // The warm seat behind the throttled address is still served: a cache hit is
  // never charged against the slice, so an already-validated customer cannot be
  // locked out by traffic sharing its address.
  const warmAgain = makeRes();
  await handler(proRequest({ license: `${ENTITLED_PREFIX}warm`, ip: FLOOD_IP }), warmAgain);
  assert.equal(warmAgain.statusCode, 200);
  assert.equal(calls.length, 4, 'a cache hit calls neither the provider nor the meters');
  assert.equal(await sharedBudgetSpent(kv), 4);

  // Neither the address nor a license is ever stored or logged raw.
  const stored = kv._keys.join('|');
  assert.ok(!stored.includes(FLOOD_IP) && !stored.includes(OTHER_IP), 'KV keys must never carry a raw address');
  assert.ok(!stored.includes(ENTITLED_PREFIX), 'KV keys must never carry a raw license');
  const logged = JSON.stringify(logger._entries);
  assert.ok(!logged.includes(FLOOD_IP) && !logged.includes(ENTITLED_PREFIX), 'logs must never carry a raw address or license');
});

test('rewrite: a throttled caller is refused with a quota verdict, not a license verdict', async () => {
  let clock = FIXED_NOW;
  const kv = sharedKv();
  const calls = [];
  const validator = makeValidator({
    kv,
    fetchImpl: providerFetch(calls),
    // One provider call per minute per caller, and a denial that outlives the
    // minute so the negative cache and the slice can be told apart below.
    env: { PATINA_TEST_VALIDATE_IP_RPM: '1', PATINA_TEST_NEGATIVE_CACHE_TTL_MS: '300000' },
    now: () => clock,
  });
  const { handler } = makeRewriteHandler({ kv, validator, now: () => clock });

  const first = makeRes();
  await handler(proRequest({ license: 'LK-unknown-a', ip: FLOOD_IP }), first);
  assert.equal(first.statusCode, 403, 'the provider answered: this key is not entitled');

  const throttled = makeRes();
  await handler(proRequest({ license: `${ENTITLED_PREFIX}late`, ip: FLOOD_IP }), throttled);
  assert.equal(throttled.statusCode, 429);
  assert.equal(throttled.json().error, QUOTA_REASONS.LICENSE_VALIDATION_BURST);
  assert.equal(calls.length, 1);

  // Next minute the slice is fresh: the throttled key is validated for the first
  // time (it was never cached as invalid), while the key the provider actually
  // denied is still served from its negative cache without a second call.
  clock += 60_000;
  const retried = makeRes();
  await handler(proRequest({ license: `${ENTITLED_PREFIX}late`, ip: FLOOD_IP }), retried);
  assert.equal(retried.statusCode, 200);
  assert.deepEqual(calls, ['LK-unknown-a', `${ENTITLED_PREFIX}late`]);

  const stillDenied = makeRes();
  await handler(proRequest({ license: 'LK-unknown-a', ip: FLOOD_IP }), stillDenied);
  assert.equal(stillDenied.statusCode, 403);
  assert.equal(calls.length, 2);
  assert.equal(await sharedBudgetSpent(kv, Math.floor(clock / 60_000)), 1, 'only the fresh validation charged the shared budget');
});

// ---------------------------------------------------------------------------
// Fail-closed edges of the admission slice
// ---------------------------------------------------------------------------

test('admission: production denies a validation it cannot admit per caller', async () => {
  const kv = sharedKv();
  const calls = [];
  const validator = makeValidator({ kv, fetchImpl: providerFetch(calls) });

  for (const ip of [undefined, null, '']) {
    assert.deepEqual(await validator.validate({ licenseKey: `${ENTITLED_PREFIX}no-ip`, ip }), {
      ok: false, status: 400, reason: QUOTA_REASONS.IP_UNAVAILABLE,
    });
  }
  assert.equal(calls.length, 0, 'the provider is never called for an unadmitted request');
  assert.equal(await sharedBudgetSpent(kv), 0, 'the shared budget is never charged for an unadmitted request');

  // Outside production there is no shared budget worth defending and a local
  // caller legitimately has no forwarded address, so validation continues.
  const localKv = sharedKv();
  const localCalls = [];
  const local = makeValidator({ kv: localKv, fetchImpl: providerFetch(localCalls), env: { VERCEL: undefined } });
  assert.equal((await local.validate({ licenseKey: `${ENTITLED_PREFIX}local` })).ok, true);
  assert.equal(localCalls.length, 1);
});

test('admission: a broken per-caller meter fails closed before the shared budget', async () => {
  const kv = sharedKv();
  const ipKey = quotaKeyHmac(SECRET, 'test-validate-ip-rpm', MINUTE, FLOOD_IP);
  const inner = kv.incr;
  kv.incr = async (key, options) => {
    if (key === ipKey) throw new Error('kv incr exploded');
    return inner(key, options);
  };
  const calls = [];
  const validator = makeValidator({ kv, fetchImpl: providerFetch(calls) });

  assert.deepEqual(await validator.validate({ licenseKey: `${ENTITLED_PREFIX}meter`, ip: FLOOD_IP }), {
    ok: false, status: 503, reason: QUOTA_REASONS.LICENSE_UNAVAILABLE,
  });
  assert.equal(calls.length, 0);
  assert.equal(await sharedBudgetSpent(kv), 0);

  // A degraded counter value is storage failure too, never an admission signal.
  kv.incr = async (key) => (key === ipKey ? Number.NaN : 1);
  assert.equal((await validator.validate({ licenseKey: `${ENTITLED_PREFIX}nan`, ip: FLOOD_IP })).status, 503);
  assert.equal(calls.length, 0);
});

test('admission: the slice is charged per caller, so callers cannot exhaust each other', async () => {
  const kv = sharedKv();
  const calls = [];
  const validator = makeValidator({ kv, fetchImpl: providerFetch(calls), env: { PATINA_TEST_VALIDATE_IP_RPM: '2' } });

  for (let index = 0; index < 4; index += 1) {
    await validator.validate({ licenseKey: `LK-unknown-a-${index}`, ip: FLOOD_IP });
  }
  for (let index = 0; index < 4; index += 1) {
    await validator.validate({ licenseKey: `LK-unknown-b-${index}`, ip: OTHER_IP });
  }
  assert.equal(calls.length, 4, 'each address spent its own slice and nothing more');
  assert.equal(await sharedBudgetSpent(kv), 4);
});
