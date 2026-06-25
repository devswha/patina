// @ts-nocheck
// Adversarial suite: feeds deliberately malformed score/stream shapes, so static
// type-checking is disabled here on purpose (the shapes are the test inputs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { callLLMStream } from '../../src/streaming-api.js';
import { runWebRewriteStream } from '../../src/web-rewrite-stream.js';
import { createRestKv, createRewriteApiHandler } from '../../api/rewrite.js';

const baseRequest = {
  mode: 'refine',
  lang: 'en',
  tier: 'byok',
  text: 'latest draft',
  original: 'original anchor text',
  history: [],
  provider: 'openai',
  model: 'gpt-5.5',
  baseURL: 'https://api.openai.com/v1',
  apiKey: 'sk-test-redteam',
};

function streamFrom(chunks) {
  return new globalThis.ReadableStream({
    start(controller) {
      const encoder = new globalThis.TextEncoder();
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

function okResponse(chunks) {
  return new Response(streamFrom(chunks), { status: 200, headers: new globalThis.Headers() });
}

function scoreFns({ mps = 95, fidelity = 95 } = {}) {
  return {
    scoreMPS: async () => mps,
    scoreFidelity: async () => fidelity,
    scoreDeterministicSignals: ({ text }) => ({ overall: String(text).length }),
  };
}

async function runStream({ request = baseRequest, callLLMStream = async ({ onDelta }) => {
  onDelta?.('safe rewrite');
  return { text: 'safe rewrite' };
}, scores = scoreFns() } = {}) {
  const frames = [];
  const result = await runWebRewriteStream({
    request,
    config: { language: request.lang, profile: 'default' },
    callLLMStream,
    scoreFns: scores,
    emit: (frame) => frames.push(frame),
  });
  return { frames, result };
}

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
    setHeader(name, value) { headers.set(String(name).toLowerCase(), String(value)); },
    getHeader(name) { return headers.get(String(name).toLowerCase()); },
    write(chunk) { chunks.push(String(chunk)); },
    end(body = '') { if (body) chunks.push(String(body)); this.ended = true; },
    chunks,
    ended: false,
  };
}

function parseNdjson(chunks) {
  const body = chunks.join('');
  return body.trim() ? body.trim().split('\n').map((line) => JSON.parse(line)) : [];
}

function assertNoDone(frames) {
  assert.equal(frames.some((frame) => frame.type === 'done'), false, 'must not emit a success done frame');
}

function assertNoSecretFields(value) {
  const stack = [value];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    for (const [key, nested] of Object.entries(current)) {
      assert.doesNotMatch(key, /^(apiKey|authorization)$/i, 'frame must not expose secret-bearing fields');
      stack.push(nested);
    }
  }
}

test('redteam floor fail-closed rejects dangerous score shapes and only accepts both floors >=70', async () => {
  const badShapes = [
    ['mps undefined', undefined, { fidelity: 95 }],
    ['mps NaN', { mps: Number.NaN }, { fidelity: 95 }],
    ['mps 69', { mps: 69 }, { fidelity: 95 }],
    ['fidelity 69', { mps: 95 }, { fidelity: 69 }],
    ['mps string 95', { mps: '95' }, { fidelity: 95 }],
    ['missing fidelity', { mps: 95 }, {}],
    ['both missing', {}, {}],
  ];

  const failures = [];
  for (const [label, mps, fidelity] of badShapes) {
    const { frames, result } = await runStream({ scores: scoreFns({ mps, fidelity }) });
    try {
      assert.equal(result.ok, false, label);
      assert.equal(result.code, 'floor_failed', label);
      assertNoDone(frames);
      assert.equal(frames.at(-1)?.type, 'error', label);
      assert.equal(frames.at(-1)?.code, 'floor_failed', label);
    } catch (err) {
      failures.push(`${label}: ${/** @type {Error} */ (err).message}`);
    }
  }
  assert.deepEqual(failures, [], 'dangerous floor shapes must all fail closed');

  const { frames, result } = await runStream({ scores: scoreFns({ mps: { mps: 70 }, fidelity: { fidelity: 70 } }) });
  assert.equal(result.ok, true);
  assert.equal(frames.at(-1)?.type, 'done');
});

test('redteam stream corruption and aborts terminate as stream_failed without false done', async () => {
  const cases = [
    ['mid-stream throw', async ({ onDelta }) => { onDelta('partial'); throw new Error('socket died'); }],
    ['rejected stream', async () => Promise.reject(new Error('upstream rejected'))],
    ['aborted stream', async ({ onDelta }) => { onDelta('partial'); const err = new Error('AbortError'); err.name = 'AbortError'; throw err; }],
  ];

  for (const [label, injected] of cases) {
    const { frames, result } = await runStream({ callLLMStream: injected });
    assert.equal(result.ok, false, label);
    assert.equal(result.code, 'stream_failed', label);
    assertNoDone(frames);
    assert.equal(frames.at(-1)?.type, 'error', label);
    assert.equal(frames.at(-1)?.code, 'stream_failed', label);
  }
});

test('redteam SSE parser abuse: skips malformed input, survives split deltas/tiny chunks, and treats [DONE] as terminal', async () => {
  const manyTinyChunks = Array.from('data: {"choices":[{"delta":{"content":"C"},"finish_reason":"stop"}]}\n\n');
  const deltas = [];
  const fetchImpl = async () => okResponse([
    'event: message\n',
    'data: {not json}\n\n',                 // malformed JSON -> skipped
    'data: {"choices":[{"delta":{"content":"A',  // delta split across chunks
    'B',
    '"}}]}\n\n',
    'not-data: {"choices":[{"delta":{"content":"SHOULD_NOT_APPEAR"}}]}\n\n', // no data: prefix -> ignored
    ...manyTinyChunks,                      // reassembles to one "C" delta + finish_reason
    'data: {"choices":[{"delta":{"content":"D"}}]}\n\n',
    'data: [DONE]\n\n',                     // terminal sentinel
    'data: {"choices":[{"delta":{"content":"AFTER_DONE"}}]}\n\n', // must be dropped
  ]);

  const result = await callLLMStream({
    prompt: 'p',
    apiKey: 'sk-test',
    baseURL: 'https://example.test/v1',
    model: 'm',
    fetchImpl,
    onDelta: (chunk) => deltas.push(chunk),
  });

  assert.deepEqual(deltas, ['AB', 'C', 'D']);
  assert.deepEqual(result, { text: 'ABCD', finishReason: 'stop' });
  assert.doesNotMatch(result.text, /SHOULD_NOT_APPEAR/);
  assert.doesNotMatch(result.text, /AFTER_DONE/); // [DONE] is terminal: later data ignored
});

test('redteam key leak scrubs stream_failed errors and emitted frames never expose apiKey or authorization fields', async () => {
  const leak = 'sk-LEAK1234567890abcdef';
  const { frames, result } = await runStream({
    request: { ...baseRequest, apiKey: leak },
    callLLMStream: async ({ onDelta }) => {
      onDelta('partial');
      throw new Error(`provider rejected Authorization Bearer ${leak}`);
    },
    scores: {
      scoreMPS: async () => { throw new Error(`score leak ${leak}`); },
      scoreFidelity: async () => ({ fidelity: 95 }),
      scoreDeterministicSignals: ({ text }) => ({ overall: String(text).length }),
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'stream_failed');
  assertNoDone(frames);
  const serialized = JSON.stringify({ frames, result });
  assert.doesNotMatch(serialized, /sk-LEAK/);
  for (const frame of frames) assertNoSecretFields(frame);
});

test('redteam rewrite api resolves free and BYOK keys without calling runner on unconfigured free tier', async () => {
  const seen = [];
  const runner = async ({ request, emit }) => {
    seen.push(request.apiKey);
    emit({ type: 'done', rewrite: 'ok' });
  };

  const missingEnv = { NODE_ENV: 'test', PATINA_FREE_PROVIDER: 'openai', PATINA_FREE_MODEL: 'gpt-5.5' };
  const missingApi = createRewriteApiHandler({ env: missingEnv, runWebRewriteStreamImpl: runner });
  const missingRes = makeRes();
  await missingApi(makeReq(), missingRes);
  assert.equal(missingRes.statusCode, 503);
  assert.equal(seen.length, 0);

  const freeEnv = { ...missingEnv, PATINA_FREE_API_KEY: 'sk-server-free-key' };
  const freeApi = createRewriteApiHandler({ env: freeEnv, runWebRewriteStreamImpl: runner });
  const freeRes = makeRes();
  await freeApi(makeReq(), freeRes);
  assert.equal(freeRes.statusCode, 200);
  assert.equal(seen.at(-1), 'sk-server-free-key');

  const byokApi = createRewriteApiHandler({ env: freeEnv, runWebRewriteStreamImpl: runner });
  const byokRes = makeRes();
  await byokApi(makeReq({ body: {
    mode: 'first', lang: 'en', tier: 'byok', provider: 'openai', model: 'gpt-5.5', apiKey: 'sk-caller-byok-key', text: 'Rewrite this sentence.',
  } }), byokRes);
  assert.equal(byokRes.statusCode, 200);
  assert.equal(seen.at(-1), 'sk-caller-byok-key');
  assert.notEqual(seen.at(-1), 'sk-server-free-key');
});

test('redteam production KV fail-closed returns 503 with no NDJSON frames and createRestKv is null without env', async () => {
  assert.equal(createRestKv({}), null);
  let runnerCalled = false;
  const api = createRewriteApiHandler({
    env: { NODE_ENV: 'production', VERCEL: '1', PATINA_FREE_PROVIDER: 'openai', PATINA_FREE_MODEL: 'gpt-5.5', PATINA_FREE_API_KEY: 'sk-server-free-key' },
    runWebRewriteStreamImpl: async () => { runnerCalled = true; },
  });
  const res = makeRes();
  await api(makeReq(), res);
  assert.equal(res.statusCode, 503);
  assert.equal(runnerCalled, false);
  assert.equal(parseNdjson(res.chunks).some((frame) => frame.type), false);
  assert.doesNotMatch(res.chunks.join(''), /"type"/);
});

test('redteam NDJSON integrity preserves ordered frames, no-store header, and terminal parseable errors without done', async () => {
  const env = { NODE_ENV: 'test', PATINA_FREE_PROVIDER: 'openai', PATINA_FREE_MODEL: 'gpt-5.5', PATINA_FREE_API_KEY: 'sk-server-free-key' };
  const happyApi = createRewriteApiHandler({
    env,
    runWebRewriteStreamImpl: async ({ emit }) => {
      emit({ type: 'start', provider: 'openai', model: 'gpt-5.5' });
      emit({ type: 'delta', text: 'ok' });
      emit({ type: 'done', rewrite: 'ok' });
    },
  });
  const happyRes = makeRes();
  await happyApi(makeReq(), happyRes);
  assert.equal(happyRes.getHeader('cache-control'), 'no-store');
  assert.equal(happyRes.getHeader('content-type'), 'application/x-ndjson');
  assert.deepEqual(parseNdjson(happyRes.chunks).map((frame) => frame.type), ['start', 'delta', 'done']);

  for (const [code, frame] of [
    ['floor_failed', { type: 'error', code: 'floor_failed', failed: ['mps'] }],
    ['stream_failed', { type: 'error', code: 'stream_failed', error: 'upstream died' }],
  ]) {
    const api = createRewriteApiHandler({ env, runWebRewriteStreamImpl: async ({ emit }) => emit(frame) });
    const res = makeRes();
    await api(makeReq(), res);
    const frames = parseNdjson(res.chunks);
    assert.equal(frames.at(-1)?.type, 'error', code);
    assert.equal(frames.at(-1)?.code, code);
    assert.equal(frames.some((item) => item.type === 'done'), false, code);
  }
});
