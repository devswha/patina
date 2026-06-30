import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRewriteApiHandler } from '../../api/rewrite.js';
import { parseStreamFrame, STREAM_FRAME_TYPES } from '../../src/web-rewrite-contract.js';
import { hashSessionToken, sessionKey, entitlementKey, PRO_SESSION_TTL_MS, PRO_SESSION_ABSOLUTE_TTL_MS } from '../../src/pro-session.js';
import { ENTITLEMENT_STATES } from '../../src/pro-entitlements.js';

const S = ENTITLEMENT_STATES;
const SECRET = 'pro-path-secret';
const TOKEN = 'opaque-pro-token-abc';
const NOW = 1_000_000;

const PRO_ENV = Object.freeze({
  PATINA_PRO_ENABLED: 'true',
  PATINA_PRO_PROVIDER: 'openai',
  PATINA_PRO_MODEL: 'gpt-5.5',
  PATINA_PRO_HMAC_SECRET: SECRET,
});

function mockKv() {
  const map = new Map();
  return { map, async get(k) { return map.has(k) ? map.get(k) : null; }, async set(k, v) { map.set(k, v); }, async incr(k) { const n = (map.get(k) ?? 0) + 1; map.set(k, n); return n; } };
}

/** Seed an active entitlement + a valid session bound to it. */
function seed(kv, { entitlementId = 'eid-1', status = S.ACTIVE } = {}) {
  kv.map.set(entitlementKey(entitlementId), JSON.stringify({ status, effectiveAt: 0, version: 0, subscriptionId: 'sub_1' }));
  kv.map.set(sessionKey(hashSessionToken(SECRET, TOKEN)), JSON.stringify({
    entitlementId, issuedAt: NOW, expiresAt: NOW + PRO_SESSION_TTL_MS, absoluteExpiresAt: NOW + PRO_SESSION_ABSOLUTE_TTL_MS,
  }));
}

function proReq(overrides = {}) {
  const body = JSON.stringify({ mode: 'first', lang: 'ko', tier: 'pro', text: '안녕하세요 테스트', proSessionToken: TOKEN, ...overrides });
  return {
    method: 'POST',
    headers: { 'x-real-ip': '1.2.3.4' },
    async *[Symbol.asyncIterator]() { yield Buffer.from(body, 'utf8'); },
  };
}
function mockRes() {
  return {
    statusCode: 0, headers: {}, chunks: [],
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    write(c) { this.chunks.push(String(c)); return true; },
    end(c) { if (c != null) this.chunks.push(String(c)); },
    frames() { return this.chunks.join('').split('\n').filter(Boolean).map(parseStreamFrame).filter(Boolean); },
    json() { try { return JSON.parse(this.chunks.join('')); } catch { return null; } },
  };
}
function makeHandler(kv) {
  return createRewriteApiHandler({ env: PRO_ENV, kv, logger: { info() {}, error() {} }, now: () => NOW });
}

test('a valid pro request streams start/delta/done from the enhanced (stub) engine', async () => {
  const kv = mockKv();
  seed(kv);
  const res = mockRes();
  await makeHandler(kv)(proReq(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  const frames = res.frames();
  assert.equal(frames[0].type, STREAM_FRAME_TYPES.START);
  assert.ok(frames.some((f) => f.type === STREAM_FRAME_TYPES.DELTA && typeof f.text === 'string'));
  const done = frames.find((f) => f.type === STREAM_FRAME_TYPES.DONE);
  assert.ok(done && done.scores && typeof done.scores.mps === 'number');
});

test('an unknown/invalid pro session token fails closed 401 (no stream)', async () => {
  const kv = mockKv(); // nothing seeded -> no session record
  const res = mockRes();
  await makeHandler(kv)(proReq(), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error, 'pro session not valid');
});

test('a revoked entitlement fails closed 402 even with a time-valid session', async () => {
  const kv = mockKv();
  seed(kv, { status: S.REVOKED });
  const res = mockRes();
  await makeHandler(kv)(proReq(), res);
  assert.equal(res.statusCode, 402);
});

test('metering caps a burst: the 7th pro request in a minute is 429', async () => {
  const kv = mockKv();
  seed(kv);
  const handler = makeHandler(kv);
  for (let i = 0; i < 6; i++) {
    const res = mockRes();
    await handler(proReq(), res);
    assert.equal(res.statusCode, 200, `request ${i + 1} should pass`);
  }
  const over = mockRes();
  await handler(proReq(), over);
  assert.equal(over.statusCode, 429);
});

test('missing PATINA_PRO_HMAC_SECRET fails closed 503', async () => {
  const kv = mockKv();
  seed(kv);
  const handler = createRewriteApiHandler({
    env: { PATINA_PRO_ENABLED: 'true', PATINA_PRO_PROVIDER: 'openai', PATINA_PRO_MODEL: 'gpt-5.5' },
    kv, logger: { info() {}, error() {} }, now: () => NOW,
  });
  const res = mockRes();
  await handler(proReq(), res);
  assert.equal(res.statusCode, 503);
});

test('gate-off: a free request through the same handler is unaffected by the pro path', async () => {
  // With the gate off and a free tier, validation/flow is the existing path.
  const kv = mockKv();
  const handler = createRewriteApiHandler({ env: { PATINA_FREE_API_KEY: 'sk-free', KV_REST_API_URL: undefined }, kv, logger: { info() {}, error() {} }, now: () => NOW, runWebRewriteStreamImpl: async ({ emit }) => { emit({ type: STREAM_FRAME_TYPES.START }); emit({ type: STREAM_FRAME_TYPES.DONE, scores: { mps: 90, fidelity: 90 } }); } });
  const body = JSON.stringify({ mode: 'first', lang: 'ko', tier: 'free', text: '안녕하세요' });
  const req = { method: 'POST', headers: { 'x-real-ip': '9.9.9.9' }, async *[Symbol.asyncIterator]() { yield Buffer.from(body, 'utf8'); } };
  const res = mockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.ok(res.frames().some((f) => f.type === STREAM_FRAME_TYPES.DONE));
});

test('a KV outage during the pro lookup fails closed 503 (not a generic 500, not free/BYOK)', async () => {
  const throwingKv = { async get() { throw new Error('kv down'); }, async set() {}, async incr() { return 1; } };
  const res = mockRes();
  await makeHandler(throwingKv)(proReq(), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().error, 'pro session storage unavailable');
  // no success stream frames
  assert.equal(res.frames().some((f) => f.type === STREAM_FRAME_TYPES.DONE), false);
});
