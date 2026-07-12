import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createLemonSqueezyLicenseValidator,
  evaluateLicenseResponse,
  extractBearerLicense,
  LS_LICENSE_VALIDATE_URL,
} from '../../src/entitlement.js';
import { createMemoryKv, quotaKeyHmac } from '../../src/rate-limit.js';
import { QUOTA_REASONS } from '../../src/web-rewrite-contract.js';

// ---------------------------------------------------------------------------
// Test fixtures / helpers
// ---------------------------------------------------------------------------

const FIXED_NOW = 1_700_000_000_000;
const SECRET = 'unit-test-license-secret';
const HEX64 = /^[a-f0-9]{64}$/;

const GOOD_META = Object.freeze({ store_id: 55555, variant_id: 98765, product_id: 4242 });

function baseEnv(overrides = {}) {
  return { LS_STORE_ID: '55555', LS_PRO_VARIANT_ID: '98765', ...overrides };
}

function futureIso(offsetMs = 3_600_000) {
  return new Date(FIXED_NOW + offsetMs).toISOString();
}

function pastIso(offsetMs = 3_600_000) {
  return new Date(FIXED_NOW - offsetMs).toISOString();
}

/** A well-formed, entitled LS validate body; override any slice. */
function okBody(over = {}) {
  return {
    valid: over.valid !== undefined ? over.valid : true,
    error: null,
    license_key: { status: 'active', expires_at: null, ...(over.license_key || {}) },
    meta: { ...GOOD_META, ...(over.meta || {}) },
  };
}

/** A fake `fetch` Response. */
function lsResponse(body, { status = 200, ok, throwJson = false } = {}) {
  return {
    ok: ok === undefined ? status >= 200 && status < 300 : ok,
    status,
    async json() {
      if (throwJson) throw new Error('Unexpected end of JSON input');
      return body;
    },
  };
}

/** A fetch spy that records every call and delegates to `responder`. */
function spyFetch(responder) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    return responder(url, opts, calls.length);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

/** A KV that records every key it sees plus every value it stores. */
function spyKv() {
  const inner = createMemoryKv();
  const keys = [];
  const values = [];
  return {
    __memory: true,
    _keys: keys,
    _values: values,
    async get(key) { keys.push(key); return inner.get(key); },
    async set(key, val, opts) { keys.push(key); values.push(val); return inner.set(key, val, opts); },
    async incr(key, opts) { keys.push(key); return inner.incr(key, opts); },
    async decr(key) { keys.push(key); return inner.decr(key); },
  };
}

/** A logger that captures every (redacted) payload it is handed. */
function spyLogger() {
  const entries = [];
  return {
    _entries: entries,
    warn: (...args) => entries.push(args),
    log: (...args) => entries.push(args),
  };
}

function makeValidator({ kv, env, fetchImpl, logger, hmacSecret = SECRET, now = () => FIXED_NOW } = {}) {
  return createLemonSqueezyLicenseValidator({
    kv: kv === undefined ? createMemoryKv() : kv,
    hmacSecret,
    env: env || baseEnv(),
    fetchImpl,
    now,
    logger,
  });
}

// ---------------------------------------------------------------------------
// extractBearerLicense
// ---------------------------------------------------------------------------

test('extractBearerLicense: parses exactly one Bearer token', () => {
  assert.deepEqual(extractBearerLicense({ authorization: 'Bearer LK-123-abc' }), { ok: true, license: 'LK-123-abc' });
  // surrounding whitespace and multi-space separators are tolerated
  assert.deepEqual(extractBearerLicense({ authorization: '  Bearer\tLK-tab  ' }), { ok: true, license: 'LK-tab' });
  // single-element array is one value
  assert.deepEqual(extractBearerLicense({ authorization: ['Bearer LK-solo'] }), { ok: true, license: 'LK-solo' });
});

test('extractBearerLicense: header name and scheme are case-insensitive', () => {
  assert.deepEqual(extractBearerLicense({ Authorization: 'Bearer LK-cap' }), { ok: true, license: 'LK-cap' });
  assert.deepEqual(extractBearerLicense({ AUTHORIZATION: 'Bearer LK-upper' }), { ok: true, license: 'LK-upper' });
  assert.deepEqual(extractBearerLicense({ authorization: 'bearer LK-lower-scheme' }), { ok: true, license: 'LK-lower-scheme' });
});

