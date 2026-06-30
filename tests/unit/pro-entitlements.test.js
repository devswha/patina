import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENTITLEMENT_STATES,
  PRO_ALLOWED_STATES,
  TERMINAL_STATES,
  POSITIVE_ENTITLEMENT_TTL_MS,
  NEGATIVE_ENTITLEMENT_TTL_MS,
  hashLicenseKey,
  deriveEntitlementState,
  isProAllowed,
  cacheTtlForState,
  shouldInvalidateSessions,
  applyEntitlementEvent,
} from '../../src/pro-entitlements.js';

const S = ENTITLEMENT_STATES;

function ev(overrides = {}) {
  return { id: 'evt-1', status: S.ACTIVE, effectiveAt: 1000, ...overrides };
}

// --- hashing ----------------------------------------------------------------
test('hashLicenseKey is a deterministic opaque HMAC and never echoes the raw key', () => {
  const a = hashLicenseKey('secret', 'LEMON-RAW-KEY');
  const b = hashLicenseKey('secret', 'LEMON-RAW-KEY');
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.ok(!a.includes('LEMON-RAW-KEY'));
  assert.notEqual(a, hashLicenseKey('secret', 'OTHER-KEY'));
  assert.notEqual(a, hashLicenseKey('other-secret', 'LEMON-RAW-KEY'));
});

test('hashLicenseKey fails closed without a secret or key', () => {
  assert.throws(() => hashLicenseKey('', 'k'), /secret/);
  assert.throws(() => hashLicenseKey('s', ''), /license key/);
});

// --- derive + isProAllowed --------------------------------------------------
test('deriveEntitlementState reports none for missing/garbage and the stored status otherwise', () => {
  assert.equal(deriveEntitlementState(null), S.NONE);
  assert.equal(deriveEntitlementState(undefined), S.NONE);
  assert.equal(deriveEntitlementState({}), S.NONE);
  assert.equal(deriveEntitlementState({ status: 'bogus' }), S.NONE);
  assert.equal(deriveEntitlementState({ status: S.ACTIVE }), S.ACTIVE);
  assert.equal(deriveEntitlementState({ status: S.PAST_DUE }), S.PAST_DUE);
});

test('deriveEntitlementState reports expired when a Pro-allowed record is past its hard expiry', () => {
  const rec = { status: S.ACTIVE, effectiveAt: 0, expiresAt: 500 };
  assert.equal(deriveEntitlementState(rec, 400), S.ACTIVE);
  assert.equal(deriveEntitlementState(rec, 600), S.EXPIRED);
});

test('isProAllowed is true only for active and trialing (and not past expiry)', () => {
  assert.equal(isProAllowed({ status: S.ACTIVE }), true);
  assert.equal(isProAllowed({ status: S.TRIALING }), true);
  for (const s of [S.NONE, S.PAST_DUE, S.CANCELLED, S.REVOKED, S.EXPIRED]) {
    assert.equal(isProAllowed({ status: s }), false, `expected ${s} not allowed`);
  }
  assert.equal(isProAllowed(null), false);
  assert.equal(isProAllowed({ status: S.ACTIVE, expiresAt: 100 }, 200), false);
});

test('PRO_ALLOWED_STATES is exactly {active, trialing}', () => {
  assert.deepEqual([...PRO_ALLOWED_STATES].sort(), [S.ACTIVE, S.TRIALING].sort());
});

// --- cache ttl + session invalidation ---------------------------------------
test('cacheTtlForState: positive 10m for allowed, negative 60s otherwise', () => {
  assert.equal(cacheTtlForState(S.ACTIVE), POSITIVE_ENTITLEMENT_TTL_MS);
  assert.equal(cacheTtlForState(S.TRIALING), POSITIVE_ENTITLEMENT_TTL_MS);
  for (const s of [S.NONE, S.PAST_DUE, S.CANCELLED, S.REVOKED, S.EXPIRED]) {
    assert.equal(cacheTtlForState(s), NEGATIVE_ENTITLEMENT_TTL_MS);
  }
});

