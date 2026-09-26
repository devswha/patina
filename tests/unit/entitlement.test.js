import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createLicenseValidator,
  extractBearerLicense,
} from '../../src/entitlement.js';
import { createRestKv } from '../../api/rewrite.js';
import { createMemoryKv, quotaKeyHmac } from '../../src/rate-limit.js';
import { QUOTA_REASONS } from '../../src/web-rewrite-contract.js';

const TEST_LICENSE_VALIDATE_URL = 'https://license.test/validate';

function evaluateTestLicenseResponse(data, env = {}, now = Date.now()) {
  const deny = (detail) => ({ ok: false, status: 403, reason: QUOTA_REASONS.LICENSE_INVALID, detail });
  if (!data || typeof data !== 'object' || data.valid !== true) return deny('not-valid');
  const licenseKey = data.license_key;
  if (!licenseKey || typeof licenseKey !== 'object' || typeof licenseKey.status !== 'string') return deny('missing-license');
  if (!['active', 'inactive'].includes(licenseKey.status)) return deny('status-not-usable');
  let expiresAt = null;
  if (licenseKey.expires_at !== null && licenseKey.expires_at !== undefined) {
    const parsed = Date.parse(licenseKey.expires_at);
    if (!Number.isFinite(parsed) || parsed <= now) return deny('expired');
    expiresAt = parsed;
  }
  const meta = data.meta;
  if (!meta || typeof meta !== 'object') return deny('missing-meta');
  if (String(meta.store_id) !== String(env.TEST_STORE_ID)) return deny('store-mismatch');
  if (String(meta.variant_id) !== String(env.TEST_PRO_VARIANT_ID)) return deny('variant-mismatch');
  if (env.TEST_PRO_PRODUCT_ID && String(meta.product_id) !== String(env.TEST_PRO_PRODUCT_ID)) return deny('product-mismatch');
  return { ok: true, status: licenseKey.status, expiresAt };
}

const TEST_PROVIDER = {
  id: 'test',
  url: () => TEST_LICENSE_VALIDATE_URL,
  configured: (env) => Boolean(env.TEST_STORE_ID && env.TEST_PRO_VARIANT_ID),
  request: (license) => ({
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new globalThis.URLSearchParams({ license_key: license }).toString(),
  }),
  isDefinitiveDenial: (status, body) => status >= 400 && status < 500 && status !== 429 && Boolean(body) && typeof body === 'object' && body.valid === false,
  evaluate: evaluateTestLicenseResponse,
  defaultRpm: 50,
  errorText: (data) => (data && typeof data.error === 'string' ? data.error : undefined),
};

// ---------------------------------------------------------------------------
// Test fixtures / helpers
// ---------------------------------------------------------------------------

const FIXED_NOW = 1_700_000_000_000;
const SECRET = 'unit-test-license-secret';
const HEX64 = /^[a-f0-9]{64}$/;

const GOOD_META = Object.freeze({ store_id: 55555, variant_id: 98765, product_id: 4242 });

function baseEnv(overrides = {}) {
  return { TEST_STORE_ID: '55555', TEST_PRO_VARIANT_ID: '98765', ...overrides };
}

function futureIso(offsetMs = 3_600_000) {
  return new Date(FIXED_NOW + offsetMs).toISOString();
}

function pastIso(offsetMs = 3_600_000) {
  return new Date(FIXED_NOW - offsetMs).toISOString();
}

/** A well-formed, entitled test provider validate body; override any slice. */
function okBody(over = {}) {
  return {
    valid: over.valid !== undefined ? over.valid : true,
    error: null,
    license_key: { status: 'active', expires_at: null, ...(over.license_key || {}) },
    meta: { ...GOOD_META, ...(over.meta || {}) },
  };
}