test('extractBearerLicense: missing / blank / non-Bearer / empty / multiple all fail closed with 401', () => {
  const denied = { ok: false, status: 401, reason: QUOTA_REASONS.LICENSE_REQUIRED };
  assert.deepEqual(extractBearerLicense({}), denied); // none
  assert.deepEqual(extractBearerLicense(undefined), denied); // no headers
  assert.deepEqual(extractBearerLicense(null), denied);
  assert.deepEqual(extractBearerLicense({ authorization: '   ' }), denied); // whitespace only
  assert.deepEqual(extractBearerLicense({ authorization: 'Basic abc123def' }), denied); // non-Bearer
  assert.deepEqual(extractBearerLicense({ authorization: 'Token abc123def' }), denied); // non-Bearer
  assert.deepEqual(extractBearerLicense({ authorization: 'Bearer' }), denied); // empty (no token)
  assert.deepEqual(extractBearerLicense({ authorization: 'Bearer    ' }), denied); // empty (trailing space)
  assert.deepEqual(extractBearerLicense({ authorization: 'Bearer a b' }), denied); // more than one token
  assert.deepEqual(extractBearerLicense({ authorization: ['Bearer a', 'Bearer b'] }), denied); // multiple values (array)
  assert.deepEqual(extractBearerLicense({ authorization: 'Bearer x', Authorization: 'Bearer y' }), denied); // multiple values (keys)
});

// ---------------------------------------------------------------------------
// evaluateLicenseResponse (pure)
// ---------------------------------------------------------------------------

test('evaluateLicenseResponse: entitled active/inactive keys pass', () => {
  const active = evaluateLicenseResponse(okBody(), baseEnv(), FIXED_NOW);
  assert.equal(active.ok, true);
  assert.equal(active.status, 'active');
  assert.equal(active.expiresAt, null);

  const inactive = evaluateLicenseResponse(okBody({ license_key: { status: 'inactive' } }), baseEnv(), FIXED_NOW);
  assert.equal(inactive.ok, true);
  assert.equal(inactive.status, 'inactive');

  const future = evaluateLicenseResponse(okBody({ license_key: { status: 'active', expires_at: futureIso() } }), baseEnv(), FIXED_NOW);
  assert.equal(future.ok, true);
  assert.equal(future.expiresAt, Date.parse(futureIso()));
});

test('evaluateLicenseResponse: every failed check returns a generic 403 LICENSE_INVALID', () => {
  const env = baseEnv();
  const cases = {
    'valid:false': okBody({ valid: false }),
    'expired status': okBody({ license_key: { status: 'expired' } }),
    'disabled status': okBody({ license_key: { status: 'disabled' } }),
    'unknown status': okBody({ license_key: { status: 'pending' } }),
    'expired timestamp': okBody({ license_key: { status: 'active', expires_at: pastIso() } }),
    'unparseable timestamp': okBody({ license_key: { status: 'active', expires_at: 'not-a-date' } }),
    'store mismatch': okBody({ meta: { store_id: 1 } }),
    'variant mismatch': okBody({ meta: { variant_id: 1 } }),
    'malformed body': null,
    'missing license_key': { valid: true, meta: GOOD_META },
    'missing meta': { valid: true, license_key: { status: 'active' } },
  };
  for (const [label, body] of Object.entries(cases)) {
    const res = evaluateLicenseResponse(body, env, FIXED_NOW);
    assert.equal(res.ok, false, label);
    assert.equal(res.status, 403, label);
    assert.equal(res.reason, QUOTA_REASONS.LICENSE_INVALID, label);
  }
});

test('evaluateLicenseResponse: product id is only enforced when configured', () => {
  const body = okBody({ meta: { product_id: 4242 } });
  // not configured -> product ignored -> pass
  assert.equal(evaluateLicenseResponse(body, baseEnv(), FIXED_NOW).ok, true);
  // configured + matching -> pass
  assert.equal(evaluateLicenseResponse(body, baseEnv({ LS_PRO_PRODUCT_ID: '4242' }), FIXED_NOW).ok, true);
  // configured + mismatching -> 403
  const mismatch = evaluateLicenseResponse(body, baseEnv({ LS_PRO_PRODUCT_ID: '9999' }), FIXED_NOW);
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.status, 403);
  assert.equal(mismatch.reason, QUOTA_REASONS.LICENSE_INVALID);
});

