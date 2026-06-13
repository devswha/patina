import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';

import {
  resolveBackendMaxConcurrency,
  isRetryableBackendError,
  withBackendConcurrencySlot,
} from '../../src/backends/contract.js';

test('resolveBackendMaxConcurrency fails closed on an invalid override (#445)', () => {
  // claude-cli's default cap is 1; an invalid override must not disable it.
  assert.equal(resolveBackendMaxConcurrency('claude-cli', 0), 1);
  assert.equal(resolveBackendMaxConcurrency('claude-cli', -3), 1);
  assert.equal(resolveBackendMaxConcurrency('claude-cli', NaN), 1);
  // openai-http default cap is 4.
  assert.equal(resolveBackendMaxConcurrency('openai-http', 0), 4);
  // valid override applies; unset uses the backend default.
  assert.equal(resolveBackendMaxConcurrency('claude-cli', 2), 2);
  assert.equal(resolveBackendMaxConcurrency('claude-cli'), 1);
});

test('isRetryableBackendError honors message status even when err.status is null (#445)', () => {
  assert.equal(isRetryableBackendError({ status: null, message: 'HTTP 429 rate limited' }, { attemptIndex: 0 }), true);
  assert.equal(isRetryableBackendError({ status: null, message: 'HTTP 503 unavailable' }, { attemptIndex: 5 }), true);
  // a generic error with no rate-limit signal stays non-retryable.
  assert.equal(isRetryableBackendError({ status: null, message: 'bad request' }, { attemptIndex: 0 }), false);
});

function userSlotSegment() {
  try {
    const { uid, username } = userInfo();
    return Number.isInteger(uid) && uid >= 0
      ? `uid-${uid}`
      : String(username || 'user').replace(/[^a-z0-9._-]+/gi, '_');
  } catch {
    return 'user';
  }
}

test('a concurrency slot held by a dead pid is reclaimed immediately (#445)', async () => {
  const backendName = `test-fixture-${process.pid}-${Date.now()}`;
  const root = join(tmpdir(), `patina-backend-slots-${userSlotSegment()}`, backendName);
  mkdirSync(join(root, 'slot-0'), { recursive: true });
  // Owner pid that is provably dead (no such process) — must be reclaimed
  // without waiting for the staleMs window.
  writeFileSync(join(root, 'slot-0', 'owner.json'), JSON.stringify({ pid: 999_999_999, backendName }), 'utf8');

  try {
    let ran = false;
    const result = await withBackendConcurrencySlot({
      backendName,
      maxConcurrency: 1,
      timeout: 3000,
      pollMs: 25,
      staleMs: 60 * 60_000, // long, so only the pid-liveness path can reclaim
      fn: async () => { ran = true; return 'ok'; },
    });
    assert.equal(ran, true);
    assert.equal(result, 'ok');
  } finally {
    rmSync(join(tmpdir(), `patina-backend-slots-${userSlotSegment()}`, backendName), { recursive: true, force: true });
  }
});
