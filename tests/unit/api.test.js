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