// ---------------------------------------------------------------------------
// Exported constant
// ---------------------------------------------------------------------------

test('LS_LICENSE_VALIDATE_URL points at the validate-only endpoint', () => {
  assert.equal(LS_LICENSE_VALIDATE_URL, 'https://api.lemonsqueezy.com/v1/licenses/validate');
});

// ---------------------------------------------------------------------------
// validate: happy path + caching
// ---------------------------------------------------------------------------

test('validate: entitled license passes on miss, then serves from cache without re-fetching', async () => {
  const fetchImpl = spyFetch(() => lsResponse(okBody()));
  const validator = makeValidator({ fetchImpl });

  const first = await validator.validate({ licenseKey: 'LK-active-0001' });
  assert.equal(first.ok, true);
  assert.equal(first.tier, 'pro');
  assert.equal(first.status, 'active');
  assert.equal(first.cache, 'miss');
  assert.match(first.subject, HEX64);
  assert.equal(fetchImpl.calls.length, 1);

  const second = await validator.validate({ licenseKey: 'LK-active-0001' });
  assert.equal(second.ok, true);
  assert.equal(second.cache, 'hit');
  assert.equal(second.subject, first.subject);
  assert.equal(fetchImpl.calls.length, 1, 'cache hit must not call LS again');
});

test('validate: LS request uses the validate-only endpoint, POST form body, and correct headers', async () => {
  const fetchImpl = spyFetch(() => lsResponse(okBody()));
  const validator = makeValidator({ fetchImpl });

  await validator.validate({ licenseKey: 'LK-shape-0001' });
  const { url, opts } = fetchImpl.calls[0];
  assert.equal(url, LS_LICENSE_VALIDATE_URL);
  assert.equal(opts.method, 'POST');
  assert.equal(opts.headers.Accept, 'application/json');
  assert.equal(opts.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(opts.body, 'license_key=LK-shape-0001');
  assert.ok(opts.signal, 'AbortSignal must be wired for the timeout');
});

test('validate: inactive-but-issued license still entitles (validate-only, not activation)', async () => {
  const fetchImpl = spyFetch(() => lsResponse(okBody({ license_key: { status: 'inactive' } })));
  const validator = makeValidator({ fetchImpl });
  const res = await validator.validate({ licenseKey: 'LK-inactive-0001' });
  assert.equal(res.ok, true);
  assert.equal(res.status, 'inactive');
  assert.equal(res.cache, 'miss');
});

test('validate: negative decisions resolve to 403 LICENSE_INVALID and are cached', async () => {
  const cases = {
    'expired status': okBody({ license_key: { status: 'expired' } }),
    'disabled status': okBody({ license_key: { status: 'disabled' } }),
    'expired timestamp': okBody({ license_key: { status: 'active', expires_at: pastIso() } }),
    'store mismatch': okBody({ meta: { store_id: 999 } }),
    'variant mismatch': okBody({ meta: { variant_id: 111 } }),
    'valid:false': okBody({ valid: false }),
  };
  for (const [label, body] of Object.entries(cases)) {
    const fetchImpl = spyFetch(() => lsResponse(body));
    const validator = makeValidator({ fetchImpl });
    const res = await validator.validate({ licenseKey: `LK-deny-${label.replace(/\s+/g, '-')}` });
    assert.equal(res.ok, false, label);
    assert.equal(res.status, 403, label);
    assert.equal(res.reason, QUOTA_REASONS.LICENSE_INVALID, label);
    // negative cache: a repeat is served without a second LS call
    const again = await validator.validate({ licenseKey: `LK-deny-${label.replace(/\s+/g, '-')}` });
    assert.equal(again.status, 403, `${label} (cached)`);
    assert.equal(fetchImpl.calls.length, 1, `${label}: negative result must be cached`);
  }
});

test('validate: product mismatch is rejected only when LS_PRO_PRODUCT_ID is configured', async () => {
  const body = okBody({ meta: { product_id: 4242 } });

  const mismatchFetch = spyFetch(() => lsResponse(body));
  const mismatch = makeValidator({ env: baseEnv({ LS_PRO_PRODUCT_ID: '9999' }), fetchImpl: mismatchFetch });
  const rejected = await mismatch.validate({ licenseKey: 'LK-prod-mismatch' });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.status, 403);

  const matchFetch = spyFetch(() => lsResponse(body));
  const match = makeValidator({ env: baseEnv({ LS_PRO_PRODUCT_ID: '4242' }), fetchImpl: matchFetch });
  assert.equal((await match.validate({ licenseKey: 'LK-prod-match' })).ok, true);
});

