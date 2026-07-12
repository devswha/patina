// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import handler, { createRestKv, createRewriteApiHandler } from '../../api/rewrite.js';

function makeReq({ body = undefined, method = 'POST' } = {}) {
  return {
    method,
    headers: { 'x-real-ip': '203.0.113.10' },
    body: JSON.stringify(body ?? {
      mode: 'first',
      lang: 'en',
      tier: 'free',
      text: 'Rewrite this sentence.',
    }),
  };
}

function makeRes() {
  const headers = new Map();
  const chunks = [];
  /** @type {Map<string, Set<Function>>} */
  const listeners = new Map();
  return {
    statusCode: 200,
    writableEnded: false,
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), String(value));
    },
    getHeader(name) {
      return headers.get(String(name).toLowerCase());
    },
    write(chunk) {
      chunks.push(String(chunk));
    },
    end(body = '') {
      if (body) chunks.push(String(body));
      this.ended = true;
      this.writableEnded = true;
    },
    on(event, listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)?.add(listener);
      return this;
    },
    off(event, listener) {
      listeners.get(event)?.delete(listener);
      return this;
    },
    /** Simulate the runtime 'close' event (premature when writableEnded is false). */
    emitClose() {
      for (const listener of listeners.get('close') ?? []) listener();
    },
    chunks,
    ended: false,
  };
}

