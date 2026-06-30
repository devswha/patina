import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRO_SESSION_TTL_MS,
  PRO_SESSION_ABSOLUTE_TTL_MS,
  entitlementKey,
  sessionKey,
  generateProSessionToken,
  hashSessionToken,
  issueProSession,
  verifyProSession,
  refreshProSession,
  createProSessionExchange,
} from '../../src/pro-session.js';
import { ENTITLEMENT_STATES, hashLicenseKey } from '../../src/pro-entitlements.js';

const S = ENTITLEMENT_STATES;
const SECRET = 'test-hmac-secret';

const activeEntitlement = (over = {}) => ({ status: S.ACTIVE, effectiveAt: 0, version: 0, subscriptionId: 'sub_1', ...over });

/** A deterministic random impl: distinct bytes per call so tokens differ. */
function seqRandom() {
  let n = 0;
  return (len) => Buffer.alloc(len, (n++ % 254) + 1);
}

/** A tiny mock of the shared string KV store. */
function mockKv() {
  const map = new Map();
  return {
    map,
    async get(key) { return map.has(key) ? map.get(key) : null; },
    async set(key, val, { ttlMs } = {}) {
      assert.equal(typeof val, 'string', 'KV value must be a string (store contract)');
      map.set(key, val);
      map.set(`__ttl__${key}`, ttlMs);
    },
  };
}

// --- token primitives -------------------------------------------------------
test('generateProSessionToken is opaque hex and uses the injected random source', () => {
  const t = generateProSessionToken(seqRandom());
  assert.match(t, /^[0-9a-f]{64}$/);
  assert.notEqual(generateProSessionToken(seqRandom()), generateProSessionToken(() => Buffer.alloc(32, 9)));
});

test('hashSessionToken is deterministic and fails closed without a secret/token', () => {
  assert.equal(hashSessionToken(SECRET, 'tok'), hashSessionToken(SECRET, 'tok'));
  assert.match(hashSessionToken(SECRET, 'tok'), /^[0-9a-f]{64}$/);
  assert.notEqual(hashSessionToken(SECRET, 'tok'), 'tok');
  assert.throws(() => hashSessionToken('', 'tok'), /secret/);
  assert.throws(() => hashSessionToken(SECRET, ''), /token/);
});

test('key namespaces are opaque-prefixed', () => {
  assert.equal(entitlementKey('abc'), 'ent:abc');
  assert.equal(sessionKey('def'), 'sess:def');
});

// --- issue / verify / refresh ----------------------------------------------
test('issueProSession builds a record only for an allowed entitlement', () => {
  const ok = issueProSession({ entitlement: activeEntitlement(), entitlementId: 'eid', now: 1000 });
  assert.equal(ok.ok, true);
  assert.equal(ok.record.entitlementId, 'eid');
  assert.equal(ok.record.expiresAt, 1000 + PRO_SESSION_TTL_MS);
  assert.equal(ok.record.absoluteExpiresAt, 1000 + PRO_SESSION_ABSOLUTE_TTL_MS);

  for (const s of [S.CANCELLED, S.REVOKED, S.EXPIRED, S.PAST_DUE, S.NONE]) {
    const r = issueProSession({ entitlement: { status: s, effectiveAt: 0, version: 0 }, entitlementId: 'eid', now: 1000 });
    assert.equal(r.ok, false, `${s} must not issue a session`);
  }
  assert.equal(issueProSession({ entitlement: activeEntitlement(), entitlementId: '', now: 1000 }).ok, false);
});

test('verifyProSession fails closed on missing/expired/absolute-expired/revoked', () => {
  const now = 1_000_000;
  const fresh = issueProSession({ entitlement: activeEntitlement(), entitlementId: 'eid', now }).record;
  assert.equal(verifyProSession({ sessionRecord: fresh, entitlement: activeEntitlement(), now }).ok, true);

  // sliding expiry passed
  assert.equal(verifyProSession({ sessionRecord: fresh, entitlement: activeEntitlement(), now: now + PRO_SESSION_TTL_MS + 1 }).reason, 'expired');
  // entitlement revoked while session still time-valid
  assert.equal(verifyProSession({ sessionRecord: fresh, entitlement: { status: S.REVOKED, effectiveAt: 0, version: 0 }, now: now + 1000 }).reason, 'entitlement_revoked');
  // malformed
  assert.equal(verifyProSession({ sessionRecord: null, entitlement: activeEntitlement(), now }).reason, 'no_session');
  assert.equal(verifyProSession({ sessionRecord: { expiresAt: 'soon', absoluteExpiresAt: now + 1 }, entitlement: activeEntitlement(), now }).reason, 'expired');

  // absolute cap beats a slid sliding expiry
  const nearCap = { entitlementId: 'eid', issuedAt: now, expiresAt: now + PRO_SESSION_TTL_MS, absoluteExpiresAt: now + 1000 };
  assert.equal(verifyProSession({ sessionRecord: nearCap, entitlement: activeEntitlement(), now: now + 2000 }).reason, 'absolute_expired');
});

