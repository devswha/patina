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