test('default api handler fails closed with 503 when production has no KV', async () => {
  const old = { NODE_ENV: process.env.NODE_ENV, VERCEL: process.env.VERCEL, KV_REST_API_URL: process.env.KV_REST_API_URL, KV_REST_API_TOKEN: process.env.KV_REST_API_TOKEN };
  delete process.env.KV_REST_API_URL;
  delete process.env.KV_REST_API_TOKEN;
  process.env.NODE_ENV = 'production';
  process.env.VERCEL = '1';
  try {
    const res = makeRes();
    await handler(makeReq(), res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.getHeader('cache-control'), 'no-store');
    assert.equal(res.chunks.length, 1);
    assert.match(res.chunks[0], /quota storage unavailable/);
    assert.doesNotMatch(res.chunks[0], /"type"/);
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('factory handler streams injected NDJSON frames in non-production memory posture', async () => {
  const env = { NODE_ENV: 'test', PATINA_FREE_PROVIDER: 'openai', PATINA_FREE_MODEL: 'gpt-5.5', PATINA_FREE_API_KEY: 'sk-server-free-key' };
  const injected = async ({ emit }) => {
    emit({ type: 'start', provider: 'openai', model: 'gpt-5.5' });
    emit({ type: 'delta', text: 'ok' });
    emit({ type: 'done', rewrite: 'ok' });
  };
  const api = createRewriteApiHandler({ env, runWebRewriteStreamImpl: injected });
  const res = makeRes();

  await api(makeReq(), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.getHeader('cache-control'), 'no-store');
  assert.equal(res.getHeader('content-type'), 'application/x-ndjson');
  const lines = res.chunks.join('').trim().split('\n').map((line) => JSON.parse(line));
  assert.deepEqual(lines.map((f) => f.type), ['start', 'delta', 'done']);
  assert.equal(res.ended, true);
  // Boundary lock: the server free key must never appear in the NDJSON stream.
  assert.doesNotMatch(res.chunks.join(''), /sk-server-free-key/);
});

test('the entrypoint emits a sanitized rewrite metric (no text/key/IP) on success', async () => {
  const env = { NODE_ENV: 'test', PATINA_FREE_PROVIDER: 'openai', PATINA_FREE_MODEL: 'gpt-5.5', PATINA_FREE_API_KEY: 'sk-server-free-key' };
  const metrics = [];
  const logger = { info: (evt, fields) => metrics.push({ evt, fields }), error() {}, warn() {}, debug() {} };
  const injected = async ({ emit }) => emit({ type: 'done', rewrite: 'ok' });
  const api = createRewriteApiHandler({ env, runWebRewriteStreamImpl: injected, logger });
  const res = makeRes();
  await api(makeReq({ body: { mode: 'first', lang: 'en', tier: 'free', text: 'Some sensitive prose to humanize.' } }), res);

  const metric = metrics.find((m) => m.evt === 'rewrite.metric');
  assert.ok(metric, 'a rewrite.metric must be emitted');
  const json = JSON.stringify(metric.fields);
  assert.doesNotMatch(json, /sensitive prose|sk-server-free-key|203\.0\.113/);
  assert.equal(metric.fields.tier, 'free');
  assert.equal(metric.fields.charBucket, '<500'); // bucketed, not the raw length
  assert.equal('text' in metric.fields, false);
  assert.equal('apiKey' in metric.fields, false);
});

test('the rewrite metric records the stream outcome so a failed stream is not logged as success', async () => {
  const env = { NODE_ENV: 'test', PATINA_FREE_PROVIDER: 'openai', PATINA_FREE_MODEL: 'gpt-5.5', PATINA_FREE_API_KEY: 'sk-server-free-key' };
  const metrics = [];
  const logger = { info: (evt, fields) => metrics.push({ evt, fields }), error() {}, warn() {}, debug() {} };
  const injected = async ({ emit }) => {
    emit({ type: 'start', provider: 'openai', model: 'gpt-5.5' });
    emit({ type: 'error', code: 'stream_failed', error: 'provider down' });
    return { ok: false, code: 'stream_failed', error: 'provider down' };
  };
  const api = createRewriteApiHandler({ env, runWebRewriteStreamImpl: injected, logger });
  const res = makeRes();
  await api(makeReq(), res);

  const metric = metrics.find((m) => m.evt === 'rewrite.metric');
  assert.ok(metric, 'a rewrite.metric must be emitted even when the stream fails');
  assert.equal(metric.fields.status, 200, 'the HTTP response genuinely committed 200');
  assert.equal(metric.fields.outcome, 'stream_failed', 'but the stream failure must stay observable');
});

test('free tier fails closed with 503 when the server free API key is unconfigured', async () => {
  const env = { NODE_ENV: 'test', PATINA_FREE_PROVIDER: 'openai', PATINA_FREE_MODEL: 'gpt-5.5' }; // no PATINA_FREE_API_KEY
  let runnerCalled = false;
  const injected = async () => { runnerCalled = true; };
  const api = createRewriteApiHandler({ env, runWebRewriteStreamImpl: injected });
  const res = makeRes();
  await api(makeReq(), res);
  assert.equal(res.statusCode, 503);
  assert.equal(runnerCalled, false, 'runner must not run without a usable key');
  assert.match(res.chunks.join(''), /rewrite service unavailable/);
  assert.doesNotMatch(res.chunks.join(''), /"type"/);
});

test('byok tier forwards the caller key (not the server free key) to the stream runner', async () => {
  const env = { NODE_ENV: 'test', PATINA_FREE_API_KEY: 'sk-server-free-key' };
  let seenKey;
  const injected = async ({ request, emit }) => {
    seenKey = request.apiKey;
    emit({ type: 'done', rewrite: 'ok' });
  };
  const api = createRewriteApiHandler({ env, runWebRewriteStreamImpl: injected });
  const res = makeRes();
  const byokReq = makeReq({
    body: {
      mode: 'first', lang: 'en', tier: 'byok',
      provider: 'openai', model: 'gpt-5.5', apiKey: 'sk-caller-byok-key',
      text: 'Rewrite this sentence.',
    },
  });
  await api(byokReq, res);
  assert.equal(res.statusCode, 200);
  assert.equal(seenKey, 'sk-caller-byok-key', 'byok must use the caller key, not the server free key');
});

test('REST KV adapter calls Upstash decr and parses the numeric result', async () => {
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (async (url) => {
    calls.push(String(url));
    if (String(url).includes('/decr/')) {
      return { ok: true, async json() { return { result: 4 }; } };
    }
    return { ok: true, async json() { return { result: 1 }; } };
  });
  try {
    const kv = createRestKv({ KV_REST_API_URL: 'https://kv.example.test/', KV_REST_API_TOKEN: 'token' });
    assert.ok(kv);
    assert.equal(await kv.decr('slot key'), 4);
    assert.equal(calls[0], 'https://kv.example.test/decr/slot%20key');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('the api wires an abort signal and a bounded timeout into the stream runner', async () => {
  const env = { NODE_ENV: 'test', PATINA_FREE_API_KEY: 'sk-server-free-key' };
  /** @type {any} */
  let seen;
  const injected = /** @type {any} */ (async ({ signal, timeout, emit }) => {
    seen = { signal, timeout };
    emit({ type: 'done', rewrite: 'ok' });
  });
  const api = createRewriteApiHandler({ env, runWebRewriteStreamImpl: injected });
  const res = makeRes();
  await api(makeReq(), res);
  assert.ok(seen, 'runner must be invoked');
  assert.ok(seen.signal instanceof globalThis.AbortSignal, 'runner must receive an AbortSignal');
  assert.equal(seen.signal.aborted, false, 'signal must not be pre-aborted');
  assert.equal(typeof seen.timeout, 'number');
  assert.ok(seen.timeout > 0, 'timeout must be a positive bound');
});

test('PATINA_WEB_REWRITE_TIMEOUT_MS overrides the default stream budget', async () => {
  const env = { NODE_ENV: 'test', PATINA_FREE_API_KEY: 'sk-server-free-key', PATINA_WEB_REWRITE_TIMEOUT_MS: '5000' };
  let seenTimeout;
  const injected = /** @type {any} */ (async ({ timeout, emit }) => {
    seenTimeout = timeout;
    emit({ type: 'done', rewrite: 'ok' });
  });
  const api = createRewriteApiHandler({ env, runWebRewriteStreamImpl: injected });
  await api(makeReq(), makeRes());
  assert.equal(seenTimeout, 5000);
});

test('client disconnect aborts the runner signal and never yields a false done frame', async () => {
  const env = { NODE_ENV: 'test', PATINA_FREE_API_KEY: 'sk-server-free-key' };
  const res = makeRes();
  let abortedInsideRunner = false;
  const injected = /** @type {any} */ (async ({ signal, emit }) => {
    emit({ type: 'start', provider: 'openai', model: 'gpt-5.5' });
    // Simulate the client dropping the connection while the runner is mid-flight.
    res.emitClose();
    abortedInsideRunner = signal.aborted;
    // A signal-honoring runner terminates with an error frame, never done.
    emit({ type: 'error', code: 'stream_failed', error: 'request aborted' });
  });
  const api = createRewriteApiHandler({ env, runWebRewriteStreamImpl: injected });
  await api(makeReq(), res);
  assert.equal(abortedInsideRunner, true, 'premature close must abort the runner signal');
  const lines = res.chunks.join('').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(lines.some((f) => f.type === 'done'), false, 'no false success done frame');
  assert.equal(lines.at(-1)?.type, 'error');
});

test('a clean close after end does not abort the runner signal', async () => {
  const env = { NODE_ENV: 'test', PATINA_FREE_API_KEY: 'sk-server-free-key' };
  const res = makeRes();
  /** @type {any} */
  let seenSignal;
  const injected = /** @type {any} */ (async ({ signal, emit }) => {
    seenSignal = signal;
    emit({ type: 'done', rewrite: 'ok' });
  });
  const api = createRewriteApiHandler({ env, runWebRewriteStreamImpl: injected });
  await api(makeReq(), res);
  // Node also emits 'close' after a normal end; writableEnded guards the abort.
  res.emitClose();
  assert.equal(seenSignal.aborted, false, 'clean completion must not abort');
});

test('REST KV round-trips an object via an atomic SET+PX command and JSON-parses get', async () => {
  const posts = [];
  let stored = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (async (url, init) => {
    if (init && init.method === 'POST') {
      const args = JSON.parse(String(init.body));
      posts.push({ url: String(url), args, contentType: init.headers?.['Content-Type'], auth: init.headers?.Authorization });
      stored = args[2]; // the value of ['SET', key, value, 'PX', ms]
      return { ok: true, async json() { return { result: 'OK' }; } };
    }
    // Upstash GET returns the stored value as a JSON string.
    return { ok: true, async json() { return { result: stored }; } };
  });
  try {
    const kv = createRestKv({ KV_REST_API_URL: 'https://kv.example.test/', KV_REST_API_TOKEN: 'token' });
    assert.ok(kv);
    const entry = { decision: 'allow', tier: 'pro', status: 'active', expiresAt: 123 };
    await kv.set('cache key', entry, { ttlMs: 300_000 });
    // Atomic SET+expiry: a single POST command carrying ['SET', key, JSON, 'PX', ms].
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, 'https://kv.example.test');
    assert.deepEqual(posts[0].args, ['SET', 'cache key', JSON.stringify(entry), 'PX', '300000']);
    assert.equal(posts[0].contentType, 'application/json');
    assert.equal(posts[0].auth, 'Bearer token');
    // get() parses the stored JSON string back into the original object, exactly
    // like createMemoryKv (object in -> object out) so the entitlement cache works.
    assert.deepEqual(await kv.get('cache key'), entry);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('REST KV set without a TTL omits PX; get is undefined for null and verbatim for a non-JSON result', async () => {
  const posts = [];
  const results = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (async (_url, init) => {
    if (init && init.method === 'POST') {
      posts.push(JSON.parse(String(init.body)));
      return { ok: true, async json() { return { result: 'OK' }; } };
    }
    return { ok: true, async json() { return results.shift(); } };
  });
  try {
    const kv = createRestKv({ KV_REST_API_URL: 'https://kv.example.test', KV_REST_API_TOKEN: 'token' });
    assert.ok(kv);

    await kv.set('k', { a: 1 }); // no ttl -> plain SET, no PX
    assert.deepEqual(posts[0], ['SET', 'k', JSON.stringify({ a: 1 })]);

    // A null result (missing key) reads back as undefined, matching memory KV.
    results.push({ result: null });
    assert.equal(await kv.get('missing'), undefined);

    // A non-JSON string result is returned verbatim (never thrown, never dropped).
    results.push({ result: 'plain-value' });
    assert.equal(await kv.get('legacy'), 'plain-value');

    // A numeric string parses back to a number (JSON.parse succeeds).
    results.push({ result: '0' });
    assert.equal(await kv.get('counter'), 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('REST KV incrBy with a TTL adds N and applies the expiry in ONE atomic EVAL command', async () => {
  const gets = [];
  const posts = [];
  const results = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = /** @type {any} */ (async (url, init) => {
    if (init && init.method === 'POST') {
      posts.push(JSON.parse(String(init.body)));
      return { ok: true, async json() { return { result: 1200 }; } };
    }
    gets.push(String(url));
    return { ok: true, async json() { return results.shift(); } };
  });
  try {
    const kv = createRestKv({ KV_REST_API_URL: 'https://kv.example.test', KV_REST_API_TOKEN: 'token' });
    assert.ok(kv);

    // #605: increment + TTL is a single EVAL(INCRBY+PEXPIRE) round trip — never
    // an /incrby followed by a separate /expire the process could die before.
    const total = await kv.incrBy('month key', 400, { ttlMs: 2_500 });
    assert.equal(total, 1200);
    assert.equal(posts.length, 1, 'one atomic command, no separate expire call');
    assert.equal(gets.length, 0, 'the GET path is never used when a TTL is supplied');
    assert.equal(posts[0][0], 'EVAL');
    assert.match(posts[0][1], /INCRBY/);
    assert.match(posts[0][1], /PEXPIRE/);
    assert.deepEqual(posts[0].slice(2), ['1', 'month key', '400', '2500'], 'one key; amount; ttl in ms');

    // Without a TTL the plain GET-path INCRBY is kept.
    results.push({ result: 800 });
    assert.equal(await kv.incrBy('month key', 400), 800);
    assert.equal(gets[0], 'https://kv.example.test/incrby/month%20key/400');

    // A malformed counter (non-numeric) fails closed by throwing.
    results.push({ result: 'not-a-number' });
    await assert.rejects(() => kv.incrBy('k', 5), /invalid counter/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

/** A globalThis.fetch stub returning a valid Lemon Squeezy validate-only response. */
function validLsFetch() {
  return /** @type {any} */ (async () => ({
    ok: true,
    status: 200,
    async json() {
      return { valid: true, license_key: { status: 'active' }, meta: { store_id: '42', variant_id: '99' } };
    },
  }));
}

test('pro tier: a valid license streams with the server pro key and a pro-tier metric (no license leak)', async () => {
  const RAW = 'LS-LICENSE-RAW-777';
  const env = {
    NODE_ENV: 'test',
    PATINA_FREE_PROVIDER: 'openai', PATINA_FREE_MODEL: 'gpt-5.5',
    PATINA_FREE_API_KEY: 'sk-server-free-key',
    PATINA_PRO_API_KEY: 'sk-server-pro-key',
    PATINA_LICENSE_HMAC_SECRET: 'license-secret',
    LS_STORE_ID: '42', LS_PRO_VARIANT_ID: '99',
  };
  const metrics = [];
  const logger = { info: (evt, fields) => metrics.push({ evt, fields }), error() {}, warn() {}, debug() {} };
  let seenKey;
  let seenTier;
  const injected = async ({ request, emit }) => {
    seenKey = request.apiKey;
    seenTier = request.tier;
    emit({ type: 'done', rewrite: 'ok' });
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = validLsFetch();
  try {
    // Validator captures globalThis.fetch at construction, so replace it first.
    const api = createRewriteApiHandler({ env, runWebRewriteStreamImpl: injected, logger });
    const res = makeRes();
    await api({
      method: 'POST',
      headers: { 'x-real-ip': '203.0.113.50', authorization: `Bearer ${RAW}` },
      body: JSON.stringify({ mode: 'first', lang: 'en', tier: 'pro', text: 'Rewrite this sentence.' }),
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.getHeader('content-type'), 'application/x-ndjson');
    const lines = res.chunks.join('').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((f) => f.type), ['done']);
    // The server pro key reaches the runner — never the free key, never the license.
    assert.equal(seenKey, 'sk-server-pro-key');
    assert.equal(seenTier, 'pro');
    // Observability preserves the pro tier and never carries the raw license.
    const metric = metrics.find((m) => m.evt === 'rewrite.metric');
    assert.ok(metric, 'a rewrite.metric must be emitted');
    assert.equal(metric.fields.tier, 'pro');
    assert.equal(JSON.stringify(metric.fields).includes(RAW), false);
    // The license never appears in the NDJSON stream either.
    assert.equal(res.chunks.join('').includes(RAW), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('pro tier: fails closed with 503 when no pro key and no free-key fallback are configured', async () => {
  const RAW = 'LS-LICENSE-RAW-nokey';
  const env = {
    NODE_ENV: 'test',
    PATINA_FREE_PROVIDER: 'openai', PATINA_FREE_MODEL: 'gpt-5.5',
    // no PATINA_PRO_API_KEY, no PATINA_FREE_API_KEY -> nothing to fall back to.
    PATINA_LICENSE_HMAC_SECRET: 'license-secret',
    LS_STORE_ID: '42', LS_PRO_VARIANT_ID: '99',
  };
  let runnerCalled = false;
  const injected = async () => { runnerCalled = true; };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = validLsFetch();
  try {
    const api = createRewriteApiHandler({ env, runWebRewriteStreamImpl: injected });
    const res = makeRes();
    await api({
      method: 'POST',
      headers: { 'x-real-ip': '203.0.113.51', authorization: `Bearer ${RAW}` },
      body: JSON.stringify({ mode: 'first', lang: 'en', tier: 'pro', text: 'Rewrite this sentence.' }),
    }, res);
    assert.equal(res.statusCode, 503);
    assert.equal(runnerCalled, false, 'runner must not run without a usable pro key');
    assert.match(res.chunks.join(''), /rewrite service unavailable/);
    assert.doesNotMatch(res.chunks.join(''), /"type"/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('pro tier: outside production a valid license falls back to the free key when no pro key is set', async () => {
  const RAW = 'LS-LICENSE-RAW-fallback';
  const env = {
    NODE_ENV: 'test',
    PATINA_FREE_PROVIDER: 'openai', PATINA_FREE_MODEL: 'gpt-5.5',
    PATINA_FREE_API_KEY: 'sk-server-free-key',
    // no PATINA_PRO_API_KEY -> non-production allows the free key as a dev fallback.
    PATINA_LICENSE_HMAC_SECRET: 'license-secret',
    LS_STORE_ID: '42', LS_PRO_VARIANT_ID: '99',
  };
  let seenKey;
  const injected = async ({ request, emit }) => { seenKey = request.apiKey; emit({ type: 'done', rewrite: 'ok' }); };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = validLsFetch();
  try {
    const api = createRewriteApiHandler({ env, runWebRewriteStreamImpl: injected });
    const res = makeRes();
    await api({
      method: 'POST',
      headers: { 'x-real-ip': '203.0.113.52', authorization: `Bearer ${RAW}` },
      body: JSON.stringify({ mode: 'first', lang: 'en', tier: 'pro', text: 'Rewrite this sentence.' }),
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(seenKey, 'sk-server-free-key', 'non-production pro falls back to the free key');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('pro tier: in production, no pro key + present free key + no allow-flag returns 503 and never spends the free key on paid traffic', async () => {
  const RAW = 'LS-LICENSE-RAW-prodpolicy';
  const env = {
    NODE_ENV: 'production',
    KV_REST_API_URL: 'https://kv.example.test',
    KV_REST_API_TOKEN: 'kv-token',
    PATINA_QUOTA_HMAC_SECRET: 'quota-secret',
    PATINA_LICENSE_HMAC_SECRET: 'license-secret',
    PATINA_FREE_PROVIDER: 'openai', PATINA_FREE_MODEL: 'gpt-5.5',
    PATINA_FREE_API_KEY: 'sk-server-free-key',
    // Provider/model ARE configured (production requires them explicitly), so the
    // flow reaches the server-KEY policy this test is about.
    PATINA_PRO_PROVIDER: 'claude', PATINA_PRO_MODEL: 'claude-sonnet-5',
    // No PATINA_PRO_API_KEY and no PATINA_PRO_ALLOW_FREE_KEY: paid traffic MUST NOT
    // silently spend the free key in production.
    LS_STORE_ID: '42', LS_PRO_VARIANT_ID: '99',
  };
  let runnerCalled = false;
  const injected = async () => { runnerCalled = true; };
  const originalFetch = globalThis.fetch;
  // One mock serves both the LS validate call and the Upstash KV REST adapter so
  // entitlement + rate limiting pass in production and the flow reaches the
  // server-key resolution (where the policy denial happens).
  globalThis.fetch = /** @type {any} */ (async (url, init) => {
    const u = String(url);
    if (u.includes('api.lemonsqueezy.com')) {
      return { ok: true, status: 200, async json() { return { valid: true, license_key: { status: 'active' }, meta: { store_id: '42', variant_id: '99' } }; } };
    }
    if (init && init.method === 'POST') {
      // Root-POST commands: atomic EVAL(INCRBY+PEXPIRE) counters return 1; SET returns OK.
      const args = JSON.parse(String(init.body));
      if (args[0] === 'EVAL') return { ok: true, async json() { return { result: 1 }; } };
      return { ok: true, async json() { return { result: 'OK' }; } };
    }
    if (u.includes('/incr/')) return { ok: true, async json() { return { result: 1 }; } };
    if (u.includes('/decr/')) return { ok: true, async json() { return { result: 0 }; } };
    if (u.includes('/expire/')) return { ok: true, async json() { return { result: 1 }; } };
    if (u.includes('/get/')) return { ok: true, async json() { return { result: null }; } };
    if (u.includes('/incrby/')) return { ok: true, async json() { return { result: 100 }; } };
    return { ok: true, async json() { return { result: 'OK' }; } }; // command SET
  });
  try {
    const api = createRewriteApiHandler({ env, runWebRewriteStreamImpl: injected });
    const res = makeRes();
    await api({
      method: 'POST',
      headers: { 'x-real-ip': '203.0.113.53', authorization: `Bearer ${RAW}` },
      body: JSON.stringify({ mode: 'first', lang: 'en', tier: 'pro', text: 'Rewrite this sentence.' }),
    }, res);
    assert.equal(res.statusCode, 503, 'production pro without a pro key must fail closed');
    assert.equal(runnerCalled, false, 'the free key must never serve paid traffic in production');
    assert.match(res.chunks.join(''), /rewrite service unavailable/);
    assert.doesNotMatch(res.chunks.join(''), new RegExp(RAW));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
