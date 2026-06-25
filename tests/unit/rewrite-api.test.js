// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import handler, { createRewriteApiHandler } from '../../api/rewrite.js';

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
  return {
    statusCode: 200,
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