test('validate: a positive cache entry expires and re-validates against LS', async () => {
  let clock = FIXED_NOW;
  const fetchImpl = spyFetch(() => lsResponse(okBody()));
  const validator = makeValidator({ fetchImpl, env: baseEnv({ PATINA_LS_CACHE_TTL_MS: '1000' }), now: () => clock });

  assert.equal((await validator.validate({ licenseKey: 'LK-ttl' })).cache, 'miss');
  clock += 500; // still within TTL
  assert.equal((await validator.validate({ licenseKey: 'LK-ttl' })).cache, 'hit');
  clock += 600; // now past the 1000ms TTL (embedded expiresAt is authoritative)
  assert.equal((await validator.validate({ licenseKey: 'LK-ttl' })).cache, 'miss');
  assert.equal(fetchImpl.calls.length, 2);
});

// ---------------------------------------------------------------------------
// validate: fail-closed prerequisites
// ---------------------------------------------------------------------------

test('validate: missing store/variant config fails closed with 503 and never fetches', async () => {
  const fetchImpl = spyFetch(() => { throw new Error('must not fetch'); });
  const noStore = makeValidator({ env: { LS_PRO_VARIANT_ID: '98765' }, fetchImpl });
  assert.deepEqual(await noStore.validate({ licenseKey: 'LK-noconfig' }), {
    ok: false, status: 503, reason: QUOTA_REASONS.LICENSE_UNAVAILABLE,
  });

  const noVariant = makeValidator({ env: { LS_STORE_ID: '55555' }, fetchImpl });
  assert.equal((await noVariant.validate({ licenseKey: 'LK-noconfig' })).status, 503);
  assert.equal(fetchImpl.calls.length, 0);
});

test('validate: production requires a real secret and a shared (non-memory) KV', async () => {
  const prodEnv = { NODE_ENV: 'production', LS_STORE_ID: '55555', LS_PRO_VARIANT_ID: '98765' };
  const realKv = { async get() { return undefined; }, async set() {}, async incr() { return 1; } };
  const fetchImpl = spyFetch(() => { throw new Error('must not fetch under prod guard'); });
  const denied = { ok: false, status: 503, reason: QUOTA_REASONS.LICENSE_UNAVAILABLE };

  const noSecret = createLemonSqueezyLicenseValidator({ kv: realKv, env: prodEnv, fetchImpl, now: () => FIXED_NOW });
  assert.deepEqual(await noSecret.validate({ licenseKey: 'LK-prod' }), denied);

  const noKv = createLemonSqueezyLicenseValidator({ kv: null, hmacSecret: SECRET, env: prodEnv, fetchImpl, now: () => FIXED_NOW });
  assert.deepEqual(await noKv.validate({ licenseKey: 'LK-prod' }), denied);

  const memoryKv = createLemonSqueezyLicenseValidator({ kv: createMemoryKv(), hmacSecret: SECRET, env: prodEnv, fetchImpl, now: () => FIXED_NOW });
  assert.deepEqual(await memoryKv.validate({ licenseKey: 'LK-prod' }), denied);

  assert.equal(fetchImpl.calls.length, 0);
});

test('validate: a missing/blank license key is a 401 LICENSE_REQUIRED', async () => {
  const fetchImpl = spyFetch(() => { throw new Error('must not fetch'); });
  const validator = makeValidator({ fetchImpl });
  assert.deepEqual(await validator.validate({ licenseKey: '' }), { ok: false, status: 401, reason: QUOTA_REASONS.LICENSE_REQUIRED });
  assert.deepEqual(await validator.validate({ licenseKey: '   ' }), { ok: false, status: 401, reason: QUOTA_REASONS.LICENSE_REQUIRED });
  assert.deepEqual(await validator.validate({}), { ok: false, status: 401, reason: QUOTA_REASONS.LICENSE_REQUIRED });
  assert.equal(fetchImpl.calls.length, 0);
});

// ---------------------------------------------------------------------------
// validate: LS transport failures -> 503, never cached
// ---------------------------------------------------------------------------

