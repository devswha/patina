import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { createLemonWebhookProcessor, idempotencyKey } from '../../src/lemon-webhook.js';
import { createLemonWebhookApiHandler } from '../../api/lemon-webhook.js';
import { entitlementKey } from '../../src/pro-session.js';
import { ENTITLEMENT_STATES, hashLicenseKey, isProAllowed } from '../../src/pro-entitlements.js';

const WEBHOOK_SECRET = 'redteam-webhook-secret';
const OTHER_WEBHOOK_SECRET = 'attacker-secret';
const LICENSE_SECRET = 'redteam-license-secret';
const RAW_KEY = 'LEMON-REDTEAM-RAW-KEY';
const OTHER_RAW_KEY = 'LEMON-REDTEAM-OTHER-KEY';
const EMAIL = 'victim@example.test';
const NOW = Date.parse('2026-06-15T00:00:00Z');
const FUTURE_RENEWS = '2026-12-01T00:00:00Z';

const sign = (body, secret = WEBHOOK_SECRET) => createHmac('sha256', secret).update(body).digest('hex');

const payload = ({
  event = 'subscription_created',
  status = 'active',
  id = 'sub_redteam',
  eventId = 'evt-redteam',
  updated = '2026-06-01T00:00:00Z',
  renews = FUTURE_RENEWS,
  licenseKey = RAW_KEY,
  email = EMAIL,
  extraMeta = {},
  extraAttrs = {},
} = {}) => ({
  meta: {
    event_name: event,
    event_id: eventId,
    custom_data: licenseKey == null ? { ...extraMeta } : { license_key: licenseKey, ...extraMeta },
  },
  data: {
    id,
    attributes: {
      status,
      updated_at: updated,
      created_at: updated,
      renews_at: renews,
      user_email: email,
      email,
      ...extraAttrs,
    },
  },
});

const mockKv = () => {
  const map = new Map();
  const writes = [];
  return {
    map,
    writes,
    get: async (key) => (map.has(key) ? map.get(key) : null),
    set: async (key, value, options) => {
      assert.equal(typeof value, 'string');
      writes.push({ key, value, options });
      map.set(key, value);
    },
  };
};

const processorWith = ({ kv = mockKv(), logs = [] } = {}) => ({
  kv,
  logs,
  proc: createLemonWebhookProcessor({
    kv,
    webhookSecret: WEBHOOK_SECRET,
    licenseHmacSecret: LICENSE_SECRET,
    hashKey: hashLicenseKey,
    now: () => NOW,
    logger: { info: (message, meta) => logs.push({ message, meta }), warn: (message, meta) => logs.push({ message, meta }) },
  }),
});

const mockRes = () => ({
  statusCode: 0,
  headers: {},
  body: undefined,
  setHeader(key, value) { this.headers[key.toLowerCase()] = value; },
  end(payloadText) { this.body = payloadText; },
});

const apiHandlerWith = ({ kv = mockKv(), env = {}, logs = [] } = {}) => ({
  kv,
  logs,
  handler: createLemonWebhookApiHandler({
    env: { PATINA_LEMON_WEBHOOK_SECRET: WEBHOOK_SECRET, PATINA_PRO_HMAC_SECRET: LICENSE_SECRET, ...env },
    kv,
    logger: { info: (message, meta) => logs.push({ message, meta }), warn: (message, meta) => logs.push({ message, meta }) },
    now: () => NOW,
  }),
});

const storedEntitlement = (kv, rawKey = RAW_KEY) => {
  const id = hashLicenseKey(LICENSE_SECRET, rawKey);
  const value = kv.map.get(entitlementKey(id));
  return value == null ? null : JSON.parse(value);
};

const allStoredText = (kv) => JSON.stringify({ keys: [...kv.map.keys()], values: [...kv.map.values()], writes: kv.writes });

const assertNoMirrorWrites = (kv) => {
  assert.equal([...kv.map.keys()].some((key) => key.startsWith('ent:')), false);
};