/** A fake `fetch` Response. */
function testResponse(body, { status = 200, ok, throwJson = false } = {}) {
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
    async acquireLease(registryKey, lease, maxConcurrent, opts) { keys.push(registryKey); return inner.acquireLease(registryKey, lease, maxConcurrent, opts); },
    async releaseLease(registryKey, lease) { keys.push(registryKey); return inner.releaseLease(registryKey, lease); },
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
  return createLicenseValidator({ provider: TEST_PROVIDER,
    kv: kv === undefined ? createMemoryKv() : kv,
    hmacSecret,
    env: env || baseEnv(),
    fetchImpl,
    now,
    logger,
  });
}

test('createLicenseValidator requires an explicit provider', () => {
  assert.throws(() => createLicenseValidator(), new TypeError('provider is required'));
});

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
// evaluateTestLicenseResponse (pure)
// ---------------------------------------------------------------------------

test('evaluateTestLicenseResponse: entitled active/inactive keys pass', () => {
  const active = evaluateTestLicenseResponse(okBody(), baseEnv(), FIXED_NOW);
  assert.equal(active.ok, true);
  assert.equal(active.status, 'active');
  assert.equal(active.expiresAt, null);

  const inactive = evaluateTestLicenseResponse(okBody({ license_key: { status: 'inactive' } }), baseEnv(), FIXED_NOW);
  assert.equal(inactive.ok, true);
  assert.equal(inactive.status, 'inactive');

  const future = evaluateTestLicenseResponse(okBody({ license_key: { status: 'active', expires_at: futureIso() } }), baseEnv(), FIXED_NOW);
  assert.equal(future.ok, true);
  assert.equal(future.expiresAt, Date.parse(futureIso()));
});

test('evaluateTestLicenseResponse: every failed check returns a generic 403 LICENSE_INVALID', () => {
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
    const res = evaluateTestLicenseResponse(body, env, FIXED_NOW);
    assert.equal(res.ok, false, label);
    assert.equal(res.status, 403, label);
    assert.equal(res.reason, QUOTA_REASONS.LICENSE_INVALID, label);
  }
});

test('evaluateTestLicenseResponse: product id is only enforced when configured', () => {
  const body = okBody({ meta: { product_id: 4242 } });
  // not configured -> product ignored -> pass
  assert.equal(evaluateTestLicenseResponse(body, baseEnv(), FIXED_NOW).ok, true);
  // configured + matching -> pass
  assert.equal(evaluateTestLicenseResponse(body, baseEnv({ TEST_PRO_PRODUCT_ID: '4242' }), FIXED_NOW).ok, true);
  // configured + mismatching -> 403
  const mismatch = evaluateTestLicenseResponse(body, baseEnv({ TEST_PRO_PRODUCT_ID: '9999' }), FIXED_NOW);
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.status, 403);
  assert.equal(mismatch.reason, QUOTA_REASONS.LICENSE_INVALID);
});

// ---------------------------------------------------------------------------
// Exported constant
// ---------------------------------------------------------------------------

test('TEST_LICENSE_VALIDATE_URL points at the validate-only endpoint', () => {
  assert.equal(TEST_LICENSE_VALIDATE_URL, 'https://license.test/validate');
});

// ---------------------------------------------------------------------------
// validate: happy path + caching
// ---------------------------------------------------------------------------

test('validate: entitled license passes on miss, then serves from cache without re-fetching', async () => {
  const fetchImpl = spyFetch(() => testResponse(okBody()));
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
  assert.equal(fetchImpl.calls.length, 1, 'cache hit must not call test provider again');
});

