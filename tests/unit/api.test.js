import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  HttpError,
  isRetryable,
  computeBackoffMs,
  callLLM,
} from '../../src/api.js';

test('HttpError captures status, body, and Retry-After', () => {
  const err = new HttpError(503, 'service down', '5');
  assert.equal(err.name, 'HttpError');
  assert.equal(err.status, 503);
  assert.equal(err.body, 'service down');
  assert.equal(err.retryAfter, '5');
  assert.match(err.message, /^HTTP 503: /);
});

test('HttpError truncates long bodies in the message', () => {
  const long = 'x'.repeat(1024);
  const err = new HttpError(500, long);
  assert.ok(err.message.length < long.length, 'message should be truncated');
  assert.equal(err.body, long); // raw body preserved on the error
});

test('isRetryable: 5xx, 429, 408, 425 are retryable', () => {
  for (const status of [500, 502, 503, 504, 429, 408, 425]) {
    assert.equal(isRetryable(new HttpError(status, '')), true, `status ${status}`);
  }
});

test('isRetryable: auth/validation 4xxs are NOT retryable', () => {
  for (const status of [400, 401, 403, 404, 422]) {
    assert.equal(isRetryable(new HttpError(status, '')), false, `status ${status}`);
  }
});

test('isRetryable: AbortError (timeout) is retryable', () => {
  const err = new Error('aborted');
  err.name = 'AbortError';
  assert.equal(isRetryable(err), true);
});

test('isRetryable: network TypeError / ECONNRESET are retryable', () => {
  const typeErr = new TypeError('fetch failed');
  assert.equal(isRetryable(typeErr), true);
  const econn = new Error('connection reset');
  econn.code = 'ECONNRESET';
  assert.equal(isRetryable(econn), true);
});

test('computeBackoffMs honors numeric Retry-After in seconds', () => {
  const ms = computeBackoffMs(0, '5');
  assert.equal(ms, 5000);
});

test('computeBackoffMs honors HTTP-date Retry-After', () => {
  const now = 1_700_000_000_000;
  const future = new Date(now + 7000).toUTCString();
  const ms = computeBackoffMs(0, future, { now: () => now });
  assert.equal(ms, 7000);
});

test('computeBackoffMs falls back to exponential + jitter', () => {
  // Jitter held constant (0.5) to make the assertion deterministic.
  const ms = computeBackoffMs(2, null, { random: () => 0.5 });
  // base = min(1000 * 2^2, 30000) = 4000; jitter = 0.5 * 4000 * 0.5 = 1000
  assert.equal(ms, 5000);
});

test('computeBackoffMs caps backoff at maxDelay', () => {
  const ms = computeBackoffMs(20, null, { random: () => 1, max: 30000 });
  assert.equal(ms, 30000);
});

test('computeBackoffMs caps Retry-After at maxDelay too', () => {
  const ms = computeBackoffMs(0, '600', { max: 30000 });
  assert.equal(ms, 30000);
});


test('callLLM clamps Retry-After sleep to the remaining deadline budget', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let currentTime = 1_000;
  const slept = [];
  globalThis.fetch = async () => {
    calls++;
    return {
      ok: false,
      status: 503,
      headers: { get: (name) => (name.toLowerCase() === 'retry-after' ? '30' : null) },
      text: async () => 'busy',
    };
  };

  try {
    await assert.rejects(
      callLLM({
        prompt: 'x',
        apiKey: 'test',
        maxRetries: 2,
        timeout: 120000,
        deadline: currentTime + 5000,
        now: () => currentTime,
        sleep: async (ms) => {
          slept.push(ms);
          currentTime += ms;
        },
      }),
      /deadline exceeded/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls, 1, 'deadline should stop before a second retry attempt');
  assert.deepEqual(slept, [5000], 'Retry-After must be clamped to remaining budget');
});