test('shouldInvalidateSessions fires when leaving allowed or entering a terminal state', () => {
  assert.equal(shouldInvalidateSessions(S.ACTIVE, S.PAST_DUE), true);
  assert.equal(shouldInvalidateSessions(S.ACTIVE, S.CANCELLED), true);
  assert.equal(shouldInvalidateSessions(S.TRIALING, S.REVOKED), true);
  assert.equal(shouldInvalidateSessions(S.CANCELLED, S.REVOKED), true); // defensive: revoke after cancel
  assert.equal(shouldInvalidateSessions(S.ACTIVE, S.ACTIVE), false);
  assert.equal(shouldInvalidateSessions(S.TRIALING, S.ACTIVE), false);
  assert.equal(shouldInvalidateSessions(S.NONE, S.ACTIVE), false);
});

// --- applyEntitlementEvent: creation + idempotency --------------------------
test('applyEntitlementEvent creates a record from no prior state', () => {
  const r = applyEntitlementEvent(null, ev({ subscriptionId: 'sub_1', expiresAt: 9999 }));
  assert.equal(r.changed, true);
  assert.equal(r.record.status, S.ACTIVE);
  assert.equal(r.record.lastEventId, 'evt-1');
  assert.equal(r.record.subscriptionId, 'sub_1');
  assert.equal(r.record.expiresAt, 9999);
  assert.equal(r.prevState, S.NONE);
  assert.equal(r.nextState, S.ACTIVE);
});

test('applyEntitlementEvent ignores a duplicate event id (idempotent)', () => {
  const first = applyEntitlementEvent(null, ev()).record;
  const dup = applyEntitlementEvent(first, ev());
  assert.equal(dup.changed, false);
  assert.equal(dup.reason, 'duplicate_event');
});

test('applyEntitlementEvent ignores malformed events fail-closed', () => {
  for (const bad of [null, {}, { id: 'x' }, { id: 'x', status: 'nope', effectiveAt: 1 }, { id: 'x', status: S.ACTIVE, effectiveAt: 'soon' }]) {
    const r = applyEntitlementEvent(null, /** @type {any} */ (bad));
    assert.equal(r.changed, false);
    assert.equal(r.reason, 'invalid_event');
  }
});

test('applyEntitlementEvent treats a none-status event as a no-op', () => {
  const r = applyEntitlementEvent(null, ev({ status: S.NONE }));
  assert.equal(r.changed, false);
  assert.equal(r.reason, 'noop_none');
});

// --- ordering / out-of-order / stale ----------------------------------------
test('applyEntitlementEvent applies a strictly-newer event and ignores an older one', () => {
  const active = applyEntitlementEvent(null, ev({ id: 'e1', status: S.ACTIVE, effectiveAt: 1000, subscriptionId: 'sub_1' })).record;
  const pastDue = applyEntitlementEvent(active, ev({ id: 'e2', status: S.PAST_DUE, effectiveAt: 2000, subscriptionId: 'sub_1' }));
  assert.equal(pastDue.changed, true);
  assert.equal(pastDue.record.status, S.PAST_DUE);

  // An older event arriving late must not overwrite the newer state.
  const stale = applyEntitlementEvent(pastDue.record, ev({ id: 'e0', status: S.ACTIVE, effectiveAt: 500, subscriptionId: 'sub_1' }));
  assert.equal(stale.changed, false);
  assert.equal(stale.reason, 'stale_event');
});