test('validate: test provider request uses the validate-only endpoint, POST form body, and correct headers', async () => {
  const fetchImpl = spyFetch(() => testResponse(okBody()));
  const validator = makeValidator({ fetchImpl });

  await validator.validate({ licenseKey: 'LK-shape-0001' });
  const { url, opts } = fetchImpl.calls[0];
  assert.equal(url, TEST_LICENSE_VALIDATE_URL);
  assert.equal(opts.method, 'POST');
  assert.equal(opts.headers.Accept, 'application/json');
  assert.equal(opts.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(opts.body, 'license_key=LK-shape-0001');
  assert.ok(opts.signal, 'AbortSignal must be wired for the timeout');
});

test('validate: inactive-but-issued license still entitles (validate-only, not activation)', async () => {
  const fetchImpl = spyFetch(() => testResponse(okBody({ license_key: { status: 'inactive' } })));
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
    const fetchImpl = spyFetch(() => testResponse(body));
    const validator = makeValidator({ fetchImpl });
    const res = await validator.validate({ licenseKey: `LK-deny-${label.replace(/\s+/g, '-')}` });
    assert.equal(res.ok, false, label);
    assert.equal(res.status, 403, label);
    assert.equal(res.reason, QUOTA_REASONS.LICENSE_INVALID, label);
    // negative cache: a repeat is served without a second test provider call
    const again = await validator.validate({ licenseKey: `LK-deny-${label.replace(/\s+/g, '-')}` });
    assert.equal(again.status, 403, `${label} (cached)`);
    assert.equal(fetchImpl.calls.length, 1, `${label}: negative result must be cached`);
  }
});

test('validate: product mismatch is rejected only when TEST_PRO_PRODUCT_ID is configured', async () => {
  const body = okBody({ meta: { product_id: 4242 } });

  const mismatchFetch = spyFetch(() => testResponse(body));
  const mismatch = makeValidator({ env: baseEnv({ TEST_PRO_PRODUCT_ID: '9999' }), fetchImpl: mismatchFetch });
  const rejected = await mismatch.validate({ licenseKey: 'LK-prod-mismatch' });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.status, 403);

  const matchFetch = spyFetch(() => testResponse(body));
  const match = makeValidator({ env: baseEnv({ TEST_PRO_PRODUCT_ID: '4242' }), fetchImpl: matchFetch });
  assert.equal((await match.validate({ licenseKey: 'LK-prod-match' })).ok, true);
});

test('validate: a positive cache entry expires and re-validates against the provider', async () => {
  let clock = FIXED_NOW;
  const fetchImpl = spyFetch(() => testResponse(okBody()));
  const validator = makeValidator({ fetchImpl, env: baseEnv({ PATINA_TEST_CACHE_TTL_MS: '1000' }), now: () => clock });

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
  const noStore = makeValidator({ env: { TEST_PRO_VARIANT_ID: '98765' }, fetchImpl });
  assert.deepEqual(await noStore.validate({ licenseKey: 'LK-noconfig' }), {
    ok: false, status: 503, reason: QUOTA_REASONS.LICENSE_UNAVAILABLE,
  });

  const noVariant = makeValidator({ env: { TEST_STORE_ID: '55555' }, fetchImpl });
  assert.equal((await noVariant.validate({ licenseKey: 'LK-noconfig' })).status, 503);
  assert.equal(fetchImpl.calls.length, 0);
});

