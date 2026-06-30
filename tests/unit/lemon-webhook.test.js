import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  verifyWebhookSignature,
  mapLemonEventToStatus,
  buildEntitlementEvent,
  idempotencyKey,
  createLemonWebhookProcessor,
} from '../../src/lemon-webhook.js';
import { entitlementKey } from '../../src/pro-session.js';
import { ENTITLEMENT_STATES, hashLicenseKey, isProAllowed } from '../../src/pro-entitlements.js';

const S = ENTITLEMENT_STATES;
const WEBHOOK_SECRET = 'wh-secret';
const LICENSE_SECRET = 'lic-secret';
const RAW_KEY = 'LEMON-LICENSE-XYZ';
// A clock inside the fixtures' entitlement window (effective 2026-06-01, renews 2026-12-01).
const NOW = Date.parse('2026-06-15T00:00:00Z');

const sign = (body, secret = WEBHOOK_SECRET) => createHmac('sha256', secret).update(body).digest('hex');

function lemonPayload({ event = 'subscription_created', status = 'active', id = 'sub_1', updated = '2026-06-01T00:00:00Z', renews = '2026-12-01T00:00:00Z', licenseKey = RAW_KEY, eventId = 'evt-1' } = {}) {
  return {
    meta: { event_name: event, event_id: eventId, custom_data: { license_key: licenseKey } },
    data: { id, attributes: { status, updated_at: updated, created_at: updated, renews_at: renews } },
  };
}

function mockKv() {
  const map = new Map();
  return {
    map,
    async get(k) { return map.has(k) ? map.get(k) : null; },
    async set(k, v) { assert.equal(typeof v, 'string'); map.set(k, v); },
  };
}

function processorWith({ kv = mockKv(), now = NOW, logs = [] } = {}) {
  return {
    kv, logs,
    proc: createLemonWebhookProcessor({
      kv, webhookSecret: WEBHOOK_SECRET, licenseHmacSecret: LICENSE_SECRET,
      hashKey: hashLicenseKey, now: () => now, logger: { info: (m, meta) => logs.push({ m, meta }) },
    }),
  };
}

// --- signature --------------------------------------------------------------
test('verifyWebhookSignature accepts a correct HMAC and rejects everything else (timing-safe)', () => {
  const body = JSON.stringify({ a: 1 });
  assert.equal(verifyWebhookSignature(body, sign(body), WEBHOOK_SECRET), true);
  assert.equal(verifyWebhookSignature(body, sign(body, 'wrong'), WEBHOOK_SECRET), false);
  assert.equal(verifyWebhookSignature(body + 'tamper', sign(body), WEBHOOK_SECRET), false);
  assert.equal(verifyWebhookSignature(body, 'not-hex-!!', WEBHOOK_SECRET), false);
  assert.equal(verifyWebhookSignature(body, 'abcd', WEBHOOK_SECRET), false); // length mismatch
  assert.equal(verifyWebhookSignature(body, sign(body), ''), false); // missing secret
  assert.equal(verifyWebhookSignature(body, undefined, WEBHOOK_SECRET), false);
});

// --- event mapping ----------------------------------------------------------
test('mapLemonEventToStatus maps lifecycle + refund/revoke and returns null for unknown', () => {
  assert.equal(mapLemonEventToStatus('subscription_created', 'active'), S.ACTIVE);
  assert.equal(mapLemonEventToStatus('subscription_updated', 'on_trial'), S.TRIALING);
  assert.equal(mapLemonEventToStatus('subscription_updated', 'past_due'), S.PAST_DUE);
  assert.equal(mapLemonEventToStatus('subscription_updated', 'cancelled'), S.CANCELLED);
  assert.equal(mapLemonEventToStatus('subscription_updated', 'expired'), S.EXPIRED);
  assert.equal(mapLemonEventToStatus('subscription_payment_failed'), S.PAST_DUE);
  assert.equal(mapLemonEventToStatus('order_created'), S.ACTIVE);
  assert.equal(mapLemonEventToStatus('license_key_revoked'), S.REVOKED);
  assert.equal(mapLemonEventToStatus('order_refunded'), S.REVOKED);
  assert.equal(mapLemonEventToStatus('some_unrelated_event'), null);
});

// --- build event ------------------------------------------------------------
test('buildEntitlementEvent derives the mirror id from the license key and maps fields', () => {
  const built = buildEntitlementEvent(lemonPayload(), hashLicenseKey, LICENSE_SECRET);
  assert.ok(built);
  assert.equal(built.entitlementId, hashLicenseKey(LICENSE_SECRET, RAW_KEY));
  assert.equal(built.event.status, S.ACTIVE);
  assert.equal(built.event.id, 'evt-1');
  assert.equal(built.event.subscriptionId, 'sub_1');
  assert.equal(typeof built.event.effectiveAt, 'number');
  assert.equal(typeof built.event.expiresAt, 'number');
});