test('validate: LS timeout fails closed with 503 after exactly one fetch', async () => {
  const fetchImpl = spyFetch((_url, opts) => new Promise((_resolve, reject) => {
    opts.signal.addEventListener('abort', () => reject(new Error('The operation was aborted')));
  }));
  const validator = makeValidator({ fetchImpl, env: baseEnv({ PATINA_LS_TIMEOUT_MS: '15' }) });
  const res = await validator.validate({ licenseKey: 'LK-timeout' });
  assert.equal(res.ok, false);
  assert.equal(res.status, 503);
  assert.equal(res.reason, QUOTA_REASONS.LICENSE_UNAVAILABLE);
  assert.equal(fetchImpl.calls.length, 1);
});

test('validate: LS network exception fails closed with 503', async () => {
  const fetchImpl = spyFetch(() => { throw new Error('ECONNREFUSED'); });
  const validator = makeValidator({ fetchImpl });
  const res = await validator.validate({ licenseKey: 'LK-throw' });
  assert.equal(res.status, 503);
  assert.equal(res.reason, QUOTA_REASONS.LICENSE_UNAVAILABLE);
  assert.equal(fetchImpl.calls.length, 1);
});

test('validate: LS non-2xx fails closed with 503', async () => {
  const fetchImpl = spyFetch(() => lsResponse({ error: 'rate limited' }, { status: 429 }));
  const validator = makeValidator({ fetchImpl });
  const res = await validator.validate({ licenseKey: 'LK-500' });
  assert.equal(res.status, 503);
  assert.equal(res.reason, QUOTA_REASONS.LICENSE_UNAVAILABLE);
  assert.equal(fetchImpl.calls.length, 1);
});

test('validate: LS 4xx with a valid:false body is a definitive 403 denial and is negative-cached', async () => {
  // LS answers an unknown key with 404 + {"valid": false, "error": "license_key not found."}
  const fetchImpl = spyFetch(() => lsResponse({ valid: false, error: 'license_key not found.' }, { status: 404 }));
  const validator = makeValidator({ fetchImpl });

  const res = await validator.validate({ licenseKey: 'LK-unknown-key' });
  assert.equal(res.ok, false);
  assert.equal(res.status, 403, 'an invalid key is a license verdict, not an availability failure');
  assert.equal(res.reason, QUOTA_REASONS.LICENSE_INVALID);

  const retry = await validator.validate({ licenseKey: 'LK-unknown-key' });
  assert.equal(retry.status, 403);
  assert.equal(fetchImpl.calls.length, 1, 'the verdict must be negative-cached; retries must not re-charge the RPM bucket');
});

test('validate: LS 429 / 5xx / opaque 4xx stay transient 503 and are never cached', async () => {
  const responders = [
    ['429 rate limit', () => lsResponse({ valid: false, error: 'rate limited' }, { status: 429 })],
    ['500 outage', () => lsResponse({ valid: false }, { status: 500 })],
    ['404 unparseable body', () => lsResponse(null, { status: 404, throwJson: true })],
    ['400 without valid:false', () => lsResponse({ error: 'bad request' }, { status: 400 })],
  ];
  for (const [label, respond] of responders) {
    const fetchImpl = spyFetch(respond);
    const validator = makeValidator({ fetchImpl });
    const res = await validator.validate({ licenseKey: 'LK-transient' });
    assert.equal(res.status, 503, `${label}: must fail closed as unavailable`);
    assert.equal(res.reason, QUOTA_REASONS.LICENSE_UNAVAILABLE, label);
    await validator.validate({ licenseKey: 'LK-transient' });
    assert.equal(fetchImpl.calls.length, 2, `${label}: a transient failure must not be cached`);
  }
});

test('validate: LS malformed JSON fails closed with 503', async () => {
  const fetchImpl = spyFetch(() => lsResponse(null, { status: 200, throwJson: true }));
  const validator = makeValidator({ fetchImpl });
  const res = await validator.validate({ licenseKey: 'LK-badjson' });
  assert.equal(res.status, 503);
  assert.equal(res.reason, QUOTA_REASONS.LICENSE_UNAVAILABLE);
  assert.equal(fetchImpl.calls.length, 1);
});