test('authority is effectiveAt-primary with version as a same-time tiebreaker', () => {
  // A later effectiveAt wins regardless of version (no timestamp/version mixing).
  const a = applyEntitlementEvent(null, ev({ id: 'e1', status: S.ACTIVE, effectiveAt: 1000, version: 5, subscriptionId: 'sub_1' })).record;
  const later = applyEntitlementEvent(a, ev({ id: 'e2', status: S.PAST_DUE, effectiveAt: 2000, version: 1, subscriptionId: 'sub_1' }));
  assert.equal(later.changed, true);
  assert.equal(later.record.status, S.PAST_DUE);

  // At EQUAL effectiveAt, the higher version wins and a lower/equal one is stale.
  const b = applyEntitlementEvent(null, ev({ id: 'e3', status: S.ACTIVE, effectiveAt: 1000, version: 2, subscriptionId: 'sub_1' })).record;
  const lowerV = applyEntitlementEvent(b, ev({ id: 'e4', status: S.CANCELLED, effectiveAt: 1000, version: 1, subscriptionId: 'sub_1' }));
  assert.equal(lowerV.changed, false);
  assert.equal(lowerV.reason, 'stale_event');
  const higherV = applyEntitlementEvent(b, ev({ id: 'e5', status: S.CANCELLED, effectiveAt: 1000, version: 3, subscriptionId: 'sub_1' }));
  assert.equal(higherV.changed, true);
  assert.equal(higherV.record.status, S.CANCELLED);

  // An explicit version: 0 is a legitimate low tiebreaker, never "missing".
  const z = applyEntitlementEvent(null, ev({ id: 'e6', status: S.ACTIVE, effectiveAt: 1000, version: 0, subscriptionId: 'sub_1' })).record;
  assert.equal(z.version, 0);
});

test('malformed or non-future expiresAt on a Pro record denies Pro fail-closed (no fail-open)', () => {
  const base = { status: S.ACTIVE, effectiveAt: 0, version: 0 };
  assert.equal(isProAllowed({ ...base, expiresAt: 1000 }, 500), true); // finite future → allowed
  assert.equal(isProAllowed({ ...base, expiresAt: 500 }, 500), false); // boundary (<=) → expired
  assert.equal(isProAllowed({ ...base, expiresAt: 400 }, 500), false); // past → expired
  for (const bad of [NaN, Infinity, -Infinity, '20000', {}, []]) {
    const rec = { ...base, expiresAt: /** @type {any} */ (bad) };
    assert.equal(isProAllowed(rec, 500), false, `expiresAt=${String(bad)} must deny Pro`);
    assert.equal(deriveEntitlementState(rec, 500), S.EXPIRED);
  }
});

test('a stale/replayed revoke for an OLD subscription cannot revoke the current one', () => {
  const active2 = applyEntitlementEvent(null, ev({ id: 'e1', status: S.ACTIVE, effectiveAt: 5000, subscriptionId: 'sub_2' })).record;
  const oldRevoke = applyEntitlementEvent(active2, ev({ id: 'e0', status: S.REVOKED, effectiveAt: 1000, subscriptionId: 'sub_1' }));
  assert.equal(oldRevoke.changed, false);
  assert.equal(oldRevoke.reason, 'other_subscription');
  assert.equal(isProAllowed(active2), true);
});

test('a time-expired active record only renews via a newer event carrying a future expiry', () => {
  const now = 10_000;
  const expired = { status: S.ACTIVE, effectiveAt: 1000, version: 0, subscriptionId: 'sub_1', expiresAt: 2000 };
  assert.equal(deriveEntitlementState(expired, now), S.EXPIRED);
  const bare = applyEntitlementEvent(expired, ev({ id: 'e2', status: S.ACTIVE, effectiveAt: 3000, subscriptionId: 'sub_1' }), now);
  assert.equal(bare.changed, false);
  assert.equal(bare.reason, 'no_resurrection');
  const renew = applyEntitlementEvent(expired, ev({ id: 'e3', status: S.ACTIVE, effectiveAt: 3000, subscriptionId: 'sub_1', expiresAt: 99_999 }), now);
  assert.equal(renew.changed, true);
  assert.equal(renew.record.status, S.ACTIVE);
  assert.equal(renew.record.expiresAt, 99_999);
});

test('exported state constants are frozen (immutable access policy)', () => {
  assert.ok(Object.isFrozen(PRO_ALLOWED_STATES));
  assert.ok(Object.isFrozen(TERMINAL_STATES));
  assert.throws(() => { /** @type {any} */ (PRO_ALLOWED_STATES).push('hacked'); });
});