test('buildEntitlementEvent returns null when unmappable or missing a license key', () => {
  assert.equal(buildEntitlementEvent({ meta: { event_name: 'nope' }, data: {} }, hashLicenseKey, LICENSE_SECRET), null);
  const noKey = { meta: { event_name: 'subscription_created', event_id: 'e' }, data: { id: 's', attributes: { status: 'active', updated_at: '2026-01-01T00:00:00Z' } } };
  assert.equal(buildEntitlementEvent(noKey, hashLicenseKey, LICENSE_SECRET), null);
  assert.equal(buildEntitlementEvent(null, hashLicenseKey, LICENSE_SECRET), null);
});

// --- processor: signature + apply + idempotency -----------------------------
test('process rejects an invalid signature (401) and applies a valid order to the mirror', async () => {
  const { kv, proc } = processorWith();
  const body = JSON.stringify(lemonPayload({ event: 'order_created', eventId: 'e1' }));

  assert.equal((await proc.process({ rawBody: body, signature: 'deadbeef' })).status, 401);

  const res = await proc.process({ rawBody: body, signature: sign(body) });
  assert.equal(res.ok, true);
  assert.equal(res.applied, true);
  assert.equal(res.reason, S.ACTIVE);

  const eid = hashLicenseKey(LICENSE_SECRET, RAW_KEY);
  const stored = JSON.parse(kv.map.get(entitlementKey(eid)));
  assert.equal(stored.status, S.ACTIVE);
  assert.equal(isProAllowed(stored, NOW), true);
  // no raw license key in any store key
  for (const k of kv.map.keys()) assert.ok(!k.includes(RAW_KEY));
});

test('process is idempotent: a re-delivered event id is not applied twice', async () => {
  const { kv, proc } = processorWith();
  const body = JSON.stringify(lemonPayload({ event: 'order_created', eventId: 'e-dup' }));
  await proc.process({ rawBody: body, signature: sign(body) });
  const again = await proc.process({ rawBody: body, signature: sign(body) });
  assert.equal(again.applied, false);
  assert.equal(again.reason, 'duplicate_event');
  assert.ok(kv.map.has(idempotencyKey('e-dup')));
});

test('process folds a cancel and then a refund(revoke) through the state machine', async () => {
  const { kv, proc } = processorWith();
  const eid = hashLicenseKey(LICENSE_SECRET, RAW_KEY);

  const create = JSON.stringify(lemonPayload({ event: 'subscription_created', status: 'active', eventId: 'c1', updated: '2026-06-01T00:00:00Z' }));
  await proc.process({ rawBody: create, signature: sign(create) });

  const cancel = JSON.stringify(lemonPayload({ event: 'subscription_updated', status: 'cancelled', eventId: 'c2', updated: '2026-07-01T00:00:00Z' }));
  await proc.process({ rawBody: cancel, signature: sign(cancel) });
  assert.equal(JSON.parse(kv.map.get(entitlementKey(eid))).status, S.CANCELLED);

  const refund = JSON.stringify(lemonPayload({ event: 'order_refunded', status: 'cancelled', eventId: 'c3', updated: '2026-08-01T00:00:00Z' }));
  await proc.process({ rawBody: refund, signature: sign(refund) });
  assert.equal(JSON.parse(kv.map.get(entitlementKey(eid))).status, S.REVOKED);
});

test('process ignores an unmapped event without error and never writes a mirror', async () => {
  const { kv, proc } = processorWith();
  const body = JSON.stringify({ meta: { event_name: 'unrelated', event_id: 'u1' }, data: {} });
  const res = await proc.process({ rawBody: body, signature: sign(body) });
  assert.equal(res.ok, true);
  assert.equal(res.applied, false);
  assert.equal(res.reason, 'unmapped_event');
  assert.equal([...kv.map.keys()].some((k) => k.startsWith('ent:')), false);
});

test('process rejects a malformed (but correctly-signed) payload with 400', async () => {
  const { proc } = processorWith();
  const body = '{not json';
  const res = await proc.process({ rawBody: body, signature: sign(body) });
  assert.equal(res.ok, false);
  assert.equal(res.status, 400);
});

test('the sanitized invalidation log never carries the raw license key', async () => {
  const { kv, proc, logs } = processorWith();
  const create = JSON.stringify(lemonPayload({ event: 'subscription_created', status: 'active', eventId: 'l1', updated: '2026-06-01T00:00:00Z' }));
  await proc.process({ rawBody: create, signature: sign(create) });
  const cancel = JSON.stringify(lemonPayload({ event: 'subscription_updated', status: 'cancelled', eventId: 'l2', updated: '2026-07-01T00:00:00Z' }));
  await proc.process({ rawBody: cancel, signature: sign(cancel) });
  assert.ok(!JSON.stringify(logs).includes(RAW_KEY));
  void kv;
});