test('validate: a transient 503 is not cached and re-attempts on retry', async () => {
  let attempt = 0;
  const fetchImpl = spyFetch(() => {
    attempt += 1;
    if (attempt === 1) throw new Error('transient outage');
    return lsResponse(okBody());
  });
  const validator = makeValidator({ fetchImpl });
  assert.equal((await validator.validate({ licenseKey: 'LK-retry' })).status, 503);
  const retry = await validator.validate({ licenseKey: 'LK-retry' });
  assert.equal(retry.ok, true, 'a 503 must not be cached; the retry re-validates');
  assert.equal(fetchImpl.calls.length, 2);
});

// ---------------------------------------------------------------------------
// validate: admission guard
// ---------------------------------------------------------------------------

test('admission: exceeding the per-minute RPM bucket denies without calling LS', async () => {
  const fetchImpl = spyFetch(() => lsResponse(okBody()));
  const validator = makeValidator({ fetchImpl, env: baseEnv({ PATINA_LS_VALIDATE_RPM: '2' }) });

  // Distinct licenses -> each is a fresh miss that consumes one shared per-minute token.
  assert.equal((await validator.validate({ licenseKey: 'LK-rpm-a' })).ok, true); // count 1
  assert.equal((await validator.validate({ licenseKey: 'LK-rpm-b' })).ok, true); // count 2
  const third = await validator.validate({ licenseKey: 'LK-rpm-c' }); // count 3 > 2
  assert.equal(third.ok, false);
  assert.equal(third.status, 503);
  assert.equal(third.reason, QUOTA_REASONS.LICENSE_UNAVAILABLE);
  assert.equal(fetchImpl.calls.length, 2, 'the saturating call must not reach LS');
});

test('admission: the RPM bucket resets in a new minute', async () => {
  let clock = FIXED_NOW;
  const fetchImpl = spyFetch(() => lsResponse(okBody()));
  const validator = makeValidator({ fetchImpl, env: baseEnv({ PATINA_LS_VALIDATE_RPM: '1' }), now: () => clock });

  assert.equal((await validator.validate({ licenseKey: 'LK-min-a' })).ok, true);
  assert.equal((await validator.validate({ licenseKey: 'LK-min-b' })).status, 503); // same minute, over budget
  clock += 60_000; // next minute -> fresh bucket
  assert.equal((await validator.validate({ licenseKey: 'LK-min-c' })).ok, true);
  assert.equal(fetchImpl.calls.length, 2);
});

test('admission: a held single-flight lock polls the cache, then denies without calling LS', async () => {
  const kv = createMemoryKv();
  const license = 'LK-lock-0001';
  const fetchImpl = spyFetch(() => lsResponse(okBody()));
  // Small poll budget so the bounded follower wait doesn't slow the suite.
  const validator = makeValidator({
    kv,
    fetchImpl,
    env: baseEnv({ PATINA_LS_LOCK_POLL_INTERVAL_MS: '2', PATINA_LS_LOCK_WAIT_MS: '10' }),
  });

  // Simulate another instance mid-validation by pre-incrementing the shared lock
  // key — and never writing the cache (a crashed/stuck winner). The follower
  // polls its bounded budget, then still fails CLOSED without touching LS.
  const lockKey = quotaKeyHmac(SECRET, 'ls-lock', license);
  await kv.incr(lockKey, { ttlMs: 10_000 }); // -> 1; the validator's incr then returns 2 (>1)

  const res = await validator.validate({ licenseKey: license });
  assert.equal(res.ok, false);
  assert.equal(res.status, 503);
  assert.equal(res.reason, QUOTA_REASONS.LICENSE_UNAVAILABLE);
  assert.equal(fetchImpl.calls.length, 0);
});

test('admission: a follower is served from the cache the winner writes mid-poll (no 503, no LS re-call)', async () => {
  const kv = createMemoryKv();
  const license = 'LK-lock-0002';
  const fetchImpl = spyFetch(() => lsResponse(okBody()));
  const validator = makeValidator({
    kv,
    fetchImpl,
    env: baseEnv({ PATINA_LS_LOCK_POLL_INTERVAL_MS: '2' }),
  });

  // Another instance holds the lock…
  const lockKey = quotaKeyHmac(SECRET, 'ls-lock', license);
  await kv.incr(lockKey, { ttlMs: 10_000 });
  // …and finishes validating while the follower is polling.
  const cacheKey = quotaKeyHmac(SECRET, 'ls-license-cache', license);
  setTimeout(() => {
    void kv.set(cacheKey, { decision: 'allow', tier: 'pro', status: 'active', expiresAt: FIXED_NOW + 60_000 }, { ttlMs: 60_000 });
  }, 4);

  const res = await validator.validate({ licenseKey: license });
  assert.equal(res.ok, true, 'the follower must pick up the winner-written cache');
  assert.equal(res.cache, 'hit');
  assert.equal(fetchImpl.calls.length, 0, 'the follower must never call LS itself');
});

