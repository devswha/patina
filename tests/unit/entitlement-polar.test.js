// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  POLAR_LICENSE_VALIDATE_URL,
  POLAR_SANDBOX_LICENSE_VALIDATE_URL,
  buildPolarValidateRequest,
  evaluatePolarLicenseResponse,
  isPolarDefinitiveDenial,
  polarValidateUrl,
  createPolarLicenseValidator,
} from '../../src/entitlement-polar.js';
import { createLicenseValidator } from '../../src/entitlement.js';
import { QUOTA_REASONS } from '../../src/web-rewrite-contract.js';

const ORG = 'fda84e25-7b55-4d67-916d-60ead04ff61f';
const BENEFIT = '32a8eda4-56cf-4a94-8228-792d324a519e';
const env = { POLAR_ORGANIZATION_ID: ORG, POLAR_PRO_BENEFIT_ID: BENEFIT };

/** The documented Polar validate response shape (docs, retrieved 2026-07-29). */
function grantedResponse(overrides = {}) {
  return {
    id: '508176f7-065a-4b5d-b524-4e9c8a11ed63',
    organization_id: ORG,
    user_id: 'd910050c-be66-4ca0-b4cc-34fde514f227',
    benefit_id: BENEFIT,
    key: '1C285B2D-6CE6-4BC7-B8BE-ADB6A7E304DA',
    display_key: '****-E304DA',
    status: 'granted',
    limit_activations: null,
    usage: 0,
    limit_usage: null,
    validations: 5,
    last_validated_at: '2026-07-29T13:57:00.977363Z',
    expires_at: null,
    ...overrides,
  };
}

test('a granted key for the configured organization and benefit entitles', () => {
  const result = evaluatePolarLicenseResponse(grantedResponse(), env);
  assert.deepEqual(result, { ok: true, status: 'granted', expiresAt: null });
});

test('a future expiry entitles and is returned; a past or unparseable one denies', () => {
  const now = Date.parse('2026-07-29T00:00:00.000Z');
  const future = evaluatePolarLicenseResponse(grantedResponse({ expires_at: '2026-08-30T08:40:34.769148Z' }), env, now);
  assert.equal(future.ok, true);
  assert.equal(future.ok === true && future.expiresAt, Date.parse('2026-08-30T08:40:34.769148Z'));

  for (const expires_at of ['2026-07-28T23:59:59.000Z', '2026-07-29T00:00:00.000Z', 'not-a-date', '']) {
    const denied = evaluatePolarLicenseResponse(grantedResponse({ expires_at }), env, now);
    assert.equal(denied.ok, false, `${expires_at} must not entitle`);
    assert.equal(denied.ok === false && denied.detail, 'expired');
  }
});

test('every denial is a generic 403 LICENSE_INVALID with the reason only in detail', () => {
  const cases = /** @type {Array<[string, unknown]>} */ ([
    ['malformed-response', undefined],
    ['malformed-response', null],
    ['malformed-response', 'a string'],
    ['malformed-response', []],
    ['status-missing', grantedResponse({ status: undefined })],
    ['status-missing', grantedResponse({ status: 42 })],
    ['status-revoked', grantedResponse({ status: 'revoked' })],
    ['status-disabled', grantedResponse({ status: 'disabled' })],
    ['organization-mismatch', grantedResponse({ organization_id: 'another-org' })],
    ['benefit-mismatch', grantedResponse({ benefit_id: 'another-benefit' })],
  ]);
  for (const [detail, data] of cases) {
    const result = evaluatePolarLicenseResponse(data, env);
    assert.equal(result.ok, false, detail);
    assert.equal(result.ok === false && result.status, 403, detail);
    assert.equal(result.ok === false && result.reason, QUOTA_REASONS.LICENSE_INVALID, detail);
    assert.equal(result.ok === false && result.detail, detail);
  }
});

test('a benefit from the same organization does not entitle the paid tier', () => {
  // Polar warns that one organization can issue several license-key types. A
  // free or unrelated benefit's key validates fine against the org, so the
  // benefit gate is what separates it from the paid tier.
  const otherBenefit = grantedResponse({ benefit_id: 'free-tier-benefit-id' });
  assert.equal(evaluatePolarLicenseResponse(otherBenefit, env).ok, false);
});

