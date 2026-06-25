// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { callLLMStream } from '../../src/streaming-api.js';

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

test('callLLMStream buffers split SSE deltas and returns accumulated text', async () => {
  const deltas = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(String(/** @type {any} */ (init).body));
    assert.equal(body.stream, true);
    assert.equal(/** @type {any} */ (init).headers.Authorization, 'Bearer sk-test');
    return okResponse([
      'data: {"choices":[{"delta":{"content":"Hel',
      'lo"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"},"finish_reason":"stop"}]}\n\n',
      'data: [DONE]\n\n',
    ]);
  };

  const result = await callLLMStream({
    prompt: 'p',
    apiKey: 'sk-test',
    baseURL: 'https://example.test/v1',
    model: 'm',
    fetchImpl,
    onDelta: (chunk) => deltas.push(chunk),
  });

  assert.deepEqual(deltas, ['Hello', ' world']);
  assert.deepEqual(result, { text: 'Hello world', finishReason: 'stop' });
});

test('callLLMStream throws redacted HttpError for non-2xx responses', async () => {
  const fetchImpl = async () => new Response('bad Bearer sk-secret1234567890', {
    status: 401,
    headers: new globalThis.Headers(),
  });

  await assert.rejects(
    callLLMStream({ prompt: 'p', apiKey: 'sk-secret1234567890', fetchImpl }),
    (err) => {
      const error = /** @type {any} */ (err);
      assert.equal(error.name, 'HttpError');
      assert.equal(error.status, 401);
      assert.match(error.message, /HTTP 401/);
      assert.doesNotMatch(error.message, /sk-secret1234567890/);
      return true;
    }
  );
});

test('callLLMStream throws AbortError when external signal is aborted', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    callLLMStream({ prompt: 'p', apiKey: 'sk-test', signal: controller.signal, fetchImpl: async () => okResponse([]) }),
    { name: 'AbortError' }
  );
});

test('callLLMStream skips malformed JSON data lines without crashing', async () => {
  const deltas = [];
  const fetchImpl = async () => okResponse([
    'data: {not json}\n\n',
    'data: {"choices":[{"delta":{"content":"ok"}}]}\n\n',
    'data: [DONE]\n\n',
  ]);

  const result = await callLLMStream({ prompt: 'p', apiKey: 'sk-test', fetchImpl, onDelta: (chunk) => deltas.push(chunk) });
  assert.deepEqual(deltas, ['ok']);
  assert.equal(result.text, 'ok');
});
