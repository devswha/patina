import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRewriteApiHandler } from '../../api/rewrite.js';
import { parseStreamFrame, STREAM_FRAME_TYPES, MPS_FLOOR, FIDELITY_FLOOR } from '../../src/web-rewrite-contract.js';
import { hashSessionToken, sessionKey, entitlementKey, PRO_SESSION_TTL_MS, PRO_SESSION_ABSOLUTE_TTL_MS } from '../../src/pro-session.js';
import { ENTITLEMENT_STATES } from '../../src/pro-entitlements.js';

const S = ENTITLEMENT_STATES;
const SECRET = 'redteam-pro-secret';
const TOKEN = 'redteam-opaque-pro-token';
const RAW_KEY = 'sk-redteam-raw-key-should-not-leak';
const EMAIL = 'victim@example.test';
const NOW = 1_000_000;
const PRO_ENV = Object.freeze({
  PATINA_PRO_ENABLED: 'true',
  PATINA_PRO_PROVIDER: 'openai',
  PATINA_PRO_MODEL: 'gpt-5.5',
  PATINA_PRO_HMAC_SECRET: SECRET,
  PATINA_FREE_API_KEY: 'sk-free-redteam',
});

const mockKv = ({ incrImpl } = {}) => {
  const map = new Map();
  return {
    map,
    get: async (k) => (map.has(k) ? map.get(k) : null),
    set: async (k, v) => { map.set(k, v); },
    incr: async (k, opts) => {
      if (incrImpl) return incrImpl(k, opts, map);
      const n = (map.get(k) ?? 0) + 1;
      map.set(k, n);
      return n;
    },
  };
};

const seed = (kv, {
  token = TOKEN,
  entitlementId = 'eid-redteam',
  status = S.ACTIVE,
  session = {},
  entitlement = {},
} = {}) => {
  kv.map.set(entitlementKey(entitlementId), JSON.stringify({
    status,
    effectiveAt: 0,
    version: 0,
    subscriptionId: 'sub_redteam',
    ...entitlement,
  }));
  kv.map.set(sessionKey(hashSessionToken(SECRET, token)), JSON.stringify({
    entitlementId,
    issuedAt: NOW,
    expiresAt: NOW + PRO_SESSION_TTL_MS,
    absoluteExpiresAt: NOW + PRO_SESSION_ABSOLUTE_TTL_MS,
    ...session,
  }));
};

const req = (body) => ({
  method: 'POST',
  headers: { 'x-real-ip': '1.2.3.4' },
  async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body), 'utf8'); },
});

const proBody = (overrides = {}) => ({
  mode: 'first',
  lang: 'ko',
  tier: 'pro',
  text: '안녕하세요 redteam',
  proSessionToken: TOKEN,
  ...overrides,
});

const mockRes = () => ({
  statusCode: 0,
  headers: {},
  chunks: [],
  setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
  write(c) { this.chunks.push(String(c)); return true; },
  end(c) { if (c != null) this.chunks.push(String(c)); },
  body() { return this.chunks.join(''); },
  frames() { return this.body().split('\n').filter(Boolean).map(parseStreamFrame).filter(Boolean); },
  json() { try { return JSON.parse(this.body()); } catch { return null; } },
});

const createLogger = () => {
  const entries = [];
  return {
    entries,
    info: (...args) => { entries.push(['info', ...args]); },
    warn: (...args) => { entries.push(['warn', ...args]); },
    error: (...args) => { entries.push(['error', ...args]); },
    text: () => JSON.stringify(entries),
  };
};

const makeHandler = ({ kv = mockKv(), env = PRO_ENV, enhancedEngine, runWebRewriteStreamImpl, logger = createLogger() } = {}) => ({
  kv,
  logger,
  handler: createRewriteApiHandler({ env, kv, enhancedEngine, runWebRewriteStreamImpl, logger, now: () => NOW }),
});

const assertNoStream = (res) => {
  assert.equal(res.headers['content-type'], 'application/json');
  assert.ok(!res.frames().some((f) => f.type === STREAM_FRAME_TYPES.START || f.type === STREAM_FRAME_TYPES.DELTA || f.type === STREAM_FRAME_TYPES.DONE));
};