test('forged signatures are rejected 401 and never write the entitlement mirror', async () => {
  const attackCases = [
    { name: 'wrong hex signature', signature: '00'.repeat(32), mutate: (body) => body },
    { name: 'signature from another secret', signature: null, signer: OTHER_WEBHOOK_SECRET, mutate: (body) => body },
    { name: 'empty signature', signature: '', mutate: (body) => body },
    { name: 'non-hex signature', signature: 'not-a-hex-signature', mutate: (body) => body },
    { name: 'length mismatch', signature: 'abcd', mutate: (body) => body },
    { name: 'tampered body after signing', signature: null, mutate: (body) => body.replace('active', 'cancelled'), signBody: true },
  ];

  for (const attack of attackCases) {
    const { kv, proc } = processorWith();
    const originalBody = JSON.stringify(payload({ eventId: `forged-${attack.name}` }));
    const rawBody = attack.mutate(originalBody);
    const signature = attack.signature ?? sign(attack.signBody ? originalBody : rawBody, attack.signer ?? WEBHOOK_SECRET);
    const result = await proc.process({ rawBody, signature });

    assert.equal(result.ok, false, attack.name);
    assert.equal(result.status, 401, attack.name);
    assertNoMirrorWrites(kv);
    assert.equal(kv.map.size, 0, attack.name);
  }
});

test('replay of a valid signed event is idempotent and applies only once', async () => {
  const { kv, proc } = processorWith();
  const body = JSON.stringify(payload({ event: 'order_created', eventId: 'replay-once' }));

  const first = await proc.process({ rawBody: body, signature: sign(body) });
  const second = await proc.process({ rawBody: body, signature: sign(body) });

  assert.equal(first.applied, true);
  assert.equal(second.applied, false);
  assert.equal(second.reason, 'duplicate_event');
  assert.equal(kv.writes.filter((write) => write.key.startsWith('ent:')).length, 1);
  assert.ok(kv.map.has(idempotencyKey('replay-once')));
  assert.equal(isProAllowed(storedEntitlement(kv), NOW), true);
});

test('ordering attack cannot resurrect Pro after revoke with a same-subscription active event', async () => {
  const { kv, proc } = processorWith();
  const activeBody = JSON.stringify(payload({ eventId: 'order-1', updated: '2026-06-01T00:00:00Z' }));
  const revokeBody = JSON.stringify(payload({ event: 'license_key_revoked', status: 'cancelled', eventId: 'order-2', updated: '2026-06-02T00:00:00Z' }));
  const attackerActiveBody = JSON.stringify(payload({ event: 'subscription_updated', status: 'active', eventId: 'order-3', updated: '2026-06-03T00:00:00Z' }));

  assert.equal((await proc.process({ rawBody: activeBody, signature: sign(activeBody) })).applied, true);
  assert.equal((await proc.process({ rawBody: revokeBody, signature: sign(revokeBody) })).applied, true);
  const attack = await proc.process({ rawBody: attackerActiveBody, signature: sign(attackerActiveBody) });

  assert.equal(attack.applied, false);
  assert.equal(attack.reason, 'revoked_sticky');
  const record = storedEntitlement(kv);
  assert.equal(record.status, ENTITLEMENT_STATES.REVOKED);
  assert.equal(isProAllowed(record, NOW), false);
});

test('different license keys are isolated into different entitlement ids', async () => {
  const { kv, proc } = processorWith();
  const firstBody = JSON.stringify(payload({ eventId: 'isolate-1', licenseKey: RAW_KEY, id: 'sub_a' }));
  const secondBody = JSON.stringify(payload({ eventId: 'isolate-2', licenseKey: OTHER_RAW_KEY, id: 'sub_b' }));

  await proc.process({ rawBody: firstBody, signature: sign(firstBody) });
  await proc.process({ rawBody: secondBody, signature: sign(secondBody) });

  const firstId = hashLicenseKey(LICENSE_SECRET, RAW_KEY);
  const secondId = hashLicenseKey(LICENSE_SECRET, OTHER_RAW_KEY);
  assert.notEqual(firstId, secondId);
  assert.ok(kv.map.has(entitlementKey(firstId)));
  assert.ok(kv.map.has(entitlementKey(secondId)));
  assert.equal(JSON.parse(kv.map.get(entitlementKey(firstId))).subscriptionId, 'sub_a');
  assert.equal(JSON.parse(kv.map.get(entitlementKey(secondId))).subscriptionId, 'sub_b');
});

