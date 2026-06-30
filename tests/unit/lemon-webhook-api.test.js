import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createLemonWebhookApiHandler } from '../../api/lemon-webhook.js';
import { entitlementKey } from '../../src/pro-session.js';
import { hashLicenseKey } from '../../src/pro-entitlements.js';

const WEBHOOK_SECRET = 'wh-secret';
const LICENSE_SECRET = 'lic-secret';
const RAW_KEY = 'LEMON-API-KEY';
const NOW = Date.parse('2026-06-15T00:00:00Z');

const sign = (body) => createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');

function body(eventId) {
  return JSON.stringify({
    meta: { event_name: 'order_created', event_id: eventId, custom_data: { license_key: RAW_KEY } },
    data: { id: 'sub_1', attributes: { status: 'active', updated_at: '2026-06-01T00:00:00Z', created_at: '2026-06-01T00:00:00Z', renews_at: '2026-12-01T00:00:00Z' } },
  });
}

function mockKv() {
  const map = new Map();
  return { map, async get(k) { return map.has(k) ? map.get(k) : null; }, async set(k, v) { map.set(k, v); } };
}
function mockRes() {
  return { statusCode: 0, headers: {}, body: undefined, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(p) { this.body = p; } };
}
function makeHandler(kv = mockKv()) {
  return {
    kv,
    handler: createLemonWebhookApiHandler({
      env: { PATINA_LEMON_WEBHOOK_SECRET: WEBHOOK_SECRET, PATINA_PRO_HMAC_SECRET: LICENSE_SECRET },
      kv,
      logger: { info() {} },
      now: () => NOW,
    }),
  };
}

test('a correctly-signed POST applies the entitlement and returns 200 (no-store)', async () => {
  const { kv, handler } = makeHandler();
  const b = body('api-e1');
  const res = mockRes();
  await handler({ method: 'POST', headers: { 'X-Signature': sign(b) }, body: b }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(JSON.parse(res.body).applied, true);
  assert.ok(kv.map.has(entitlementKey(hashLicenseKey(LICENSE_SECRET, RAW_KEY))));
});

test('an invalid signature is rejected 401 and writes nothing', async () => {
  const { kv, handler } = makeHandler();
  const b = body('api-e2');
  const res = mockRes();
  await handler({ method: 'POST', headers: { 'x-signature': 'deadbeef' }, body: b }, res);
  assert.equal(res.statusCode, 401);
  assert.equal([...kv.map.keys()].some((k) => k.startsWith('ent:')), false);
});

test('non-POST is 405', async () => {
  const { handler } = makeHandler();
  const res = mockRes();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 405);
});

test('production without a REST KV fails closed with 503', async () => {
  const handler = createLemonWebhookApiHandler({
    env: { PATINA_LEMON_WEBHOOK_SECRET: WEBHOOK_SECRET, PATINA_PRO_HMAC_SECRET: LICENSE_SECRET, VERCEL_ENV: 'production' },
    now: () => NOW,
  });
  const res = mockRes();
  await handler({ method: 'POST', headers: {}, body: body('api-e3') }, res);
  assert.equal(res.statusCode, 503);
});