test('refreshProSession slides expiry but never past the absolute cap, and only while valid', () => {
  const now = 1_000_000;
  const rec = issueProSession({ entitlement: activeEntitlement(), entitlementId: 'eid', now }).record;
  const later = now + 20 * 60 * 1000; // 20 min later, still valid
  const refreshed = refreshProSession({ sessionRecord: rec, entitlement: activeEntitlement(), now: later });
  assert.equal(refreshed.ok, true);
  // A 20-min-in refresh slides to later+TTL, still well under the 2h cap.
  assert.equal(refreshed.record.expiresAt, later + PRO_SESSION_TTL_MS);
  assert.ok(refreshed.record.expiresAt <= rec.absoluteExpiresAt);

  // The absolute cap binds when the slide would exceed it.
  const nearCap = { entitlementId: 'eid', issuedAt: now, expiresAt: now + 5000, absoluteExpiresAt: now + 5000 };
  const capped = refreshProSession({ sessionRecord: nearCap, entitlement: activeEntitlement(), now: now + 1000 });
  assert.equal(capped.ok, true);
  assert.equal(capped.record.expiresAt, nearCap.absoluteExpiresAt, 'expiry is clamped to the absolute cap');

  // cannot refresh once the entitlement is revoked
  assert.equal(refreshProSession({ sessionRecord: rec, entitlement: { status: S.REVOKED, effectiveAt: 0, version: 0 }, now: later }).ok, false);
});

// --- exchange ---------------------------------------------------------------
function exchangeWith({ kv = mockKv(), verifyLicense, now = 1_000_000 } = {}) {
  return {
    kv,
    ex: createProSessionExchange({
      kv,
      hmacSecret: SECRET,
      verifyLicense,
      hashKey: hashLicenseKey,
      now: () => now,
      randomImpl: seqRandom(),
    }),
  };
}

test('exchange issues a token for an active mirror entitlement and stores ONLY hashes', async () => {
  const { kv, ex } = exchangeWith();
  const rawKey = 'LEMON-LICENSE-RAW';
  const eid = hashLicenseKey(SECRET, rawKey);
  kv.map.set(entitlementKey(eid), JSON.stringify(activeEntitlement()));

  const res = await ex.exchange({ licenseKey: rawKey });
  assert.equal(res.ok, true);
  assert.match(res.proSessionToken, /^[0-9a-f]{64}$/);
  assert.equal(res.status, S.ACTIVE);

  // The session is stored under the HASH of the token, not the token itself,
  // and the raw license key never appears in any store key.
  const tokenHash = hashSessionToken(SECRET, res.proSessionToken);
  assert.ok(kv.map.has(sessionKey(tokenHash)));
  for (const key of kv.map.keys()) {
    assert.ok(!key.includes(rawKey), `raw license key leaked into store key: ${key}`);
    assert.ok(!key.includes(res.proSessionToken), `raw token leaked into store key: ${key}`);
  }
  // session record carries no raw key/token, and a TTL was set
  const stored = JSON.parse(kv.map.get(sessionKey(tokenHash)));
  assert.equal(stored.entitlementId, eid);
  assert.ok(!JSON.stringify(stored).includes(rawKey));
  assert.equal(kv.map.get(`__ttl__${sessionKey(tokenHash)}`), PRO_SESSION_ABSOLUTE_TTL_MS);
});

test('exchange falls back to a provider verify when the mirror is empty', async () => {
  let seen;
  const { ex } = exchangeWith({
    verifyLicense: async (raw) => { seen = raw; return activeEntitlement(); },
  });
  const res = await ex.exchange({ licenseKey: 'RAW-2' });
  assert.equal(res.ok, true);
  assert.equal(seen, 'RAW-2');
});

test('exchange fails closed (402) for a non-allowed entitlement and never downgrades', async () => {
  for (const s of [S.CANCELLED, S.REVOKED, S.EXPIRED, S.PAST_DUE]) {
    const { kv, ex } = exchangeWith();
    const eid = hashLicenseKey(SECRET, 'k');
    kv.map.set(entitlementKey(eid), JSON.stringify({ status: s, effectiveAt: 0, version: 0 }));
    const res = await ex.exchange({ licenseKey: 'k' });
    assert.equal(res.ok, false);
    assert.equal(res.status, 402, `${s} must be 402`);
  }
});

test('exchange fails closed for an unknown key (no mirror, no verify)', async () => {
  const { ex } = exchangeWith();
  const res = await ex.exchange({ licenseKey: 'never-seen' });
  assert.equal(res.ok, false);
  assert.equal(res.status, 402);
});

test('exchange rejects a missing/blank licenseKey (400) and a missing secret (503)', async () => {
  const { ex } = exchangeWith();
  assert.equal((await ex.exchange({})).status, 400);
  assert.equal((await ex.exchange({ licenseKey: '   ' })).status, 400);

  const ex503 = createProSessionExchange({ kv: mockKv(), hmacSecret: '', hashKey: hashLicenseKey });
  assert.equal((await ex503.exchange({ licenseKey: 'k' })).status, 503);
});

test('exchange error results never echo the raw license key', async () => {
  const { ex } = exchangeWith();
  const res = await ex.exchange({ licenseKey: 'SUPER-SECRET-RAW-KEY' });
  assert.ok(!JSON.stringify(res).includes('SUPER-SECRET-RAW-KEY'));
});

test('exchange ignores an INHERITED licenseKey (prototype pollution cannot smuggle a key)', async () => {
  const { kv, ex } = exchangeWith();
  const rawKey = 'INHERITED-RAW';
  kv.map.set(entitlementKey(hashLicenseKey(SECRET, rawKey)), JSON.stringify(activeEntitlement()));
  // licenseKey lives on the prototype, not as an own property.
  const polluted = Object.create({ licenseKey: rawKey });
  const res = await ex.exchange(polluted);
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  // and no session was created
  assert.equal([...kv.map.keys()].some((k) => k.startsWith('sess:')), false);
});

test('exchange rejects an oversized licenseKey at the boundary (any body shape)', async () => {
  const { kv, ex } = exchangeWith();
  const res = await ex.exchange({ licenseKey: 'x'.repeat(600) });
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
  assert.match(res.reason, /too long/);
  assert.equal([...kv.map.keys()].some((k) => k.startsWith('sess:')), false);
});