const assertNoLeak = (res, logger, forbidden = [TOKEN, RAW_KEY, EMAIL, SECRET]) => {
  const observed = `${res.body()}\n${logger.text()}`;
  for (const secret of forbidden) assert.ok(!observed.includes(secret), `leaked ${secret}`);
};

test('invalid, forged, and empty proSessionToken cannot obtain enhanced output', async () => {
  for (const body of [proBody(), proBody({ proSessionToken: 'forged-token' }), proBody({ proSessionToken: '' })]) {
    const kv = mockKv();
    if (body.proSessionToken !== TOKEN) seed(kv);
    const logger = createLogger();
    const { handler } = makeHandler({ kv, logger });
    const res = mockRes();
    await handler(req(body), res);
    assert.equal(res.statusCode, body.proSessionToken === '' ? 400 : 401);
    assertNoStream(res);
    assertNoLeak(res, logger);
  }
});

test('sliding-expired and absolute-expired sessions fail closed with 401', async () => {
  for (const session of [{ expiresAt: NOW }, { absoluteExpiresAt: NOW }]) {
    const kv = mockKv();
    seed(kv, { session });
    const logger = createLogger();
    const { handler } = makeHandler({ kv, logger });
    const res = mockRes();
    await handler(req(proBody()), res);
    assert.equal(res.statusCode, 401);
    assertNoStream(res);
    assertNoLeak(res, logger);
  }
});

test('non-paying entitlement states deny pro with 402 even for time-valid sessions', async () => {
  for (const status of [S.CANCELLED, S.REVOKED, S.EXPIRED, S.PAST_DUE, S.NONE]) {
    const kv = mockKv();
    seed(kv, { status });
    const logger = createLogger();
    const { handler } = makeHandler({ kv, logger });
    const res = mockRes();
    await handler(req(proBody()), res);
    assert.equal(res.statusCode, 402, status);
    assertNoStream(res);
    assertNoLeak(res, logger);
  }
});

test('metering day, hour, and minute caps deny with 429', async () => {
  const cases = [
    { label: 'day', match: ':d:', allowedBeforeDeny: 100, reason: 'daily cap exceeded' },
    { label: 'hour', match: ':h:', allowedBeforeDeny: 20, reason: 'hourly cap exceeded' },
    { label: 'minute', match: ':m:', allowedBeforeDeny: 6, reason: 'rate too high' },
  ];
  for (const c of cases) {
    const kv = mockKv({ incrImpl: async (k, _opts, map) => {
      const prior = map.get(k) ?? 0;
      const next = k.includes(c.match) ? c.allowedBeforeDeny + 1 : prior + 1;
      map.set(k, next);
      return next;
    } });
    seed(kv);
    const logger = createLogger();
    const { handler } = makeHandler({ kv, logger });
    const res = mockRes();
    await handler(req(proBody()), res);
    assert.equal(res.statusCode, 429, c.label);
    assert.equal(res.json().error, c.reason);
    assertNoStream(res);
    assertNoLeak(res, logger);
  }
});

test('malformed metering counter fails closed with 503, not fail-open', async () => {
  const kv = mockKv({ incrImpl: async () => 'not-a-counter' });
  seed(kv);
  const logger = createLogger();
  const { handler } = makeHandler({ kv, logger });
  const res = mockRes();
  await handler(req(proBody()), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().error, 'metering storage unavailable');
  assertNoStream(res);
  assertNoLeak(res, logger);
});

test('pro failures never silently downgrade to free or BYOK and never call shared LLM runner', async () => {
  let llmCalls = 0;
  const kv = mockKv();
  seed(kv, { status: S.REVOKED });
  const logger = createLogger();
  const { handler } = makeHandler({
    kv,
    logger,
    runWebRewriteStreamImpl: async () => { llmCalls += 1; },
  });
  const res = mockRes();
  await handler(req(proBody({ apiKey: RAW_KEY, licenseKey: RAW_KEY, email: EMAIL })), res);
  assert.equal(res.statusCode, 400);
  assertNoStream(res);
  assert.equal(llmCalls, 0);
  assertNoLeak(res, logger);
});