test('admission: concurrent misses for one license call LS exactly once (single-flight)', async () => {
  const fetchImpl = spyFetch(() => lsResponse(okBody()));
  const validator = makeValidator({
    fetchImpl,
    env: baseEnv({ PATINA_LS_LOCK_POLL_INTERVAL_MS: '2' }),
  });
  const license = 'LK-concurrent-0001';

  const results = await Promise.all([
    validator.validate({ licenseKey: license }),
    validator.validate({ licenseKey: license }),
    validator.validate({ licenseKey: license }),
    validator.validate({ licenseKey: license }),
    validator.validate({ licenseKey: license }),
  ]);

  // #606: the first concurrent burst for an uncached license must NOT 503 the
  // followers — they poll into the cache the winner writes.
  assert.equal(fetchImpl.calls.length, 1, 'exactly one instance may call LS');
  assert.equal(results.filter((r) => r.ok).length, 5, 'winner and followers all succeed');
  assert.equal(results.filter((r) => r.ok && r.cache === 'miss').length, 1, 'exactly one winner validated against LS');
  assert.equal(results.filter((r) => r.ok && r.cache === 'hit').length, 4, 'followers are served from the winner-written cache');
});

// ---------------------------------------------------------------------------
// Security: the raw license never leaks
// ---------------------------------------------------------------------------

test('security: the raw license never appears in return values, KV keys, cached values, or logs', async () => {
  const kv = spyKv();
  const logger = spyLogger();
  const license = 'LK-SECRET-9f8e7d6c-DEADBEEFCAFE';
  // LS echoes the key back inside the (secret-named) license_key object.
  const fetchImpl = spyFetch(() => lsResponse(okBody({ license_key: { status: 'active', expires_at: null, key: license } })));
  const validator = makeValidator({ kv, logger, fetchImpl });

  const res = await validator.validate({ licenseKey: license });
  assert.equal(res.ok, true);

  // (a) return value carries only the HMAC subject
  assert.equal(JSON.stringify(res).includes(license), false);
  assert.match(res.subject, HEX64);

  // (b) every KV key is an HMAC hex digest, never the raw license
  assert.ok(kv._keys.length > 0);
  for (const key of kv._keys) {
    assert.match(key, HEX64, `KV key is not an HMAC digest: ${key}`);
    assert.equal(key.includes(license), false);
  }

  // (c) cached values carry no raw license
  assert.equal(JSON.stringify(kv._values).includes(license), false);

  // (d) logs carry no raw license
  assert.equal(JSON.stringify(logger._entries).includes(license), false);
});

test('security: a denied LS response that echoes the license is redacted before logging', async () => {
  const logger = spyLogger();
  const license = 'LK-ECHO-1a2b3c4d-5e6f7a8b9c0d';
  const fetchImpl = spyFetch(() => lsResponse({
    valid: false,
    error: `license_key=${license} is not active`, // echoed inside a free-form string
    license_key: { status: 'inactive', key: license }, // echoed inside a secret-named object
    meta: GOOD_META,
  }));
  const validator = makeValidator({ logger, fetchImpl });

  const res = await validator.validate({ licenseKey: license });
  assert.equal(res.ok, false);
  assert.equal(res.status, 403);

  assert.ok(logger._entries.length > 0, 'a denial must be logged for triage');
  const serialized = JSON.stringify(logger._entries);
  assert.equal(serialized.includes(license), false, 'raw license leaked into logs');
  assert.ok(serialized.includes('[REDACTED]'), 'the echoed license must be redacted');
});