test('missing server configuration fails closed rather than skipping a gate', () => {
  for (const partial of [{}, { POLAR_ORGANIZATION_ID: ORG }, { POLAR_PRO_BENEFIT_ID: BENEFIT }, { POLAR_ORGANIZATION_ID: '', POLAR_PRO_BENEFIT_ID: '' }]) {
    const result = evaluatePolarLicenseResponse(grantedResponse(), partial);
    assert.equal(result.ok, false, JSON.stringify(partial));
    assert.equal(result.ok === false && result.status, 403);
  }
});

test('the validate request pins the server-configured organization, never a caller value', () => {
  const built = buildPolarValidateRequest('LICENSE-ABC', env);
  // No secret is sent: the customer-portal endpoint is unauthenticated.
  assert.deepEqual(built, { key: 'LICENSE-ABC', organization_id: ORG });
});

test('the sandbox endpoint is opt-in and production is the default', () => {
  assert.equal(polarValidateUrl(), POLAR_LICENSE_VALIDATE_URL);
  assert.equal(polarValidateUrl({}), POLAR_LICENSE_VALIDATE_URL);
  assert.equal(polarValidateUrl({ POLAR_SERVER: 'production' }), POLAR_LICENSE_VALIDATE_URL);
  assert.equal(polarValidateUrl({ POLAR_SERVER: 'sandbox' }), POLAR_SANDBOX_LICENSE_VALIDATE_URL);
  // Both endpoints are HTTPS on a polar.sh host.
  for (const url of [POLAR_LICENSE_VALIDATE_URL, POLAR_SANDBOX_LICENSE_VALIDATE_URL]) {
    const parsed = new URL(url);
    assert.equal(parsed.protocol, 'https:');
    assert.ok(parsed.hostname.endsWith('polar.sh'), url);
  }
});

test('the evaluator never echoes the license key into its result', () => {
  const license = 'SECRET-LICENSE-VALUE';
  const results = [
    evaluatePolarLicenseResponse(grantedResponse({ key: license }), env),
    evaluatePolarLicenseResponse(grantedResponse({ key: license, status: 'revoked' }), env),
  ];
  for (const result of results) {
    assert.equal(JSON.stringify(result).includes(license), false);
  }
});
test('only a 404 ResourceNotFound is a definitive denial; everything else stays transient', () => {
  // Measured against the live endpoint 2026-07-29: an unknown key answers
  // 404 {"error":"ResourceNotFound","detail":"Not found"}. Misreading that as
  // an outage would report invalid licenses as 503 and re-charge the
  // admission bucket on every retry of a key that can never validate.
  assert.equal(isPolarDefinitiveDenial(404, { error: 'ResourceNotFound', detail: 'Not found' }), true);

  // Transient or caller-side; must never be cached as a denial.
  const transient = /** @type {Array<[number, unknown]>} */ ([
    [429, { error: 'RateLimited' }],
    [500, { error: 'InternalServerError' }],
    [502, null],
    [503, { error: 'ServiceUnavailable' }],
    [422, { error: 'ValidationError' }],
    [401, { error: 'Unauthorized' }],
    [403, { error: 'Forbidden' }],
    [200, { error: 'ResourceNotFound' }],
  ]);
  for (const [status, body] of transient) {
    assert.equal(isPolarDefinitiveDenial(status, body), false, `HTTP ${status} must not be a verdict`);
  }

  // A 404 whose body is missing, unparseable, or carries a different error is
  // NOT a verdict either — the narrow shape is the whole safety property.
  for (const body of [null, undefined, 'Not found', [], {}, { error: 'SomethingElse' }, { error: 404 }]) {
    assert.equal(isPolarDefinitiveDenial(404, body), false, `404 with body ${JSON.stringify(body)} must not be a verdict`);
  }
});

