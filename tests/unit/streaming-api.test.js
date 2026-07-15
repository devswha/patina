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
function failingStreamFrom(chunks, error) {
  const encoder = new globalThis.TextEncoder();
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield encoder.encode(chunk);
      throw error;
    },
  };
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

test('callLLMStream drops temperature and retries once when the model rejects it (claude-sonnet-5)', async () => {
  const bodies = [];
  const fetchImpl = async (_url, init) => {
    const body = JSON.parse(String(/** @type {any} */ (init).body));
    bodies.push(body);
    if ('temperature' in body) {
      return new Response('{"error":{"code":"invalid_request_error","message":"`temperature` is deprecated for this model."}}', {
        status: 400,
        headers: new globalThis.Headers(),
      });
    }
    return okResponse([
      'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":null}]}\n\n',
      'data: [DONE]\n\n',
    ]);
  };

  const result = await callLLMStream({ prompt: 'p', apiKey: 'sk-test', model: 'temp-reject-stream', fetchImpl });
  assert.equal(result.text, 'ok');
  assert.equal(bodies.length, 2, 'exactly one drop-and-retry');
  assert.ok('temperature' in bodies[0], 'first attempt sends temperature');
  assert.ok(!('temperature' in bodies[1]), 'retry omits temperature');

  // The model is remembered: the next stream skips temperature up front.
  bodies.length = 0;
  const again = await callLLMStream({ prompt: 'p', apiKey: 'sk-test', model: 'temp-reject-stream', fetchImpl });
  assert.equal(again.text, 'ok');
  assert.equal(bodies.length, 1);
  assert.ok(!('temperature' in bodies[0]), 'learned model skips temperature on the first attempt');
});

test('callLLMStream records one null-metadata attempt and no response for unrelated 400s', async () => {
  let calls = 0;
  const attempts = [];
  const responses = [];
  const fetchImpl = async () => {
    calls++;
    return new Response('bad request: missing field', { status: 400, headers: new globalThis.Headers() });
  };
  await assert.rejects(
    callLLMStream({
      prompt: 'p',
      apiKey: 'sk-test',
      model: 'temp-keep-stream',
      fetchImpl,
      onAttempt: (attempt) => attempts.push(attempt),
      onResponse: (response) => responses.push(response),
    }),
    (err) => {
      const error = /** @type {any} */ (err);
      assert.equal(error.name, 'HttpError');
      assert.equal(error.status, 400);
      return true;
    }
  );
  assert.equal(calls, 1, 'a generic 400 is not retried');
  assert.deepEqual(attempts, [{
    attemptIndex: 1,
    requestedModel: 'temp-keep-stream',
    effectiveModel: null,
    usage: null,
    retryReason: 'initial',
    minimumChargeApplied: false,
    outcome: 'error',
  }]);
  assert.deepEqual(responses, []);
});
test('callLLMStream retains response metadata when the SSE body fails after a valid payload', async () => {
  const attempts = [];
  const responses = [];
  const usage = { prompt_tokens: 3, completion_tokens: 2 };
  const bodyError = new Error('stream body failed');
  await assert.rejects(
    callLLMStream({
      prompt: 'p',
      apiKey: 'sk-test',
      model: 'requested-model',
      fetchImpl: async () => ({
        ok: true,
        body: failingStreamFrom([
          `data: {"model":"provider-model","usage":${JSON.stringify(usage)},"choices":[{"delta":{"content":"partial"}}]}\n\n`,
        ], bodyError),
      }),
      onAttempt: (attempt) => attempts.push(attempt),
      onResponse: (metadata) => responses.push(metadata),
    }),
    (error) => error === bodyError,
  );
  assert.deepEqual(attempts, [{
    attemptIndex: 1,
    requestedModel: 'requested-model',
    effectiveModel: 'provider-model',
    usage,
    retryReason: 'initial',
    minimumChargeApplied: false,
    outcome: 'error',
  }]);
  assert.deepEqual(responses, []);
});

test('callLLMStream records split-stream metadata with the response-derived model and usage', async () => {
  const attempts = [];
  const responses = [];
  const usage = { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 };
  const result = await callLLMStream({
    prompt: 'p',
    apiKey: 'sk-test',
    model: 'requested-model',
    fetchImpl: async () => okResponse([
      'data: {"model":"provider-model","choices":[{"delta":{"content":"he',
      'llo"}}]}\n\n',
      `data: {"model":"provider-model","usage":${JSON.stringify(usage)},"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n`,
      'data: [DONE]\n\n',
    ]),
    onAttempt: (attempt) => attempts.push(attempt),
    onResponse: (metadata) => responses.push(metadata),
  });

  assert.deepEqual(result, { text: 'hello', finishReason: 'stop' });
  assert.deepEqual(attempts, [{
    attemptIndex: 1,
    requestedModel: 'requested-model',
    effectiveModel: 'provider-model',
    usage,
    retryReason: 'initial',
    minimumChargeApplied: false,
    outcome: 'success',
  }]);
  assert.equal(responses.length, 1);
  assert.equal(responses[0].model, 'provider-model');
  assert.equal(responses[0].effectiveModel, 'provider-model');
  assert.equal(responses[0].requestedModel, 'requested-model');
  assert.deepEqual(responses[0].usage, usage);
});

test('callLLMStream records retry errors, preserves null metadata, and isolates metadata callbacks', async () => {
  const attempts = [];
  const responses = [];
  let calls = 0;
  const result = await callLLMStream({
    prompt: 'p',
    apiKey: 'sk-test',
    model: 'metadata-temp-reject-stream',
    fetchImpl: async () => {
      calls++;
      if (calls === 1) {
        return new Response('{"error":{"message":"temperature is not supported"}}', {
          status: 400,
          headers: new globalThis.Headers(),
        });
      }
      return okResponse([
        'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n',
        'data: [DONE]\n\n',
      ]);
    },
    onDelta: () => {
      throw new Error('observer failure');
    },
    onAttempt: (attempt) => {
      attempts.push(attempt);
      throw new Error('observer failure');
    },
    onResponse: (metadata) => {
      responses.push(metadata);
      throw new Error('observer failure');
    },
  });

  assert.deepEqual(result, { text: 'ok', finishReason: 'stop' });
  assert.equal(calls, 2);
  assert.deepEqual(responses, [{
    provider: 'openai-http',
    model: null,
    effectiveModel: null,
    requestedModel: 'metadata-temp-reject-stream',
    temperature: null,
    usage: null,
    cacheTokens: null,
    rawResponse: { choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] },
    content: 'ok',
  }]);
  assert.deepEqual(attempts, [
    {
      attemptIndex: 1,
      requestedModel: 'metadata-temp-reject-stream',
      effectiveModel: null,
      usage: null,
      retryReason: 'initial',
      minimumChargeApplied: false,
      outcome: 'error',
    },
    {
      attemptIndex: 2,
      requestedModel: 'metadata-temp-reject-stream',
      effectiveModel: null,
      usage: null,
      retryReason: 'temperature_schema',
      minimumChargeApplied: false,
      outcome: 'success',
    },
  ]);
});