// --- revoke override + sticky -----------------------------------------------
test('a revoke wins even when it arrives out of order (monotonic terminal override)', () => {
  const active = applyEntitlementEvent(null, ev({ id: 'e1', status: S.ACTIVE, effectiveAt: 5000, subscriptionId: 'sub_1' })).record;
  const revoke = applyEntitlementEvent(active, ev({ id: 'e2', status: S.REVOKED, effectiveAt: 1000, subscriptionId: 'sub_1' }));
  assert.equal(revoke.changed, true);
  assert.equal(revoke.record.status, S.REVOKED);
});

test('revoked is sticky: a same-subscription active cannot un-revoke', () => {
  const revoked = applyEntitlementEvent(null, ev({ id: 'e1', status: S.REVOKED, effectiveAt: 1000, subscriptionId: 'sub_1' })).record;
  const tryActive = applyEntitlementEvent(revoked, ev({ id: 'e2', status: S.ACTIVE, effectiveAt: 2000, subscriptionId: 'sub_1' }));
  assert.equal(tryActive.changed, false);
  assert.equal(tryActive.reason, 'revoked_sticky');
});

test('revoked can only be left by a newer reissue for a different subscription', () => {
  const revoked = applyEntitlementEvent(null, ev({ id: 'e1', status: S.REVOKED, effectiveAt: 1000, subscriptionId: 'sub_1' })).record;
  const reissue = applyEntitlementEvent(revoked, ev({ id: 'e2', status: S.ACTIVE, effectiveAt: 2000, subscriptionId: 'sub_2' }));
  assert.equal(reissue.changed, true);
  assert.equal(reissue.record.status, S.ACTIVE);
  assert.equal(reissue.record.subscriptionId, 'sub_2');
});

// --- resurrection prevention (cancelled/expired) ----------------------------
test('a cancelled record is not resurrected to active by the same subscription', () => {
  const cancelled = applyEntitlementEvent(null, ev({ id: 'e1', status: S.CANCELLED, effectiveAt: 1000, subscriptionId: 'sub_1' })).record;
  const sameSub = applyEntitlementEvent(cancelled, ev({ id: 'e2', status: S.ACTIVE, effectiveAt: 2000, subscriptionId: 'sub_1' }));
  assert.equal(sameSub.changed, false);
  assert.equal(sameSub.reason, 'no_resurrection');
});

test('a cancelled record CAN be replaced by a new subscription (reissue)', () => {
  const cancelled = applyEntitlementEvent(null, ev({ id: 'e1', status: S.CANCELLED, effectiveAt: 1000, subscriptionId: 'sub_1' })).record;
  const reissue = applyEntitlementEvent(cancelled, ev({ id: 'e2', status: S.ACTIVE, effectiveAt: 2000, subscriptionId: 'sub_2' }));
  assert.equal(reissue.changed, true);
  assert.equal(reissue.record.subscriptionId, 'sub_2');
});

test('past_due can recover to active for the same subscription (not terminal)', () => {
  const pastDue = applyEntitlementEvent(null, ev({ id: 'e1', status: S.PAST_DUE, effectiveAt: 1000, subscriptionId: 'sub_1' })).record;
  const recovered = applyEntitlementEvent(pastDue, ev({ id: 'e2', status: S.ACTIVE, effectiveAt: 2000, subscriptionId: 'sub_1' }));
  assert.equal(recovered.changed, true);
  assert.equal(recovered.record.status, S.ACTIVE);
});

test('inputs are never mutated', () => {
  const current = applyEntitlementEvent(null, ev({ id: 'e1', subscriptionId: 'sub_1' })).record;
  const snapshot = JSON.stringify(current);
  applyEntitlementEvent(current, ev({ id: 'e2', status: S.CANCELLED, effectiveAt: 2000, subscriptionId: 'sub_1' }));
  assert.equal(JSON.stringify(current), snapshot);
});