test('the evaluator reads named fields and never carries the PII Polar returns alongside them', () => {
  // Measured on a live sandbox response: the validate body includes user and
  // customer objects with the purchaser's email, name, and avatar URL. The
  // evaluator must never pass any of that through to a caller or a log.
  const withPii = {
    ...grantedResponse(),
    user_id: '273b34da-78f3-4fdf-bf3d-77c4fb2d85e8',
    customer_id: '273b34da-78f3-4fdf-bf3d-77c4fb2d85e8',
    user: { id: '273b34da', email: 'buyer@example.com', public_name: 'Buyer', avatar_url: 'https://example.com/a.png' },
    customer: { id: '273b34da', email: 'buyer@example.com', name: 'Buyer' },
  };
  const allowed = evaluatePolarLicenseResponse(withPii, env);
  assert.equal(allowed.ok, true);
  const serialized = JSON.stringify(allowed);
  for (const field of ['user', 'customer', 'user_id', 'customer_id']) {
    assert.equal(serialized.includes(field), false, `${field} must not survive into the result`);
  }
  assert.equal(serialized.includes('buyer@example.com'), false, 'the purchaser email must never survive');
  assert.equal(serialized.includes('Buyer'), false, 'the purchaser name must never survive');

  // The denial path must be equally clean.
  const denied = evaluatePolarLicenseResponse({ ...withPii, status: 'revoked' }, env);
  assert.equal(denied.ok, false);
  assert.equal(JSON.stringify(denied).includes('buyer@example.com'), false);
});

// --- validator integration (mocked transport) -------------------------------

/** Minimal in-process KV with the shape the entitlement core expects. */
function memoryKv() {
  const map = new Map();
  return {
    async get(k) { return map.get(k); },
    async set(k, v) { map.set(k, v); },
    async incr(k) { const n = (Number(map.get(k)) || 0) + 1; map.set(k, n); return n; },
    // Single-flight lease primitives (owner-token lock): one slot per registry.
    leases: new Map(),
    async acquireLease(k, lease, maxConcurrent, { ttlMs }) {
      const now = Number(LEASE_NOW());
      const live = new Map([...(this.leases.get(k) ?? [])].filter(([, exp]) => exp > now));
      if (live.size >= maxConcurrent) { this.leases.set(k, live); return false; }
      live.set(lease, now + ttlMs);
      this.leases.set(k, live);
      return true;
    },
    async releaseLease(k, lease) {
      const live = this.leases.get(k);
      if (!live || !live.has(lease)) return false;
      live.delete(lease);
      return true;
    },
  };
}

/** Clock for the in-test lease registry; overridable per test if needed. */
const LEASE_NOW = () => Date.now();
/** Minimal Response stand-in; the entitlement core only reads ok/status/json. */
function jsonResponse(status, body) {
  return /** @type {Response} */ (/** @type {unknown} */ ({ ok: status >= 200 && status < 300, status, json: async () => body }));
}

const validatorEnv = {
  POLAR_ORGANIZATION_ID: ORG,
  POLAR_PRO_BENEFIT_ID: BENEFIT,
  PATINA_LICENSE_HMAC_SECRET: 'unit-secret',
};

test('a granted license is allowed once and served from cache afterwards', async () => {
  let calls = 0;
  const validator = createPolarLicenseValidator({
    kv: memoryKv(),
    env: validatorEnv,
    logger: { warn() {} },
    fetchImpl: (async () => { calls += 1; return jsonResponse(200, grantedResponse()); }),
  });

  const first = await validator.validate({ licenseKey: 'LICENSE-A' });
  assert.equal(first.ok, true);
  assert.equal(first.ok === true && first.tier, 'pro');
  assert.equal(first.ok === true && first.cache, 'miss');

  const second = await validator.validate({ licenseKey: 'LICENSE-A' });
  assert.equal(second.ok === true && second.cache, 'hit');
  // The cache is what keeps this endpoint's tight rate limit from turning
  // paying customers' requests into 503s.
  assert.equal(calls, 1, 'a cached decision must not re-hit the provider');
});

test('an unknown key is a 403 denial, not a 503 outage', async () => {
  // Polar answers an unknown key with 404. Reading it as an outage would report
  // invalid licenses as service failures and re-hit the rate budget forever.
  let calls = 0;
  const validator = createPolarLicenseValidator({
    kv: memoryKv(),
    env: validatorEnv,
    logger: { warn() {} },
    fetchImpl: async () => { calls += 1; return jsonResponse(404, { error: 'ResourceNotFound', detail: 'Not found' }); },
  });

  const denied = await validator.validate({ licenseKey: 'LICENSE-MISSING' });
  assert.equal(denied.ok, false);
  assert.equal(denied.ok === false && denied.status, 403);
  assert.equal(denied.ok === false && denied.reason, QUOTA_REASONS.LICENSE_INVALID);

  // Negatively cached: a retry of a permanently invalid key must not spend
  // another provider call.
  await validator.validate({ licenseKey: 'LICENSE-MISSING' });
  assert.equal(calls, 1);
});