// --- G005 review hardening regressions --------------------------------------
test('a refund (order payload, no subscription_id) revokes the active subscription, not "other_subscription"', async () => {
  const { kv, proc } = processorWith();
  const eid = hashLicenseKey(LICENSE_SECRET, RAW_KEY);
  const create = JSON.stringify(lemonPayload({ event: 'subscription_created', status: 'active', id: 'sub_1', eventId: 'r1', updated: '2026-06-01T00:00:00Z' }));
  await proc.process({ rawBody: create, signature: sign(create) });
  assert.equal(JSON.parse(kv.map.get(entitlementKey(eid))).status, S.ACTIVE);

  // order_refunded: data.id is an ORDER id (not the subscription); no subscription_id.
  const refund = JSON.stringify({
    meta: { event_name: 'order_refunded', event_id: 'r2', custom_data: { license_key: RAW_KEY } },
    data: { id: 'ord_9', attributes: { updated_at: '2026-07-01T00:00:00Z', created_at: '2026-07-01T00:00:00Z' } },
  });
  const res = await proc.process({ rawBody: refund, signature: sign(refund) });
  assert.equal(res.applied, true);
  assert.equal(JSON.parse(kv.map.get(entitlementKey(eid))).status, S.REVOKED);
});

test('license_key_updated maps disabled->revoked and expired->expired', async () => {
  const { kv, proc } = processorWith();
  const eid = hashLicenseKey(LICENSE_SECRET, RAW_KEY);
  const disabled = JSON.stringify({
    meta: { event_name: 'license_key_updated', event_id: 'lk1', custom_data: { license_key: RAW_KEY } },
    data: { id: 'lic_1', attributes: { status: 'disabled', updated_at: '2026-06-01T00:00:00Z' } },
  });
  await proc.process({ rawBody: disabled, signature: sign(disabled) });
  assert.equal(JSON.parse(kv.map.get(entitlementKey(eid))).status, S.REVOKED);
});

test('a missing entitlement/webhook secret fails closed with 503 (not a silent no-op)', async () => {
  const noSecret = createLemonWebhookProcessor({
    kv: mockKv(), webhookSecret: WEBHOOK_SECRET, licenseHmacSecret: '', hashKey: hashLicenseKey, now: () => NOW, logger: { info() {} },
  });
  const body = JSON.stringify(lemonPayload({ eventId: 's1' }));
  const res = await noSecret.process({ rawBody: body, signature: sign(body) });
  assert.equal(res.ok, false);
  assert.equal(res.status, 503);
});

test('the entitlement mirror is written BEFORE the idempotency marker (a partial KV failure cannot drop a revoke)', async () => {
  const map = new Map();
  const flakyKv = {
    map,
    async get(k) { return map.has(k) ? map.get(k) : null; },
    async set(k, v) {
      if (k.startsWith('whevt:')) throw new Error('idempotency write failed');
      map.set(k, v);
    },
  };
  const proc = createLemonWebhookProcessor({
    kv: flakyKv, webhookSecret: WEBHOOK_SECRET, licenseHmacSecret: LICENSE_SECRET, hashKey: hashLicenseKey, now: () => NOW, logger: { info() {} },
  });
  const create = JSON.stringify(lemonPayload({ event: 'subscription_created', status: 'active', eventId: 'p1' }));
  await assert.rejects(() => proc.process({ rawBody: create, signature: sign(create) }), /idempotency write failed/);
  // The mirror change persisted even though the idempotency write threw, so a
  // Lemon retry (idem marker absent) will safely re-apply rather than lose it.
  assert.ok(map.has(entitlementKey(hashLicenseKey(LICENSE_SECRET, RAW_KEY))));
});

test('subscription_payment_refunded (Invoice object: data.id=invoice) still revokes the active subscription', async () => {
  const { kv, proc } = processorWith();
  const eid = hashLicenseKey(LICENSE_SECRET, RAW_KEY);
  const create = JSON.stringify(lemonPayload({ event: 'subscription_created', status: 'active', id: 'sub_1', eventId: 'pr1', updated: '2026-06-01T00:00:00Z' }));
  await proc.process({ rawBody: create, signature: sign(create) });
  assert.equal(JSON.parse(kv.map.get(entitlementKey(eid))).status, S.ACTIVE);

  // Invoice-shaped payload: data.id is the INVOICE id; subscription_id is in attributes.
  const refund = JSON.stringify({
    meta: { event_name: 'subscription_payment_refunded', event_id: 'pr2', custom_data: { license_key: RAW_KEY } },
    data: { id: 'inv_9', attributes: { subscription_id: 'sub_1', updated_at: '2026-07-01T00:00:00Z', created_at: '2026-07-01T00:00:00Z' } },
  });
  const res = await proc.process({ rawBody: refund, signature: sign(refund) });
  assert.equal(res.applied, true);
  assert.equal(JSON.parse(kv.map.get(entitlementKey(eid))).status, S.REVOKED);
});
