import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  HttpError,
  isRetryable,
  computeBackoffMs,
  createSemaphore,
  callLLM,
  callLLMMultiple,
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

test('createSemaphore(0) is a no-op (existing parallel behavior)', async () => {
  const sem = createSemaphore(0);
  const r1 = await sem.acquire();
  const r2 = await sem.acquire();
  assert.equal(typeof r1, 'function');
  assert.equal(typeof r2, 'function');
  r1();
  r2();
});

test('callLLMMultiple defaults to a safe concurrency cap of min(models, 3)', async () => {
  const originalFetch = globalThis.fetch;
  let active = 0;
  let peak = 0;
  globalThis.fetch = async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    };
  };

  try {
    const results = await callLLMMultiple({
      prompt: 'x',
      apiKey: 'test',
      models: ['m1', 'm2', 'm3', 'm4', 'm5'],
    });
    assert.equal(results.length, 5);
    assert.equal(peak, 3, 'default semaphore queues instead of fanning out');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('callLLMMultiple accepts callLLM, now, and sleep injectables', async () => {
  const seen = [];
  const now = () => 456;
  const sleep = async () => {};
  const results = await callLLMMultiple({
    prompt: 'x',
    apiKey: 'test',
    models: ['m1', 'm2'],
    callLLM: async (args) => {
      seen.push(args);
      assert.strictEqual(args.now, now);
      assert.strictEqual(args.sleep, sleep);
      return `ok:${args.model}`;
    },
    now,
    sleep,
  });

  assert.deepStrictEqual(results, [
    { model: 'm1', result: 'ok:m1', ok: true },
    { model: 'm2', result: 'ok:m2', ok: true },
  ]);
  assert.strictEqual(seen.length, 2);
});

test('createSemaphore enforces concurrency cap and drains the queue', async () => {
  const sem = createSemaphore(2);
  let active = 0;
  let peak = 0;
  const work = async () => {
    const release = await sem.acquire();
    active++;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    release();
  };
  await Promise.all([work(), work(), work(), work(), work()]);
  assert.equal(peak, 2, 'never exceeds cap');
  assert.equal(active, 0, 'all releases run');
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