test('rate limiting and outages stay transient and are never cached', async () => {
  for (const [status, body] of /** @type {Array<[number, unknown]>} */ ([[429, { error: 'RateLimited' }], [500, { error: 'Internal' }]])) {
    let calls = 0;
    const validator = createPolarLicenseValidator({
      kv: memoryKv(),
      env: validatorEnv,
      logger: { warn() {} },
      fetchImpl: async () => { calls += 1; return jsonResponse(status, body); },
    });
    const first = await validator.validate({ licenseKey: 'LICENSE-B' });
    assert.equal(first.ok, false, `HTTP ${status}`);
    assert.equal(first.ok === false && first.status, 503, `HTTP ${status} must be transient`);
    await validator.validate({ licenseKey: 'LICENSE-B' });
    assert.equal(calls, 2, `HTTP ${status} must not be cached — a retry has to re-validate`);
  }
});

test('missing provider configuration fails closed without any network call', async () => {
  let calls = 0;
  const validator = createPolarLicenseValidator({
    kv: memoryKv(),
    env: { PATINA_LICENSE_HMAC_SECRET: 'unit-secret' },
    logger: { warn() {} },
    fetchImpl: (async () => { calls += 1; return jsonResponse(200, grantedResponse()); }),
  });
  const result = await validator.validate({ licenseKey: 'LICENSE-C' });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.status, 503);
  assert.equal(calls, 0, 'an unconfigured provider must never reach the network');
});

test('an empty license is refused before any validate request is built', async () => {
  let calls = 0;
  const validator = createPolarLicenseValidator({
    kv: memoryKv(),
    env: validatorEnv,
    logger: { warn() {} },
    fetchImpl: (async () => { calls += 1; return jsonResponse(200, grantedResponse()); }),
  });
  for (const licenseKey of ['', '   ', /** @type {any} */ (undefined)]) {
    const result = await validator.validate({ licenseKey });
    assert.equal(result.ok === false && result.status, 401);
  }
  assert.equal(calls, 0);
});

test('the validator leaks neither the license nor the PII Polar returns', async () => {
  const license = 'LICENSE-SECRET-VALUE';
  const logs = [];
  const validator = createPolarLicenseValidator({
    kv: memoryKv(),
    env: validatorEnv,
    logger: { warn: (message, meta) => logs.push([message, meta]) },
    fetchImpl: (async () => jsonResponse(200, {
      ...grantedResponse({ key: license, status: 'revoked' }),
      user: { email: 'buyer@example.com', public_name: 'Buyer' },
      customer: { email: 'buyer@example.com', name: 'Buyer' },
    })),
  });
  const result = await validator.validate({ licenseKey: license });
  assert.equal(result.ok, false);
  const everything = JSON.stringify(logs) + JSON.stringify(result);
  assert.equal(everything.includes(license), false, 'the raw license must never surface');
  assert.equal(everything.includes('buyer@example.com'), false, 'the purchaser email must never surface');
  assert.equal(everything.includes('Buyer'), false, 'the purchaser name must never surface');
});

test('provider namespacing keeps a Polar decision from being served to another provider', async () => {
  // Cache and lock keys are derived from the provider id, so a vendor switch
  // cannot reuse a decision cached under the previous one.
  const kv = memoryKv();
  const polar = createPolarLicenseValidator({
    kv,
    env: validatorEnv,
    logger: { warn() {} },
    fetchImpl: (async () => jsonResponse(200, grantedResponse())),
  });
  await polar.validate({ licenseKey: 'SHARED-KEY' });

  let testCalls = 0;
  const testProvider = {
    id: 'test',
    url: () => 'https://license.test/validate',
    configured: () => true,
    request: () => ({ headers: {}, body: '' }),
    isDefinitiveDenial: () => false,
    evaluate: () => /** @type {const} */ ({ ok: false, status: 403, reason: QUOTA_REASONS.LICENSE_INVALID, detail: 'denied' }),
    defaultRpm: 1,
  };
  const other = createLicenseValidator({
    provider: testProvider,
    kv,
    env: { PATINA_LICENSE_HMAC_SECRET: 'unit-secret' },
    logger: { warn() {} },
    fetchImpl: (async () => { testCalls += 1; return jsonResponse(200, {}); }),
  });
  await other.validate({ licenseKey: 'SHARED-KEY' });
  assert.equal(testCalls, 1, 'the other provider must not read a decision cached by Polar');
});