test('unmapped events and missing license keys are applied:false and never write a mirror', async () => {
  const cases = [
    JSON.stringify(payload({ event: 'unknown_event', eventId: 'unmapped-event' })),
    JSON.stringify(payload({ eventId: 'missing-key', licenseKey: null })),
  ];

  for (const body of cases) {
    const { kv, proc } = processorWith();
    const result = await proc.process({ rawBody: body, signature: sign(body) });

    assert.equal(result.ok, true);
    assert.equal(result.applied, false);
    assert.equal(result.reason, 'unmapped_event');
    assertNoMirrorWrites(kv);
  }
});

test('malformed JSON with a valid signature is rejected 400', async () => {
  const { kv, proc } = processorWith();
  const body = '{"meta":';
  const result = await proc.process({ rawBody: body, signature: sign(body) });

  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.equal(kv.map.size, 0);
});

test('raw license keys and emails never leak into store keys, stored values, logs, or return objects', async () => {
  const logs = [];
  const { kv, proc } = processorWith({ logs });
  const createBody = JSON.stringify(payload({ eventId: 'leak-create', email: EMAIL }));
  const cancelBody = JSON.stringify(payload({ event: 'subscription_updated', status: 'cancelled', eventId: 'leak-cancel', updated: '2026-07-01T00:00:00Z', email: EMAIL }));

  const createResult = await proc.process({ rawBody: createBody, signature: sign(createBody) });
  const cancelResult = await proc.process({ rawBody: cancelBody, signature: sign(cancelBody) });
  const combined = JSON.stringify({ store: allStoredText(kv), logs, createResult, cancelResult });

  assert.equal(combined.includes(RAW_KEY), false);
  assert.equal(combined.includes(EMAIL), false);
  assert.equal(createResult.applied, true);
  assert.equal(cancelResult.applied, true);
});

test('api rejects non-POST with 405 and always marks responses no-store', async () => {
  const { handler } = apiHandlerWith();
  const res = mockRes();

  await handler({ method: 'GET', headers: {} }, res);

  assert.equal(res.statusCode, 405);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(JSON.parse(res.body), { error: 'method not allowed' });
});

test('api fails closed with 503 in production when REST KV is unavailable', async () => {
  const logs = [];
  const handler = createLemonWebhookApiHandler({
    env: { PATINA_LEMON_WEBHOOK_SECRET: WEBHOOK_SECRET, PATINA_PRO_HMAC_SECRET: LICENSE_SECRET, VERCEL_ENV: 'production' },
    logger: { info: (message, meta) => logs.push({ message, meta }) },
    now: () => NOW,
  });
  const res = mockRes();

  await handler({ method: 'POST', headers: { 'x-signature': '00'.repeat(32) }, body: '{}' }, res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.deepEqual(JSON.parse(res.body), { error: 'webhook storage unavailable' });
});

test('api caps streaming request bodies over 64KB with 413', async () => {
  const { kv, handler } = apiHandlerWith();
  const oversized = Buffer.alloc((64 * 1024) + 1, 0x61);
  const req = Readable.from([oversized]);
  req.method = 'POST';
  req.headers = { 'x-signature': sign(oversized) };
  const res = mockRes();

  await handler(req, res);

  assert.equal(res.statusCode, 413);
  assert.equal(res.headers['cache-control'], 'no-store');
  assertNoMirrorWrites(kv);
});

test('prototype-pollution payload is parsed safely and does not poison Object.prototype', async () => {
  const { kv, proc } = processorWith();
  const body = `{"meta":{"event_name":"subscription_created","event_id":"pollution","custom_data":{"license_key":"${RAW_KEY}","__proto__":{"polluted":true}}},"data":{"id":"sub_redteam","attributes":{"status":"active","updated_at":"2026-06-01T00:00:00Z","created_at":"2026-06-01T00:00:00Z","renews_at":"${FUTURE_RENEWS}","constructor":{"prototype":{"polluted":true}}}}}`;

  const result = await proc.process({ rawBody: body, signature: sign(body) });

  assert.equal(result.ok, true);
  assert.equal(result.applied, true);
  assert.equal(Object.prototype.polluted, undefined);
  assert.equal(isProAllowed(storedEntitlement(kv), NOW), true);
});
