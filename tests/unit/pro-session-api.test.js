import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProSessionApiHandler } from '../../api/pro-session.js';
import { entitlementKey, hashSessionToken, sessionKey } from '../../src/pro-session.js';
import { ENTITLEMENT_STATES, hashLicenseKey } from '../../src/pro-entitlements.js';

const S = ENTITLEMENT_STATES;
const SECRET = 'api-test-secret';
const activeEntitlement = { status: S.ACTIVE, effectiveAt: 0, version: 0, subscriptionId: 'sub_1' };

function mockKv() {
  const map = new Map();
  return {
    map,
    async get(key) { return map.has(key) ? map.get(key) : null; },
    async set(key, val) { assert.equal(typeof val, 'string'); map.set(key, val); },
  };
}

/** A mock res capturing status/headers/body. */
function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(payload) { this.body = payload; },
  };
}

function makeHandler({ kv = mockKv(), env = {}, verifyLicense, logs = [] } = {}) {
  const handler = createProSessionApiHandler({
    env: { PATINA_PRO_HMAC_SECRET: SECRET, ...env },
    kv,
    verifyLicense,
    logger: { info: (msg, meta) => logs.push({ msg, meta }) },
    now: () => 1_000_000,
  });
  return { handler, kv, logs };
}

test('POST with an active mirror entitlement returns 200 + an opaque token (no-store)', async () => {
  const { handler, kv } = makeHandler();
  const rawKey = 'LEMON-RAW-API';
  kv.map.set(entitlementKey(hashLicenseKey(SECRET, rawKey)), JSON.stringify(activeEntitlement));

  const res = mockRes();
  await handler({ method: 'POST', body: { licenseKey: rawKey } }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  const out = JSON.parse(res.body);
  assert.match(out.proSessionToken, /^[0-9a-f]{64}$/);
  assert.equal(out.status, S.ACTIVE);
  // session stored under the token HASH; raw key/token absent from store keys
  assert.ok(kv.map.has(sessionKey(hashSessionToken(SECRET, out.proSessionToken))));
  for (const key of kv.map.keys()) assert.ok(!key.includes(rawKey));
});

test('non-POST is 405', async () => {
  const { handler } = makeHandler();
  const res = mockRes();
  await handler({ method: 'GET' }, res);
  assert.equal(res.statusCode, 405);
});

test('missing licenseKey is 400', async () => {
  const { handler } = makeHandler();
  const res = mockRes();
  await handler({ method: 'POST', body: {} }, res);
  assert.equal(res.statusCode, 400);
});

test('a non-allowed entitlement is 402 (fail-closed, no token)', async () => {
  const { handler, kv } = makeHandler();
  kv.map.set(entitlementKey(hashLicenseKey(SECRET, 'k')), JSON.stringify({ status: S.CANCELLED, effectiveAt: 0, version: 0 }));
  const res = mockRes();
  await handler({ method: 'POST', body: { licenseKey: 'k' } }, res);
  assert.equal(res.statusCode, 402);
  assert.ok(!JSON.parse(res.body).proSessionToken);
});

test('production without a REST KV fails closed with 503 (no memory fallback)', async () => {
  // isProductionPosture true via VERCEL_ENV; no KV_REST_API_* env → restKv null.
  const handler = createProSessionApiHandler({
    env: { PATINA_PRO_HMAC_SECRET: SECRET, VERCEL_ENV: 'production' },
    now: () => 1_000_000,
  });
  const res = mockRes();
  await handler({ method: 'POST', body: { licenseKey: 'k' } }, res);
  assert.equal(res.statusCode, 503);
});

test('the sanitized log never carries the raw license key or token', async () => {
  const { handler, kv, logs } = makeHandler();
  const rawKey = 'SECRET-RAW-LICENSE';
  kv.map.set(entitlementKey(hashLicenseKey(SECRET, rawKey)), JSON.stringify(activeEntitlement));
  const res = mockRes();
  await handler({ method: 'POST', body: { licenseKey: rawKey } }, res);
  const dump = JSON.stringify(logs);
  assert.ok(!dump.includes(rawKey));
  assert.ok(!dump.includes(JSON.parse(res.body).proSessionToken));
});

test('a KV outage during exchange fails closed as a sanitized 503 (no uncaught error)', async () => {
  const throwingKv = { async get() { throw new Error('kv down'); }, async set() {} };
  const handler = createProSessionApiHandler({
    env: { PATINA_PRO_HMAC_SECRET: SECRET },
    kv: throwingKv,
    now: () => 1_000_000,
  });
  const res = mockRes();
  await handler({ method: 'POST', body: { licenseKey: 'k' } }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.headers['cache-control'], 'no-store');
});