test('security: a denial log never contains customer PII from the LS meta block', async () => {
  const logger = spyLogger();
  // A revoked/mismatched key of a REAL customer: LS echoes their email + name in meta.
  const fetchImpl = spyFetch(() => lsResponse({
    valid: false,
    error: 'license_key not found.',
    license_key: { status: 'active', expires_at: null },
    meta: { ...GOOD_META, customer_email: 'buyer@example.com', customer_name: 'Real Buyer' },
  }));
  const res = await makeValidator({ fetchImpl, logger }).validate({ licenseKey: 'LK-pii-check' });
  assert.equal(res.ok, false);
  assert.equal(res.status, 403);

  assert.ok(logger._entries.length > 0, 'the denial must still be logged for triage');
  const logged = JSON.stringify(logger._entries);
  assert.equal(logged.includes('buyer@example.com'), false, 'customer email leaked into logs');
  assert.equal(logged.includes('Real Buyer'), false, 'customer name leaked into logs');
  assert.ok(logged.includes('not-valid'), 'the triage detail must survive the PII cut');
});

test('regression(B1): re-read after acquiring the single-flight lock serves a winner-populated cache without a second LS call', async () => {
  const licenseKey = 'LIC-REREAD-0001';
  const cacheKey = quotaKeyHmac(SECRET, 'ls-license-cache', licenseKey);
  const allowEntry = { decision: 'allow', tier: 'pro', status: 'active', expiresAt: FIXED_NOW + 100_000 };
  const inner = createMemoryKv();
  let cacheGets = 0;
  // Simulate the B1 race: the FIRST cache read (before the lock) misses, but a
  // previous winner finishes and writes the cache before our post-lock re-read.
  const kv = {
    __memory: true,
    async get(key) {
      if (key === cacheKey) { cacheGets += 1; return cacheGets >= 2 ? allowEntry : undefined; }
      return inner.get(key);
    },
    async set(key, val, opts) { return inner.set(key, val, opts); },
    async incr(key, opts) { return inner.incr(key, opts); },
    async decr(key) { return inner.decr(key); },
  };
  const fetchImpl = spyFetch(() => lsResponse(okBody()));
  const res = await makeValidator({ kv, fetchImpl }).validate({ licenseKey });
  assert.equal(res.ok, true);
  assert.equal(res.cache, 'hit');
  assert.equal(fetchImpl.calls.length, 0, 're-read cache hit must not call LS');
  assert.ok(cacheGets >= 2, 'the winner path must re-read the cache after acquiring the lock');
});

test('regression(B2): a denied LS body that echoes the raw license under a non-secret key is scrubbed from logs', async () => {
  const licenseKey = 'LK-ECHO-abcdef0123456789';
  const logger = spyLogger();
  // valid:false denial whose free-form `error` echoes the raw license verbatim
  // under a non-secret key that pattern redaction alone would NOT catch.
  const body = { valid: false, error: `license ${licenseKey} was rejected`, license_key: { status: 'active', expires_at: null }, meta: { ...GOOD_META } };
  const fetchImpl = spyFetch(() => lsResponse(body));
  const res = await makeValidator({ fetchImpl, logger }).validate({ licenseKey });
  assert.equal(res.ok, false);
  assert.equal(res.status, 403);
  const logged = JSON.stringify(logger._entries);
  assert.equal(logged.includes(licenseKey), false, 'the raw license must never reach a log line');
  assert.match(logged, /\[REDACTED\]/);
});

test('regression(B3): a same-license single-flight loser fails closed WITHOUT charging the global RPM bucket', async () => {
  const licenseKey = 'LIC-LOSER-0001';
  const lockKey = quotaKeyHmac(SECRET, 'ls-lock', licenseKey);
  const rpmKey = quotaKeyHmac(SECRET, 'ls-rpm', Math.floor(FIXED_NOW / 60_000));
  const kv = spyKv();
  await kv.incr(lockKey); // a prior winner already holds the lock (counter = 1)
  const rpmBefore = kv._keys.filter((k) => k === rpmKey).length;
  const fetchImpl = spyFetch(() => lsResponse(okBody()));
  const res = await makeValidator({ kv, fetchImpl }).validate({ licenseKey }); // our incr -> 2 => loser
  assert.equal(res.ok, false);
  assert.equal(res.status, 503);
  assert.equal(res.reason, QUOTA_REASONS.LICENSE_UNAVAILABLE);
  assert.equal(fetchImpl.calls.length, 0, 'a single-flight loser must not call LS');
  const rpmTouches = kv._keys.filter((k) => k === rpmKey).length - rpmBefore;
  assert.equal(rpmTouches, 0, 'a single-flight loser must not consume the global RPM bucket');
});