test('validate: production requires a real secret and a shared (non-memory) KV', async () => {
  const prodEnv = { NODE_ENV: 'production', TEST_STORE_ID: '55555', TEST_PRO_VARIANT_ID: '98765' };
  const realKv = { async get() { return undefined; }, async set() {}, async incr() { return 1; } };
  const fetchImpl = spyFetch(() => { throw new Error('must not fetch under prod guard'); });
  const denied = { ok: false, status: 503, reason: QUOTA_REASONS.LICENSE_UNAVAILABLE };

  const noSecret = createLicenseValidator({ provider: TEST_PROVIDER, kv: realKv, env: prodEnv, fetchImpl, now: () => FIXED_NOW });
  assert.deepEqual(await noSecret.validate({ licenseKey: 'LK-prod' }), denied);

  const noKv = createLicenseValidator({ provider: TEST_PROVIDER, kv: null, hmacSecret: SECRET, env: prodEnv, fetchImpl, now: () => FIXED_NOW });
  assert.deepEqual(await noKv.validate({ licenseKey: 'LK-prod' }), denied);

  const memoryKv = createLicenseValidator({ provider: TEST_PROVIDER, kv: createMemoryKv(), hmacSecret: SECRET, env: prodEnv, fetchImpl, now: () => FIXED_NOW });
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
// validate: test provider transport failures -> 503, never cached
// ---------------------------------------------------------------------------

test('validate: test provider timeout fails closed with 503 after exactly one fetch', async () => {
  const fetchImpl = spyFetch((_url, opts) => new Promise((_resolve, reject) => {
    opts.signal.addEventListener('abort', () => reject(new Error('The operation was aborted')));
  }));
  const validator = makeValidator({ fetchImpl, env: baseEnv({ PATINA_TEST_TIMEOUT_MS: '15' }) });
  const res = await validator.validate({ licenseKey: 'LK-timeout' });
  assert.equal(res.ok, false);
  assert.equal(res.status, 503);
  assert.equal(res.reason, QUOTA_REASONS.LICENSE_UNAVAILABLE);
  assert.equal(fetchImpl.calls.length, 1);
});

test('validate: test provider network exception fails closed with 503', async () => {
  const fetchImpl = spyFetch(() => { throw new Error('ECONNREFUSED'); });
  const validator = makeValidator({ fetchImpl });
  const res = await validator.validate({ licenseKey: 'LK-throw' });
  assert.equal(res.status, 503);
  assert.equal(res.reason, QUOTA_REASONS.LICENSE_UNAVAILABLE);
  assert.equal(fetchImpl.calls.length, 1);
});

test('validate: test provider non-2xx fails closed with 503', async () => {
  const fetchImpl = spyFetch(() => testResponse({ error: 'rate limited' }, { status: 429 }));
  const validator = makeValidator({ fetchImpl });
  const res = await validator.validate({ licenseKey: 'LK-500' });
  assert.equal(res.status, 503);
  assert.equal(res.reason, QUOTA_REASONS.LICENSE_UNAVAILABLE);
  assert.equal(fetchImpl.calls.length, 1);
});

test('validate: test provider 4xx with a valid:false body is a definitive 403 denial and is negative-cached', async () => {
  // test provider answers an unknown key with 404 + {"valid": false, "error": "license_key not found."}
  const fetchImpl = spyFetch(() => testResponse({ valid: false, error: 'license_key not found.' }, { status: 404 }));
  const validator = makeValidator({ fetchImpl });

  const res = await validator.validate({ licenseKey: 'LK-unknown-key' });
  assert.equal(res.ok, false);
  assert.equal(res.status, 403, 'an invalid key is a license verdict, not an availability failure');
  assert.equal(res.reason, QUOTA_REASONS.LICENSE_INVALID);

  const retry = await validator.validate({ licenseKey: 'LK-unknown-key' });
  assert.equal(retry.status, 403);
  assert.equal(fetchImpl.calls.length, 1, 'the verdict must be negative-cached; retries must not re-charge the RPM bucket');
});

test('validate: test provider 429 / 5xx / opaque 4xx stay transient 503 and are never cached', async () => {
  const responders = [
    ['429 rate limit', () => testResponse({ valid: false, error: 'rate limited' }, { status: 429 })],
    ['500 outage', () => testResponse({ valid: false }, { status: 500 })],
    ['404 unparseable body', () => testResponse(null, { status: 404, throwJson: true })],
    ['400 without valid:false', () => testResponse({ error: 'bad request' }, { status: 400 })],
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

test('validate: test provider malformed JSON fails closed with 503', async () => {
  const fetchImpl = spyFetch(() => testResponse(null, { status: 200, throwJson: true }));
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
    return testResponse(okBody());
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

test('admission: exceeding the per-minute RPM bucket denies without calling the provider', async () => {
  const fetchImpl = spyFetch(() => testResponse(okBody()));
  const validator = makeValidator({ fetchImpl, env: baseEnv({ PATINA_TEST_VALIDATE_RPM: '2' }) });

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
  const fetchImpl = spyFetch(() => testResponse(okBody()));
  const validator = makeValidator({ fetchImpl, env: baseEnv({ PATINA_TEST_VALIDATE_RPM: '1' }), now: () => clock });

  assert.equal((await validator.validate({ licenseKey: 'LK-min-a' })).ok, true);
  assert.equal((await validator.validate({ licenseKey: 'LK-min-b' })).status, 503); // same minute, over budget
  clock += 60_000; // next minute -> fresh bucket
  assert.equal((await validator.validate({ licenseKey: 'LK-min-c' })).ok, true);
  assert.equal(fetchImpl.calls.length, 2);
});

test('admission: a held single-flight lock polls the cache, then denies without calling the provider', async () => {
  const kv = createMemoryKv();
  const license = 'LK-lock-0001';
  const fetchImpl = spyFetch(() => testResponse(okBody()));
  // Small poll budget so the bounded follower wait doesn't slow the suite.
  const validator = makeValidator({
    kv,
    fetchImpl,
    env: baseEnv({ PATINA_TEST_LOCK_POLL_INTERVAL_MS: '2', PATINA_TEST_LOCK_WAIT_MS: '10' }),
  });

  // Simulate another instance mid-validation by holding the 1-slot lease with a
  // foreign owner token — and never writing the cache (a crashed/stuck winner).
  // The follower polls its bounded budget, then still fails CLOSED without LS.
  const lockRegistry = quotaKeyHmac(SECRET, 'test-sflight', license);
  await kv.acquireLease(lockRegistry, 'other-owner', 1, { ttlMs: 10_000 });

  const res = await validator.validate({ licenseKey: license });
  assert.equal(res.ok, false);
  assert.equal(res.status, 503);
  assert.equal(res.reason, QUOTA_REASONS.LICENSE_UNAVAILABLE);
  assert.equal(fetchImpl.calls.length, 0);
});

test('admission: a follower is served from the cache the winner writes mid-poll (no 503, no test provider re-call)', async () => {
  const kv = createMemoryKv();
  const license = 'LK-lock-0002';
  const fetchImpl = spyFetch(() => testResponse(okBody()));
  const validator = makeValidator({
    kv,
    fetchImpl,
    env: baseEnv({ PATINA_TEST_LOCK_POLL_INTERVAL_MS: '2' }),
  });

  // Another instance holds the lock…
  const lockRegistry = quotaKeyHmac(SECRET, 'test-sflight', license);
  await kv.acquireLease(lockRegistry, 'other-owner', 1, { ttlMs: 10_000 });
  // …and finishes validating while the follower is polling.
  const cacheKey = quotaKeyHmac(SECRET, 'test-license-cache', license);
  setTimeout(() => {
    void kv.set(cacheKey, { decision: 'allow', tier: 'pro', status: 'active', expiresAt: FIXED_NOW + 60_000 }, { ttlMs: 60_000 });
  }, 4);

  const res = await validator.validate({ licenseKey: license });
  assert.equal(res.ok, true, 'the follower must pick up the winner-written cache');
  assert.equal(res.cache, 'hit');
  assert.equal(fetchImpl.calls.length, 0, 'the follower must never call test provider itself');
});

test('admission: concurrent misses for one license call test provider exactly once (single-flight)', async () => {
  const fetchImpl = spyFetch(() => testResponse(okBody()));
  const validator = makeValidator({
    fetchImpl,
    env: baseEnv({ PATINA_TEST_LOCK_POLL_INTERVAL_MS: '2' }),
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
  assert.equal(results.filter((r) => r.ok && r.cache === 'miss').length, 1, 'exactly one winner validated against the provider');
  assert.equal(results.filter((r) => r.ok && r.cache === 'hit').length, 4, 'followers are served from the winner-written cache');
});

// ---------------------------------------------------------------------------
// Security: the raw license never leaks
// ---------------------------------------------------------------------------

test('security: the raw license never appears in return values, KV keys, cached values, or logs', async () => {
  const kv = spyKv();
  const logger = spyLogger();
  const license = 'LK-SECRET-9f8e7d6c-DEADBEEFCAFE';
  // test provider echoes the key back inside the (secret-named) license_key object.
  const fetchImpl = spyFetch(() => testResponse(okBody({ license_key: { status: 'active', expires_at: null, key: license } })));
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

test('security: a denied test provider response that echoes the license is redacted before logging', async () => {
  const logger = spyLogger();
  const license = 'LK-ECHO-1a2b3c4d-5e6f7a8b9c0d';
  const fetchImpl = spyFetch(() => testResponse({
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

test('security: a denial log never contains customer PII from the test provider meta block', async () => {
  const logger = spyLogger();
  // A revoked/mismatched key of a REAL customer: test provider echoes their email + name in meta.
  const fetchImpl = spyFetch(() => testResponse({
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

test('regression(B1): re-read after acquiring the single-flight lock serves a winner-populated cache without a second test provider call', async () => {
  const licenseKey = 'LIC-REREAD-0001';
  const cacheKey = quotaKeyHmac(SECRET, 'test-license-cache', licenseKey);
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
    async acquireLease(registryKey, lease, maxConcurrent, opts) { return inner.acquireLease(registryKey, lease, maxConcurrent, opts); },
    async releaseLease(registryKey, lease) { return inner.releaseLease(registryKey, lease); },
  };
  const fetchImpl = spyFetch(() => testResponse(okBody()));
  const res = await makeValidator({ kv, fetchImpl }).validate({ licenseKey });
  assert.equal(res.ok, true);
  assert.equal(res.cache, 'hit');
  assert.equal(fetchImpl.calls.length, 0, 're-read cache hit must not call LS');
  assert.ok(cacheGets >= 2, 'the winner path must re-read the cache after acquiring the lock');
});

test('regression(B2): a denied test provider body that echoes the raw license under a non-secret key is scrubbed from logs', async () => {
  const licenseKey = 'LK-ECHO-abcdef0123456789';
  const logger = spyLogger();
  // valid:false denial whose free-form `error` echoes the raw license verbatim
  // under a non-secret key that pattern redaction alone would NOT catch.
  const body = { valid: false, error: `license ${licenseKey} was rejected`, license_key: { status: 'active', expires_at: null }, meta: { ...GOOD_META } };
  const fetchImpl = spyFetch(() => testResponse(body));
  const res = await makeValidator({ fetchImpl, logger }).validate({ licenseKey });
  assert.equal(res.ok, false);
  assert.equal(res.status, 403);
  const logged = JSON.stringify(logger._entries);
  assert.equal(logged.includes(licenseKey), false, 'the raw license must never reach a log line');
  assert.match(logged, /\[REDACTED\]/);
});

test('regression(B3): a same-license single-flight loser fails closed WITHOUT charging the global RPM bucket', async () => {
  const licenseKey = 'LIC-LOSER-0001';
  const lockRegistry = quotaKeyHmac(SECRET, 'test-sflight', licenseKey);
  const rpmKey = quotaKeyHmac(SECRET, 'test-rpm', Math.floor(FIXED_NOW / 60_000));
  const kv = spyKv();
  await kv.acquireLease(lockRegistry, 'prior-winner', 1, { ttlMs: 10_000 }); // a prior winner already holds the lease
  const rpmBefore = kv._keys.filter((k) => k === rpmKey).length;
  const fetchImpl = spyFetch(() => testResponse(okBody()));
  const res = await makeValidator({ kv, fetchImpl }).validate({ licenseKey }); // our acquire fails => loser
  assert.equal(res.ok, false);
  assert.equal(res.status, 503);
  assert.equal(res.reason, QUOTA_REASONS.LICENSE_UNAVAILABLE);
  assert.equal(fetchImpl.calls.length, 0, 'a single-flight loser must not call LS');
  const rpmTouches = kv._keys.filter((k) => k === rpmKey).length - rpmBefore;
  assert.equal(rpmTouches, 0, 'a single-flight loser must not consume the global RPM bucket');
});

test('regression(P0 2026-09-01): followers cannot re-arm a crashed winner\'s lock TTL — the lease self-heals', async () => {
  // Pro review: the old counter lock incr'd on every follower and each incr
  // re-armed PEXPIRE, so sustained retries kept a crashed winner's lock alive
  // forever. The 1-slot lease must expire at its ORIGINAL deadline no matter
  // how many followers keep arriving.
  let t = 1_000_000;
  const kv = createMemoryKv({ now: () => t });
  const license = 'LK-sflight-heal';
  const registry = quotaKeyHmac(SECRET, 'test-sflight', license);
  // A crashed winner holds the lease for 10s and never releases.
  assert.equal(await kv.acquireLease(registry, 'crashed-winner', 1, { ttlMs: 10_000 }), true);
  // Followers keep arriving every 2.5s — inside the old counter's re-arm
  // window, so the legacy implementation would have extended the TTL forever.
  for (const [i, offset] of [2_500, 5_000, 7_500].entries()) {
    t = 1_000_000 + offset;
    assert.equal(
      await kv.acquireLease(registry, `follower-${i}`, 1, { ttlMs: 10_000 }),
      false,
      `follower at +${offset}ms must not acquire while the crashed lease lives`,
    );
  }
  // At +10s the crashed winner's ORIGINAL per-member expiry lapses (no re-arm
  // ever happened) and the next follower acquires: the lock self-heals.
  t = 1_000_000 + 10_000;
  assert.equal(
    await kv.acquireLease(registry, 'healed-follower', 1, { ttlMs: 10_000 }),
    true,
    'the lease must self-heal once the original TTL lapses',
  );
});

test('regression(P0): REST-KV owner leases self-heal under sustained validator followers and reject stale release', async () => {
  const originalFetch = globalThis.fetch;
  let serverNow = FIXED_NOW;
  const values = new Map();
  const sortedSets = new Map();
  const commands = [];
  const response = (result) => ({ ok: true, async json() { return { result }; } });

  globalThis.fetch = async (url, init = {}) => {
    const href = String(url);
    if (init.method === 'POST') {
      const args = JSON.parse(String(init.body));
      commands.push(args);
      const [command, script, , key] = args;
      if (command === 'SET') {
        values.set(args[1], {
          value: args[2],
          expiresAt: args[3] === 'PX' ? serverNow + Number(args[4]) : Number.POSITIVE_INFINITY,
        });
        return response('OK');
      }
      if (command !== 'EVAL') throw new Error(`unexpected command: ${command}`);
      if (script.includes("redis.call('ZADD'")) {
        const ttl = Number(args[4]);
        const maxConcurrent = Number(args[5]);
        const lease = args[6];
        const live = sortedSets.get(key) ?? new Map();
        for (const [member, expiry] of live) if (expiry <= serverNow) live.delete(member);
        if (live.size >= maxConcurrent) {
          sortedSets.set(key, live);
          return response(0);
        }
        live.set(lease, serverNow + ttl);
        sortedSets.set(key, live);
        return response(1);
      }
      if (script.includes("redis.call('ZSCORE'")) {
        const lease = args[4];
        const live = sortedSets.get(key);
        const expiry = live?.get(lease);
        if (typeof expiry !== 'number' || expiry <= serverNow) return response(0);
        live.delete(lease);
        return response(1);
      }
      if (script.includes("redis.call('INCRBY'")) {
        const amount = Number(args[4]);
        const current = Number(values.get(key)?.value ?? 0);
        const next = current + amount;
        values.set(key, { value: next, expiresAt: serverNow + Number(args[5]) });
        return response(next);
      }
      throw new Error('unexpected EVAL script');
    }

    const parsed = new URL(href);
    if (parsed.pathname.startsWith('/get/')) {
      const key = decodeURIComponent(parsed.pathname.slice('/get/'.length));
      const entry = values.get(key);
      if (entry && entry.expiresAt <= serverNow) values.delete(key);
      return response(values.get(key)?.value ?? null);
    }
    throw new Error(`unexpected REST-KV path: ${parsed.pathname}`);
  };

  try {
    const kv = createRestKv({
      KV_REST_API_URL: 'https://patina-test.upstash.io',
      KV_REST_API_TOKEN: 'test-rest-token',
      NODE_ENV: 'production',
    });
    assert.ok(kv);

    // The old scalar namespace can coexist without a Redis WRONGTYPE collision.
    const license = 'LK-rest-sflight-heal';
    const oldLockKey = quotaKeyHmac(SECRET, 'test-lock', license);
    const registry = quotaKeyHmac(SECRET, 'test-sflight', license);
    await kv.set(oldLockKey, 7, { ttlMs: 60_000 });
    assert.equal(await kv.acquireLease(registry, 'crashed-owner', 1, { ttlMs: 10_000 }), true);

    const providerFetch = spyFetch(() => testResponse(okBody()));
    const validator = makeValidator({
      kv,
      fetchImpl: providerFetch,
      now: () => serverNow,
      env: baseEnv({
        PATINA_TEST_LOCK_POLL_INTERVAL_MS: '1',
        PATINA_TEST_LOCK_WAIT_MS: '1',
      }),
    });

    // Sustained followers before the ORIGINAL lease deadline stay closed and
    // cannot re-arm the crashed owner's server-time ZSET score.
    for (const offset of [2_500, 5_000, 7_500]) {
      serverNow = FIXED_NOW + offset;
      const follower = await validator.validate({ licenseKey: license });
      assert.equal(follower.ok, false);
      assert.equal(follower.status, 503);
    }
    assert.equal(providerFetch.calls.length, 0);

    // No idle period: the caller arriving exactly at the original expiry
    // prunes owner A, becomes owner B, validates, caches, and releases.
    serverNow = FIXED_NOW + 10_000;
    const healed = await validator.validate({ licenseKey: license });
    assert.equal(healed.ok, true);
    assert.equal(providerFetch.calls.length, 1);
    assert.ok(commands.some((args) => args[3] === registry && String(args[1]).includes("redis.call('ZADD'")));
    assert.equal(commands.some((args) => String(args).includes(license)), false, 'REST commands must never contain the raw license');

    // Production-adapter atomicity and ownership: one simultaneous winner;
    // after A expires, stale A release cannot remove replacement owner B.
    const raceRegistry = quotaKeyHmac(SECRET, 'test-sflight-race', license);
    serverNow = FIXED_NOW + 20_000;
    const races = await Promise.all(
      ['race-a', 'race-b', 'race-c'].map((owner) => kv.acquireLease(raceRegistry, owner, 1, { ttlMs: 10_000 })),
    );
    assert.equal(races.filter(Boolean).length, 1);
    const winner = ['race-a', 'race-b', 'race-c'][races.findIndex(Boolean)];
    serverNow += 10_000;
    assert.equal(await kv.acquireLease(raceRegistry, 'replacement-owner', 1, { ttlMs: 10_000 }), true);
    assert.equal(await kv.releaseLease(raceRegistry, winner), false, 'expired owner cannot release a replacement');
    assert.equal(await kv.acquireLease(raceRegistry, 'third-owner', 1, { ttlMs: 10_000 }), false, 'replacement remains held');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
