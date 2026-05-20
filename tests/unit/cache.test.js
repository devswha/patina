import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import {
  baseURLHost,
  createResponseCache,
  responseCacheKey,
} from '../../src/cache.js';

test('responseCacheKey includes prompt, model, temperature, and base URL host', () => {
  const base = responseCacheKey({
    prompt: 'prompt',
    model: 'gpt-4o',
    temperature: 0.7,
    baseURL: 'https://api.example.com/v1',
  });

  assert.match(base, /^sha256:[0-9a-f]{64}$/);
  assert.equal(base, responseCacheKey({
    prompt: 'prompt',
    model: 'gpt-4o',
    temperature: 0.7,
    baseURL: 'https://api.example.com/other',
  }));
  assert.notEqual(base, responseCacheKey({
    prompt: 'prompt',
    model: 'gpt-4o',
    temperature: 0,
    baseURL: 'https://api.example.com/v1',
  }));
});

test('baseURLHost preserves host and port for cache partitioning', () => {
  assert.equal(baseURLHost('http://127.0.0.1:1234/v1'), '127.0.0.1:1234');
});

test('createResponseCache stores hits and expires entries by TTL', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'patina-cache-'));
  let currentTime = 1_700_000_000_000;
  const cache = createResponseCache({
    dir,
    ttlSeconds: 1,
    now: () => currentTime,
  });
  const args = {
    prompt: 'prompt',
    model: 'gpt-4o',
    temperature: 0.7,
    baseURL: 'https://api.example.com/v1',
  };

  assert.equal(cache.get(args), null);
  cache.set(args, 'cached response', {
    model: 'served-model',
    usage: { prompt_tokens: 3, completion_tokens: 2 },
  });

  const hit = cache.get(args);
  assert.equal(hit.content, 'cached response');
  assert.equal(hit.responseModel, 'served-model');
  assert.deepEqual(hit.usage, { prompt_tokens: 3, completion_tokens: 2 });

  currentTime += 1001;
  assert.equal(cache.get(args), null);
  assert.deepEqual(cache.stats, {
    hits: 1,
    misses: 2,
    writes: 1,
    expired: 1,
    errors: 0,
  });
});