test('pro errors and logs do not expose raw token, raw key, email, or hmac secret', async () => {
  const kv = mockKv();
  seed(kv, { entitlement: { email: EMAIL, rawKey: RAW_KEY } });
  const logger = createLogger();
  const enhancedEngine = {
    kind: 'redteam-engine',
    isAvailable: () => true,
    rewrite: async () => { throw new Error(`boom ${TOKEN} ${RAW_KEY} ${EMAIL} ${SECRET}`); },
  };
  const { handler } = makeHandler({ kv, logger, enhancedEngine });
  const res = mockRes();
  await handler(req(proBody()), res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.json().error, 'pro engine error');
  assertNoStream(res);
  assertNoLeak(res, logger);
});

test('pro misconfiguration and engine failures fail closed before streaming', async () => {
  const cases = [
    { label: 'missing secret', env: { PATINA_PRO_ENABLED: 'true', PATINA_PRO_PROVIDER: 'openai', PATINA_PRO_MODEL: 'gpt-5.5' }, expected: 'pro service unavailable' },
    { label: 'unavailable engine', enhancedEngine: { kind: 'down', isAvailable: () => false, rewrite: async () => ({ text: 'bad', scores: {} }) }, expected: 'pro engine unavailable' },
    { label: 'throwing engine', enhancedEngine: { kind: 'throws', isAvailable: () => true, rewrite: async () => { throw new Error('private failure'); } }, expected: 'pro engine error' },
  ];
  for (const c of cases) {
    const kv = mockKv();
    seed(kv);
    const logger = createLogger();
    const { handler } = makeHandler({ kv, logger, env: c.env ?? PRO_ENV, enhancedEngine: c.enhancedEngine });
    const res = mockRes();
    await handler(req(proBody()), res);
    assert.equal(res.statusCode, 503, c.label);
    assert.equal(res.json().error, c.expected);
    assertNoStream(res);
    assertNoLeak(res, logger);
  }
});

test('gate-off free and BYOK paths still call the shared stream runner', async () => {
  let calls = 0;
  const runWebRewriteStreamImpl = async ({ emit }) => {
    calls += 1;
    emit({ type: STREAM_FRAME_TYPES.START });
    emit({ type: STREAM_FRAME_TYPES.DONE, scores: { mps: 90, fidelity: 90 } });
  };
  const { handler } = makeHandler({
    env: { PATINA_FREE_API_KEY: 'sk-free-redteam', PATINA_FREE_PROVIDER: 'openai', PATINA_FREE_MODEL: 'gpt-5.5' },
    runWebRewriteStreamImpl,
  });
  const freeRes = mockRes();
  await handler(req({ mode: 'first', lang: 'ko', tier: 'free', text: '무료 경로' }), freeRes);
  assert.equal(freeRes.statusCode, 200);
  assert.ok(freeRes.frames().some((f) => f.type === STREAM_FRAME_TYPES.DONE));

  const byokRes = mockRes();
  await handler(req({ mode: 'first', lang: 'ko', tier: 'byok', text: '바이오케이 경로', provider: 'openai', model: 'gpt-5.5', apiKey: RAW_KEY }), byokRes);
  assert.equal(byokRes.statusCode, 200);
  assert.ok(byokRes.frames().some((f) => f.type === STREAM_FRAME_TYPES.DONE));
  assert.equal(calls, 2);
});

test('stub pro output makes no quality claim beyond exact floor scores', async () => {
  const kv = mockKv();
  seed(kv);
  const { handler } = makeHandler({ kv });
  const res = mockRes();
  await handler(req(proBody()), res);
  assert.equal(res.statusCode, 200);
  const frames = res.frames();
  const delta = frames.find((f) => f.type === STREAM_FRAME_TYPES.DELTA);
  const done = frames.find((f) => f.type === STREAM_FRAME_TYPES.DONE);
  assert.equal(delta.text, proBody().text);
  assert.deepEqual(done.scores, { mps: MPS_FLOOR, fidelity: FIDELITY_FLOOR });
});
