import { Readable } from 'node:stream';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRO_SESSION_ABSOLUTE_TTL_MS,
  PRO_SESSION_TTL_MS,
  createProSessionExchange,
  entitlementKey,
  hashSessionToken,
  issueProSession,
  refreshProSession,
  sessionKey,
  verifyProSession,
} from '../../src/pro-session.js';
import { ENTITLEMENT_STATES, hashLicenseKey } from '../../src/pro-entitlements.js';
import { createProSessionApiHandler } from '../../api/pro-session.js';

const S = ENTITLEMENT_STATES;
const SECRET = 'redteam-hmac-secret';
const RAW_LICENSE = 'RAW-LEMON-REDTEAM-LICENSE';
const RAW_TOKEN_MARKER = 'RAW-PRO-SESSION-TOKEN';
const EMAIL = 'victim@example.test';
const NOW = 1_000_000;

const activeEntitlement = (overrides = {}) => ({
  status: S.ACTIVE,
  effectiveAt: 0,
  version: 0,
  subscriptionId: 'sub_redteam',
  ...overrides,
});

const inactiveStatuses = [S.CANCELLED, S.REVOKED, S.EXPIRED, S.PAST_DUE, S.NONE];

const seqRandom = () => {
  let n = 0;
  return (len) => Buffer.alloc(len, (n++ % 254) + 1);
};

const fixedRandom = (text) => (len) => Buffer.from(text.padEnd(len, 'x')).subarray(0, len);

const mockKv = () => {
  const map = new Map();
  return {
    map,
    async get(key) { return map.has(key) ? map.get(key) : null; },
    async set(key, val, opts = {}) {
      assert.equal(typeof val, 'string', 'KV value must be a string');
      map.set(key, val);
      map.set(`__ttl__${key}`, opts.ttlMs);
    },
  };
};

const exchangeWith = ({ kv = mockKv(), verifyLicense, now = NOW, randomImpl = seqRandom() } = {}) => ({
  kv,
  ex: createProSessionExchange({
    kv,
    hmacSecret: SECRET,
    verifyLicense,
    hashKey: hashLicenseKey,
    now: () => now,
    randomImpl,
  }),
});

const mockRes = () => ({
  statusCode: 0,
  headers: {},
  body: undefined,
  setHeader(key, val) { this.headers[key.toLowerCase()] = val; },
  end(payload) { this.body = payload; },
});

const streamReq = (body, method = 'POST') => {
  const req = Readable.from([body]);
  req.method = method;
  return req;
};

const makeApiHandler = ({ kv = mockKv(), env = {}, verifyLicense, logs = [] } = {}) => ({
  kv,
  logs,
  handler: createProSessionApiHandler({
    env: { PATINA_PRO_HMAC_SECRET: SECRET, ...env },
    kv,
    verifyLicense,
    logger: { info: (msg, meta) => logs.push({ msg, meta }) },
    now: () => NOW,
  }),
});

const dumpStore = (kv) => JSON.stringify([...kv.map.entries()]);

const assertNoSecretLeak = ({ kv, result, rawLicense = RAW_LICENSE, rawToken, email = EMAIL, allowReturnedToken = false }) => {
  const storeDump = dumpStore(kv);
  const resultDump = JSON.stringify(result);
  for (const forbidden of [rawLicense, email].filter(Boolean)) {
    assert.equal(storeDump.includes(forbidden), false, `secret leaked into KV: ${forbidden}`);
    assert.equal(resultDump.includes(forbidden), false, `secret leaked into result: ${forbidden}`);
  }
  if (rawToken) {
    assert.equal(storeDump.includes(rawToken), false, `raw token leaked into KV: ${rawToken}`);
    if (!allowReturnedToken) assert.equal(resultDump.includes(rawToken), false, `raw token leaked into result: ${rawToken}`);
  }
};

