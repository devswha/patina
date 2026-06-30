import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENTITLEMENT_STATES,
  applyEntitlementEvent,
  deriveEntitlementState,
  hashLicenseKey,
  isProAllowed,
} from '../../src/pro-entitlements.js';

const S = ENTITLEMENT_STATES;
const NOW = 10_000;

const event = (overrides = {}) => ({
  id: 'evt-1',
  status: S.ACTIVE,
  effectiveAt: 1_000,
  version: 1,
  subscriptionId: 'sub-1',
  ...overrides,
});

const mustRecord = (result) => {
  assert.equal(result.changed, true);
  return result.record;
};

const assertNotAllowedResult = (result, label) => {
  assert.equal(result.changed, false, `${label}: event must be ignored`);
  assert.equal(isProAllowed(result.record, NOW), false, `${label}: ignored result must not expose an allowed record`);
};

const assertNoThrow = (callback, label) => {
  assert.doesNotThrow(callback, label);
};

test('revoke cannot be bypassed by same-subscription active events in arbitrary order, duplicates, higher versions, or future effectiveAt', () => {
  const active = mustRecord(applyEntitlementEvent(null, event({ id: 'active-1', effectiveAt: 5_000, version: 5 })));
  const revoked = mustRecord(applyEntitlementEvent(active, event({ id: 'revoke-older', status: S.REVOKED, effectiveAt: 1_000, version: 1 })));

  assert.equal(revoked.status, S.REVOKED);
  assert.equal(isProAllowed(revoked, NOW), false);

  const attacks = [
    ['same event duplicate revoke', event({ id: 'revoke-older', status: S.REVOKED, effectiveAt: 1_000, version: 1 })],
    ['same-sub active higher version', event({ id: 'active-v999', status: S.ACTIVE, effectiveAt: 6_000, version: 999 })],
    ['same-sub trialing higher version', event({ id: 'trial-v1000', status: S.TRIALING, effectiveAt: 7_000, version: 1_000 })],
    ['same-sub active future effectiveAt', event({ id: 'active-future', status: S.ACTIVE, effectiveAt: 99_999_999, version: 1_001 })],
    ['same-sub active no subscription id', event({ id: 'active-no-sub', status: S.ACTIVE, effectiveAt: 100_000_000, version: 1_002, subscriptionId: undefined })],
  ];

  for (const [label, attack] of attacks) {
    const result = applyEntitlementEvent(revoked, attack);
    assert.equal(result.changed, false, label);
    assert.equal(isProAllowed(revoked, NOW), false, `${label}: original revoked record remains denied`);
  }
});

test('cancelled and expired terminal records cannot be resurrected by same-subscription active events', () => {
  for (const terminal of [S.CANCELLED, S.EXPIRED]) {
    const record = mustRecord(applyEntitlementEvent(null, event({ id: `make-${terminal}`, status: terminal, effectiveAt: 1_000, version: 1 })));
    const attack = applyEntitlementEvent(record, event({ id: `resurrect-${terminal}`, status: S.ACTIVE, effectiveAt: 2_000, version: 2 }));

    assert.equal(attack.changed, false, terminal);
    assert.equal(attack.reason, 'no_resurrection');
    assert.equal(isProAllowed(record, NOW), false);
  }
});

test('null or undefined subscriptionId cannot disguise terminal same-subscription resurrection as a reissue', () => {
  for (const terminal of [S.CANCELLED, S.EXPIRED, S.REVOKED]) {
    const record = mustRecord(applyEntitlementEvent(null, event({ id: `terminal-${terminal}`, status: terminal, effectiveAt: 1_000, version: 1, subscriptionId: 'sub-original' })));

    for (const missingSubscriptionId of [null, undefined]) {
      const attack = applyEntitlementEvent(record, event({
        id: `missing-sub-${terminal}-${missingSubscriptionId}`,
        status: S.ACTIVE,
        effectiveAt: 2_000,
        version: 2,
        subscriptionId: missingSubscriptionId,
      }));

      assert.equal(attack.changed, false, `${terminal}/${missingSubscriptionId}`);
      assert.equal(isProAllowed(record, NOW), false);
    }
  }
});

test('duplicate event id cannot double-apply or bypass ordering with changed payload', () => {
  const first = mustRecord(applyEntitlementEvent(null, event({ id: 'shared-id', status: S.ACTIVE, effectiveAt: 1_000, version: 1 })));
  const duplicateCancel = applyEntitlementEvent(first, event({ id: 'shared-id', status: S.CANCELLED, effectiveAt: 9_000, version: 9 }));

  assert.equal(duplicateCancel.changed, false);
  assert.equal(duplicateCancel.reason, 'duplicate_event');
  assert.equal(isProAllowed(first, NOW), true);

  const cancelled = mustRecord(applyEntitlementEvent(first, event({ id: 'cancel-unique', status: S.CANCELLED, effectiveAt: 10_000, version: 10 })));
  const duplicateActive = applyEntitlementEvent(cancelled, event({ id: 'cancel-unique', status: S.ACTIVE, effectiveAt: 11_000, version: 11 }));

  assert.equal(duplicateActive.changed, false);
  assert.equal(duplicateActive.reason, 'duplicate_event');
  assert.equal(isProAllowed(cancelled, NOW), false);
});

