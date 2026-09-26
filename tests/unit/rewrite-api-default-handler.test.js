// @ts-check
// The default export builds its handler once per process. node --test runs
// each file in its own process, so these tests own that handler: keep every
// other default-export caller out of this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../../api/rewrite.js';
import { QUOTA_REASONS, TIER_LIMITS } from '../../src/web-rewrite-contract.js';

// Non-production memory posture with no free key: every request is admitted
// and metered by the limiter, then refused before any provider call.
const LOCAL_ENV = {
  NODE_ENV: 'test', VERCEL: undefined, VERCEL_ENV: undefined, KV_REST_API_URL: undefined, KV_REST_API_TOKEN: undefined,
  PATINA_FREE_API_KEY: undefined, PATINA_DEPLOYMENT_CHANNEL: undefined, PATINA_WEB_REWRITE_TIMEOUT_MS: undefined,
};

/** @param {Record<string, string|undefined>} overrides @param {() => Promise<void>} fn */
async function withEnv(overrides, fn) {
  const old = Object.fromEntries(Object.keys(overrides).map((key) => [key, process.env[key]]));
  const apply = (/** @type {Record<string, string|undefined>} */ values) => {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  apply(overrides);
  try {
    await fn();
  } finally {
    apply(old);
  }
}

function makeReq() {
  return {
    method: 'POST',
    headers: { 'x-real-ip': '203.0.113.10' },
    body: JSON.stringify({ mode: 'first', lang: 'en', tier: 'free', text: 'Rewrite this sentence.' }),
  };
}

function makeRes() {
  const chunks = [];
  return {
    statusCode: 200,
    writableEnded: false,
    setHeader() {},
    on() { return this; },
    off() { return this; },
    write(/** @type {unknown} */ chunk) { chunks.push(String(chunk)); },
    end(/** @type {unknown} */ body = '') {
      if (body) chunks.push(String(body));
      this.writableEnded = true;
    },
    body() { return JSON.parse(chunks.join('')); },
  };
}

/** @returns {Promise<{status: number, error: string}>} */
async function send() {
  const res = makeRes();
  await handler(/** @type {any} */ (makeReq()), /** @type {any} */ (res));
  return { status: res.statusCode, error: res.body().error };
}

test('a handler construction error fails every request and is not cached', async () => {
  await withEnv({ ...LOCAL_ENV, PATINA_WEB_REWRITE_TIMEOUT_MS: '0' }, async () => {
    for (let i = 0; i < 2; i++) {
      await assert.rejects(send(), (err) => err instanceof TypeError && /PATINA_WEB_REWRITE_TIMEOUT_MS/.test(err.message));
    }
  });
});

test('the default handler keeps local quota state across requests', async () => {
  await withEnv(LOCAL_ENV, async () => {
    const { burstPerHour } = TIER_LIMITS.free;
    for (let i = 0; i < burstPerHour; i++) {
      assert.deepEqual(await send(), { status: 503, error: QUOTA_REASONS.SERVICE_UNAVAILABLE }, `request ${i + 1}`);
    }
    assert.deepEqual(await send(), { status: 429, error: QUOTA_REASONS.HOURLY });
  });
});