test('inactive entitlements never exchange into a session token', async () => {
  for (const status of inactiveStatuses) {
    const { kv, ex } = exchangeWith();
    const entitlementId = hashLicenseKey(SECRET, `${RAW_LICENSE}-${status}`);
    kv.map.set(entitlementKey(entitlementId), JSON.stringify({ status, effectiveAt: 0, version: 0 }));

    const result = await ex.exchange({ licenseKey: `${RAW_LICENSE}-${status}` });

    assert.equal(result.ok, false, `${status} must fail closed`);
    assert.equal(result.status, 402, `${status} must be Payment Required`);
    assert.equal('proSessionToken' in result, false, `${status} must not return a token`);
    for (const key of kv.map.keys()) assert.equal(key.startsWith('sess:'), false, `${status} must not create a session`);
  }
});

test('missing, blank, and non-string licenseKey bodies cannot obtain sessions', async () => {
  const invalidBodies = [undefined, null, {}, { licenseKey: '' }, { licenseKey: '   ' }, { licenseKey: 123 }, { licenseKey: true }, { licenseKey: ['k'] }, { licenseKey: { toString: () => RAW_LICENSE } }];

  for (const body of invalidBodies) {
    const { kv, ex } = exchangeWith();
    const result = await ex.exchange(body);

    assert.equal(result.ok, false, `invalid body must fail: ${JSON.stringify(body)}`);
    assert.equal(result.status, 400, `invalid body must be 400: ${JSON.stringify(body)}`);
    assert.equal([...kv.map.keys()].some((key) => key.startsWith('sess:')), false);
  }
});

test('exchange only returns the raw token as the intended success bearer and does not leak raw license, token, or email elsewhere', async () => {
  const rawToken = fixedRandom(RAW_TOKEN_MARKER)(32).toString('hex');
  const { kv, ex } = exchangeWith({
    randomImpl: fixedRandom(RAW_TOKEN_MARKER),
    verifyLicense: async (raw) => (raw === RAW_LICENSE ? activeEntitlement({ email: EMAIL, licenseKey: RAW_LICENSE }) : null),
  });

  const result = await ex.exchange({ licenseKey: RAW_LICENSE });

  assert.equal(result.ok, true);
  assert.equal(result.proSessionToken, rawToken);
  assert.ok(kv.map.has(sessionKey(hashSessionToken(SECRET, rawToken))), 'session must be stored by token hash');
  assert.equal(kv.map.has(sessionKey(rawToken)), false, 'raw token must not be a store key');
  assertNoSecretLeak({ kv, result, rawToken, allowReturnedToken: true });

  const denied = await ex.exchange({ licenseKey: `${RAW_LICENSE}-DENIED` });
  assert.equal(denied.ok, false);
  assertNoSecretLeak({ kv, result: denied, rawLicense: `${RAW_LICENSE}-DENIED`, rawToken, email: EMAIL });
});

test('expired sliding and absolute sessions fail verification', () => {
  const issued = issueProSession({ entitlement: activeEntitlement(), entitlementId: 'eid-redteam', now: NOW }).record;

  assert.equal(verifyProSession({ sessionRecord: issued, entitlement: activeEntitlement(), now: NOW + PRO_SESSION_TTL_MS + 1 }).ok, false);
  assert.equal(verifyProSession({ sessionRecord: issued, entitlement: activeEntitlement(), now: NOW + PRO_SESSION_TTL_MS + 1 }).reason, 'expired');

  const absoluteExpired = { ...issued, expiresAt: NOW + PRO_SESSION_ABSOLUTE_TTL_MS + 10_000 };
  assert.equal(verifyProSession({ sessionRecord: absoluteExpired, entitlement: activeEntitlement(), now: NOW + PRO_SESSION_ABSOLUTE_TTL_MS + 1 }).ok, false);
  assert.equal(verifyProSession({ sessionRecord: absoluteExpired, entitlement: activeEntitlement(), now: NOW + PRO_SESSION_ABSOLUTE_TTL_MS + 1 }).reason, 'absolute_expired');
});