test('version/effectiveAt ties are not newer and cannot override state', () => {
  const active = mustRecord(applyEntitlementEvent(null, event({ id: 'active', status: S.ACTIVE, effectiveAt: 5_000, version: 5 })));

  const tieCancel = applyEntitlementEvent(active, event({ id: 'tie-cancel', status: S.CANCELLED, effectiveAt: 5_000, version: 5 }));
  assert.equal(tieCancel.changed, false);
  assert.equal(tieCancel.reason, 'stale_event');
  assert.equal(isProAllowed(active, NOW), true);

  const sameVersionLaterEffective = applyEntitlementEvent(active, event({ id: 'later-effective', status: S.PAST_DUE, effectiveAt: 5_001, version: 5 }));
  assert.equal(sameVersionLaterEffective.changed, true);
  assert.equal(sameVersionLaterEffective.record.status, S.PAST_DUE);
  assert.equal(isProAllowed(sameVersionLaterEffective.record, NOW), false);
});

test('deriveEntitlementState/isProAllowed fail closed at expiry boundaries and malformed expiresAt values', () => {
  assert.equal(deriveEntitlementState({ status: S.ACTIVE, expiresAt: NOW + 1 }, NOW), S.ACTIVE);
  assert.equal(isProAllowed({ status: S.ACTIVE, expiresAt: NOW + 1 }, NOW), true);

  for (const expiresAt of [NOW, NOW - 1, -1, 0, Number.NaN, Number.POSITIVE_INFINITY, '20000']) {
    const record = { status: S.ACTIVE, expiresAt };
    assert.equal(deriveEntitlementState(record, NOW), S.EXPIRED, `expiresAt=${String(expiresAt)} should derive expired`);
    assert.equal(isProAllowed(record, NOW), false, `expiresAt=${String(expiresAt)} should deny Pro`);
  }
});

test('prototype-pollution and type-confusion inputs are handled without throwing or granting Pro', () => {
  const pollutedRecord = JSON.parse('{"status":"active","expiresAt":0,"__proto__":{"status":"active"}}');
  const confusedRecords = [
    pollutedRecord,
    [],
    42,
    'active',
    { status: ['active'] },
    { status: 1 },
    { status: new String(S.ACTIVE) },
  ];

  for (const record of confusedRecords) {
    assertNoThrow(() => deriveEntitlementState(record, NOW), `derive should not throw for ${Object.prototype.toString.call(record)}`);
    assertNoThrow(() => isProAllowed(record, NOW), `isProAllowed should not throw for ${Object.prototype.toString.call(record)}`);
    assert.equal(isProAllowed(record, NOW), false, `confused record ${Object.prototype.toString.call(record)} must deny Pro`);
  }

  const validCurrent = mustRecord(applyEntitlementEvent(null, event({ id: 'seed', status: S.CANCELLED, effectiveAt: 1_000, version: 1 })));
  const confusedEvents = [
    JSON.parse('{"id":"polluted","status":"active","effectiveAt":2000,"version":2,"subscriptionId":"sub-1","__proto__":{"subscriptionId":"sub-2"}}'),
    [],
    42,
    'event',
    { id: 'array-status', status: ['active'], effectiveAt: 2_000, version: 2 },
    { id: 'string-object-status', status: new String(S.ACTIVE), effectiveAt: 2_000, version: 2 },
  ];

  for (const candidate of confusedEvents) {
    assertNoThrow(() => applyEntitlementEvent(validCurrent, candidate), `apply should not throw for ${Object.prototype.toString.call(candidate)}`);
    const result = applyEntitlementEvent(validCurrent, candidate);
    assertNotAllowedResult(result, `confused event ${Object.prototype.toString.call(candidate)}`);
  }
});

test('hashLicenseKey does not echo raw keys and throws without a secret', () => {
  const raw = 'LEMON-SUPER-SECRET-RAW-KEY';
  const digest = hashLicenseKey('server-secret', raw);

  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(digest.includes(raw), false);
  assert.throws(() => hashLicenseKey('', raw), /secret/);
});

test('applyEntitlementEvent never mutates input record or event objects', () => {
  const current = Object.freeze({
    status: S.CANCELLED,
    effectiveAt: 1_000,
    version: 1,
    lastEventId: 'cancelled',
    subscriptionId: 'sub-1',
    expiresAt: 2_000,
  });
  const candidate = Object.freeze(event({ id: 'attempt', status: S.ACTIVE, effectiveAt: 2_000, version: 2 }));
  const currentSnapshot = JSON.stringify(current);
  const eventSnapshot = JSON.stringify(candidate);

  const result = applyEntitlementEvent(current, candidate);

  assert.equal(result.changed, false);
  assert.equal(JSON.stringify(current), currentSnapshot);
  assert.equal(JSON.stringify(candidate), eventSnapshot);
});