test('callLLM honors an externally passed AbortSignal before fetch', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('fetch should not run');
  };
  const controller = new AbortController();
  controller.abort();

  try {
    await assert.rejects(
      callLLM({
        prompt: 'x',
        apiKey: 'test',
        signal: controller.signal,
      }),
      /External abort signal/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('callLLM preserves final HTTP status for backend fallback classification', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 503,
    headers: { get: () => null },
    text: async () => 'busy',
  });

  try {
    await assert.rejects(
      callLLM({
        prompt: 'x',
        apiKey: 'test',
        maxRetries: 0,
      }),
      (err) => err.status === 503 && /HTTP 503/.test(err.message)
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('callLLM reports usage metadata without changing string return value', async () => {
  const originalFetch = globalThis.fetch;
  const seen = [];
  let requestBody;
  globalThis.fetch = async (_url, opts) => {
    requestBody = JSON.parse(opts.body);
    return {
      ok: true,
      json: async () => ({
        model: 'served-model',
        choices: [{ message: { content: 'hello' } }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 3,
          cost_usd: 0.001,
        },
      }),
    };
  };

  try {
    const content = await callLLM({
      prompt: 'x',
      apiKey: 'test',
      model: 'requested-model',
      temperature: 0.2,
      seed: 42,
      onResponse: (metadata) => seen.push(metadata),
    });

    assert.equal(content, 'hello');
    assert.equal(requestBody.seed, 42);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].model, 'served-model');
    assert.equal(seen[0].requestedModel, 'requested-model');
    assert.equal(seen[0].temperature, 0.2);
    assert.equal(seen[0].seed, 42);
    assert.deepEqual(seen[0].usage, {
      prompt_tokens: 10,
      completion_tokens: 3,
      cost_usd: 0.001,
    });
    assert.equal(seen[0].content, 'hello');
    // No provider cache fields in this usage payload -> absent-safe null.
    assert.equal(seen[0].cacheTokens, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a timeout that exhausts retries surfaces as TimeoutError, not AbortError (#444)', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    const e = new Error('aborted');
    e.name = 'AbortError'; // a timer-driven abort with no external signal
    throw e;
  };
  try {
    await assert.rejects(
      callLLM({ prompt: 'x', apiKey: 'test', maxRetries: 1, sleep: async () => {} }),
      (err) => err.name === 'TimeoutError' && /LLM API failed/.test(err.message),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('an externally aborted call still surfaces as AbortError (#444)', async () => {
  const originalFetch = globalThis.fetch;
  const controller = new AbortController();
  globalThis.fetch = async () => {
    controller.abort();
    const e = new Error('aborted');
    e.name = 'AbortError';
    throw e;
  };
  try {
    await assert.rejects(
      callLLM({ prompt: 'x', apiKey: 'test', maxRetries: 1, signal: controller.signal, sleep: async () => {} }),
      (err) => err.name === 'AbortError',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a throw from onResponse does not re-issue the paid request (#444)', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'hi' } }] }) };
  };
  try {
    await assert.rejects(
      callLLM({
        prompt: 'x',
        apiKey: 'test',
        maxRetries: 3,
        sleep: async () => {},
        onResponse: () => { throw new TypeError('callback boom'); },
      }),
      /callback boom/,
    );
    assert.equal(calls, 1, 'fetch must run exactly once despite the onResponse throw');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('callLLM surfaces provider prompt-cache token counts when present', async () => {
  const originalFetch = globalThis.fetch;
  const cases = [
    // OpenAI-compatible shape.
    {
      usage: { prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 80 } },
      expected: { cachedReadTokens: 80, cacheCreationTokens: null },
    },
    // Anthropic-style shape.
    {
      usage: { input_tokens: 100, cache_read_input_tokens: 64, cache_creation_input_tokens: 12 },
      expected: { cachedReadTokens: 64, cacheCreationTokens: 12 },
    },
  ];
  try {
    for (const { usage, expected } of cases) {
      const seen = [];
      globalThis.fetch = async () => ({
        ok: true,
        json: async () => ({ model: 'm', choices: [{ message: { content: 'ok' } }], usage }),
      });
      const content = await callLLM({ prompt: 'x', apiKey: 'k', model: 'm', onResponse: (m) => seen.push(m) });
      assert.equal(content, 'ok');
      assert.deepEqual(seen[0].cacheTokens, expected);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
test('callLLM sends response_format only when responseFormat is provided (#C2)', async () => {
  const originalFetch = globalThis.fetch;
  try {
    let body;
    globalThis.fetch = async (_url, opts) => {
      body = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ model: 'm', choices: [{ message: { content: 'ok' } }] }) };
    };
    await callLLM({ prompt: 'x', apiKey: 'k', model: 'm', responseFormat: { type: 'json_object' } });
    assert.deepEqual(body.response_format, { type: 'json_object' });
    // Omitted by default so endpoints that reject the field are unaffected.
    await callLLM({ prompt: 'x', apiKey: 'k', model: 'm' });
    assert.equal('response_format' in body, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('callLLM makes exactly maxRetries+1 transport attempts on a persistent retryable error (#C3)', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return { ok: false, status: 503, text: async () => 'unavailable', headers: { get: () => null } };
  };
  try {
    await assert.rejects(
      callLLM({ prompt: 'x', apiKey: 'k', maxRetries: 2, sleep: async () => {} }),
      (err) => err.status === 503,
    );
    // Transport retry is owned by callLLM: 1 initial attempt + 2 retries.
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function sseBody(lines) {
  const encoder = new globalThis.TextEncoder();
  return {
    async *[Symbol.asyncIterator]() {
      for (const line of lines) yield encoder.encode(`${line}\n`);
    },
  };
}

test('callLLM switches to SSE streaming when the attempt budget exceeds undici headersTimeout (#576)', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, opts) => {
    requestBody = JSON.parse(opts.body);
    return {
      ok: true,
      body: sseBody([
        'data: {"model":"gemma-4-31b","choices":[{"delta":{"role":"assistant","content":""}}]}',
        '',
        'data: {"choices":[{"delta":{"content":"hel"}}]}',
        'data: {"choices":[{"delta":{"content":"lo"}}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}',
        'data: [DONE]',
      ]),
      json: async () => { throw new Error('json() must not be used on a streamed response'); },
    };
  };
  try {
    const seen = [];
    const content = await callLLM({
      prompt: 'x',
      apiKey: 'k',
      model: 'm',
      timeout: 1_500_000, // 25min budget, past undici's 300s headersTimeout
      maxRetries: 0,
      onResponse: (meta) => seen.push(meta),
    });
    assert.equal(requestBody.stream, true, 'request must opt into SSE streaming');
    assert.equal(content, 'hello');
    assert.equal(seen[0].model, 'gemma-4-31b');
    assert.deepEqual(seen[0].usage, { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('callLLM keeps buffered (non-streaming) requests for budgets within headersTimeout (#576)', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, opts) => {
    requestBody = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
  };
  try {
    const content = await callLLM({ prompt: 'x', apiKey: 'k', model: 'm', timeout: 300_000 });
    assert.equal('stream' in requestBody, false, 'a 300s budget must stay non-streaming');
    assert.equal(content, 'ok');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('callLLM streaming clamps to the remaining deadline budget, not just timeout (#576)', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, opts) => {
    requestBody = JSON.parse(opts.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) };
  };
  try {
    // timeout asks for 25min but only 60s of deadline budget remains: the
    // effective attempt budget is under 300s, so streaming is not needed.
    const now = () => 1_000;
    await callLLM({ prompt: 'x', apiKey: 'k', model: 'm', timeout: 1_500_000, deadline: 61_000, now });
    assert.equal('stream' in requestBody, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('callLLM surfaces an empty streamed response as an error (#576)', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    body: sseBody(['data: {"choices":[{"delta":{},"finish_reason":"stop"}]}', 'data: [DONE]']),
  });
  try {
    await assert.rejects(
      callLLM({ prompt: 'x', apiKey: 'k', model: 'm', timeout: 400_000, maxRetries: 0 }),
      /Empty response/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('callLLM falls back to buffered JSON when a server ignores stream:true (#576)', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    headers: { get: (name) => (name === 'content-type' ? 'application/json' : null) },
    json: async () => ({ choices: [{ message: { content: 'buffered ok' } }] }),
  });
  try {
    const content = await callLLM({ prompt: 'x', apiKey: 'k', model: 'm', timeout: 600_000, maxRetries: 0 });
    assert.equal(content, 'buffered ok');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('callLLM drops temperature and retries once when the model rejects it (claude-sonnet-5)', async () => {
  const originalFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    bodies.push(body);
    if ('temperature' in body) {
      return {
        ok: false,
        status: 400,
        headers: { get: () => null },
        text: async () => '{"error":{"code":"invalid_request_error","message":"`temperature` is deprecated for this model."}}',
      };
    }
    return { ok: true, json: async () => ({ model: body.model, choices: [{ message: { content: 'ok' } }] }) };
  };
  try {
    let meta;
    const out = await callLLM({
      prompt: 'p', apiKey: 'k', model: 'temp-reject-buffered', maxRetries: 0,
      onResponse: (m) => { meta = m; },
    });
    assert.equal(out, 'ok');
    assert.equal(bodies.length, 2, 'exactly one drop-and-retry');
    assert.ok('temperature' in bodies[0], 'first attempt sends temperature');
    assert.ok(!('temperature' in bodies[1]), 'retry omits temperature');
    assert.equal(meta.temperature, null, 'metadata reflects the dropped field');

    // The model is remembered: the next call skips temperature up front.
    bodies.length = 0;
    await callLLM({ prompt: 'p', apiKey: 'k', model: 'temp-reject-buffered', maxRetries: 0 });
    assert.equal(bodies.length, 1);
    assert.ok(!('temperature' in bodies[0]), 'learned model skips temperature on the first attempt');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('callLLM does not strip temperature for unrelated 400s', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return { ok: false, status: 400, headers: { get: () => null }, text: async () => 'bad request: missing field' };
  };
  try {
    await assert.rejects(
      callLLM({ prompt: 'p', apiKey: 'k', model: 'temp-keep-model', maxRetries: 0 }),
      /400/
    );
    assert.equal(calls, 1, 'a generic 400 is not retried');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