test('revoked entitlement immediately invalidates an otherwise fresh session', () => {
  const issued = issueProSession({ entitlement: activeEntitlement(), entitlementId: 'eid-redteam', now: NOW }).record;

  const result = verifyProSession({
    sessionRecord: issued,
    entitlement: { status: S.REVOKED, effectiveAt: 0, version: 1 },
    now: NOW + 1,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'entitlement_revoked');
});

test('refresh cannot extend beyond the absolute cap or refresh forever', () => {
  let record = issueProSession({ entitlement: activeEntitlement(), entitlementId: 'eid-redteam', now: NOW }).record;
  let cursor = NOW;

  while (cursor < NOW + PRO_SESSION_ABSOLUTE_TTL_MS - 1) {
    cursor = Math.min(cursor + PRO_SESSION_TTL_MS - 1, NOW + PRO_SESSION_ABSOLUTE_TTL_MS - 1);
    const refreshed = refreshProSession({ sessionRecord: record, entitlement: activeEntitlement(), now: cursor });
    assert.equal(refreshed.ok, true);
    assert.ok(refreshed.record.expiresAt <= record.absoluteExpiresAt, 'refresh must respect absolute cap');
    record = refreshed.record;
    if (record.expiresAt === record.absoluteExpiresAt) break;
  }

  assert.equal(record.expiresAt, record.absoluteExpiresAt);
  assert.equal(refreshProSession({ sessionRecord: record, entitlement: activeEntitlement(), now: record.absoluteExpiresAt }).ok, false);
});

test('two exchanges for the same license receive distinct opaque token hashes', async () => {
  const { kv, ex } = exchangeWith();
  kv.map.set(entitlementKey(hashLicenseKey(SECRET, RAW_LICENSE)), JSON.stringify(activeEntitlement()));

  const first = await ex.exchange({ licenseKey: RAW_LICENSE });
  const second = await ex.exchange({ licenseKey: RAW_LICENSE });

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.notEqual(first.proSessionToken, second.proSessionToken);
  assert.notEqual(hashSessionToken(SECRET, first.proSessionToken), hashSessionToken(SECRET, second.proSessionToken));
  assert.match(first.proSessionToken, /^[0-9a-f]{64}$/);
  assert.match(second.proSessionToken, /^[0-9a-f]{64}$/);
});

test('API rejects non-POST, giant bodies, malformed JSON, missing production KV, and always no-stores', async () => {
  const { handler } = makeApiHandler();

  const getRes = mockRes();
  await handler({ method: 'GET' }, getRes);
  assert.equal(getRes.statusCode, 405);
  assert.equal(getRes.headers['cache-control'], 'no-store');

  const giantRes = mockRes();
  await handler(streamReq('{"licenseKey":"'.padEnd(16 * 1024 + 2, 'A')), giantRes);
  assert.equal(giantRes.statusCode, 400);
  assert.equal(giantRes.headers['cache-control'], 'no-store');

  const malformedRes = mockRes();
  await handler(streamReq('{"licenseKey":'), malformedRes);
  assert.equal(malformedRes.statusCode, 400);
  assert.equal(malformedRes.headers['cache-control'], 'no-store');

  const prodHandler = createProSessionApiHandler({
    env: { PATINA_PRO_HMAC_SECRET: SECRET, VERCEL_ENV: 'production' },
    now: () => NOW,
    logger: { info: () => {} },
  });
  const prodRes = mockRes();
  await prodHandler({ method: 'POST', body: { licenseKey: RAW_LICENSE } }, prodRes);
  assert.equal(prodRes.statusCode, 503);
  assert.equal(prodRes.headers['cache-control'], 'no-store');
});

test('prototype-polluted and type-confused bodies cannot smuggle a licenseKey', async () => {
  const inherited = Object.create({ licenseKey: RAW_LICENSE });
  const { kv, ex } = exchangeWith();
  kv.map.set(entitlementKey(hashLicenseKey(SECRET, RAW_LICENSE)), JSON.stringify(activeEntitlement()));

  const exchangeResult = await ex.exchange(inherited);

  assert.equal(exchangeResult.ok, false, 'exchange must ignore inherited licenseKey values');
  assert.equal(exchangeResult.status, 400);
  assert.equal([...kv.map.keys()].some((key) => key.startsWith('sess:')), false);

  const { handler } = makeApiHandler({ kv });
  const apiRes = mockRes();
  await handler({ method: 'POST', body: inherited }, apiRes);

  assert.equal(apiRes.statusCode, 400, 'API must ignore inherited licenseKey values');
  assert.equal(JSON.parse(apiRes.body).proSessionToken, undefined);
});
