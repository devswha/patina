import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';

import {
  resolveBackendMaxConcurrency,
  isRetryableBackendError,
  withBackendConcurrencySlot,
  backendSupportsStructuredOutput,
  TimeoutError,
  isTimeoutError,
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

test('backendSupportsStructuredOutput is true only for openai-http (#C2)', () => {
  assert.equal(backendSupportsStructuredOutput('openai-http'), true);
  for (const cli of ['codex-cli', 'claude-cli', 'gemini-cli', 'kimi-cli']) {
    assert.equal(backendSupportsStructuredOutput(cli), false);
  }
  // Unknown backends fail closed: structured output is never sent.
  assert.equal(backendSupportsStructuredOutput('mystery-backend'), false);
});

test('isRetryableBackendError honors message status even when err.status is null (#445)', () => {
  assert.equal(isRetryableBackendError({ status: null, message: 'HTTP 429 rate limited' }, { attemptIndex: 0 }), true);
  assert.equal(isRetryableBackendError({ status: null, message: 'HTTP 503 unavailable' }, { attemptIndex: 5 }), true);
  // a generic error with no rate-limit signal stays non-retryable.
  assert.equal(isRetryableBackendError({ status: null, message: 'bad request' }, { attemptIndex: 0 }), false);
});

test('local CLI timeout-shaped errors are retryable/fallbackable (#525)', () => {
  const cliTimeout = new Error('claude-cli backend: timed out after 50ms');
  assert.equal(isTimeoutError(cliTimeout), true);
  assert.equal(isRetryableBackendError(cliTimeout, { attemptIndex: 0 }), true);

  const slotTimeout = new TimeoutError('claude-cli: timed out waiting for concurrency slot (cap 1)');
  assert.equal(isTimeoutError(slotTimeout), true);
  assert.equal(isRetryableBackendError(slotTimeout, { attemptIndex: 2 }), true);

  assert.equal(isTimeoutError(new Error('unauthorized')), false);
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

test('isRetryableBackendError falls through timeout/abort at any non-final hop (#506 defect 2)', () => {
  // Previously gated to attemptIndex === 0; a per-attempt timeout/abort is now
  // fallbackable at every hop, exactly like a 429/503. The chain caller stops
  // at the final hop via `!next`, so the predicate itself carries no gate.
  assert.equal(isRetryableBackendError({ name: 'TimeoutError' }, { attemptIndex: 1 }), true);
  assert.equal(isRetryableBackendError({ name: 'TimeoutError' }, { attemptIndex: 2 }), true);
  assert.equal(isRetryableBackendError({ name: 'AbortError' }, { attemptIndex: 3 }), true);
  // Regression guard: the original first-hop case still works.
  assert.equal(isRetryableBackendError({ name: 'AbortError' }, { attemptIndex: 0 }), true);
  // A user-initiated abort (signal.aborted) must NEVER fall through, at any hop.
  const aborted = { aborted: true }; // isRetryableBackendError only reads signal.aborted
  assert.equal(isRetryableBackendError({ name: 'TimeoutError' }, { attemptIndex: 1, signal: aborted }), false);
  assert.equal(isRetryableBackendError({ name: 'AbortError' }, { attemptIndex: 0, signal: aborted }), false);
  // A plain, non-timeout/abort error stays non-retryable regardless of index.
  assert.equal(isRetryableBackendError({ name: 'Error', message: 'boom' }, { attemptIndex: 1 }), false);
});

test('withBackendConcurrencySlot threads the remaining shared deadline into the run phase (#506 defect 1)', async () => {
  const backendName = `test-deadline-${process.pid}-${Date.now()}`;
  const slotRoot = join(tmpdir(), `patina-backend-slots-${userSlotSegment()}`, backendName);
  mkdirSync(join(slotRoot, 'slot-0'), { recursive: true });
  // A LIVE owner (this process) holds the only slot, so acquisition has to wait
  // until we release it — simulating a saturated cap. A long staleMs ensures the
  // age-based reclaim never fires; pid-liveness keeps the slot held until release.
  writeFileSync(join(slotRoot, 'slot-0', 'owner.json'), JSON.stringify({ pid: process.pid, backendName }), 'utf8');

  const budgetMs = 600;
  const releaseAfterMs = 150;
  const start = Date.now();
  const releaser = setTimeout(() => {
    rmSync(join(slotRoot, 'slot-0'), { recursive: true, force: true });
  }, releaseAfterMs);

  try {
    let received = null;
    const result = await withBackendConcurrencySlot({
      backendName,
      maxConcurrency: 1,
      timeout: budgetMs,
      deadline: start + budgetMs,
      pollMs: 25,
      staleMs: 60 * 60_000,
      fn: async (remainingTimeout) => { received = remainingTimeout; return 'ran'; },
    });
    const waited = Date.now() - start;

    assert.equal(result, 'ran');
    // The run phase received a REDUCED budget — the slot wait was deducted from
    // the single shared deadline, so it is strictly less than the full budget.
    assert.ok(received > 0, `expected a positive remaining budget, got ${received}`);
    assert.ok(received < budgetMs, `expected remaining < ${budgetMs}, got ${received}`);
    // The defect: wait + run could each consume the full timeout (2x wall-clock).
    // With one shared deadline, wait + remaining-run can never exceed the budget.
    assert.ok(
      waited + received <= budgetMs + 25,
      `slot wait(${waited}) + run budget(${received}) exceeded shared budget ${budgetMs}`
    );
  } finally {
    clearTimeout(releaser);
    rmSync(join(tmpdir(), `patina-backend-slots-${userSlotSegment()}`, backendName), { recursive: true, force: true });
  }
});

test('withBackendConcurrencySlot hands the full timeout to an uncapped backend when no deadline is given', async () => {
  // Backward compatibility: callers that pass only `timeout` (no `deadline`)
  // still drive the run phase with (essentially) the full budget. Infinite cap
  // skips slot acquisition, so almost no time is deducted.
  let received = null;
  const result = await withBackendConcurrencySlot({
    backendName: 'uncapped',
    maxConcurrency: Infinity,
    timeout: 5000,
    fn: async (remainingTimeout) => { received = remainingTimeout; return 'ok'; },
  });
  assert.equal(result, 'ok');
  assert.ok(received > 4000 && received <= 5000, `expected ~full budget, got ${received}`);
});

test('withBackendConcurrencySlot refuses to start fn after the shared deadline expired (#567)', async () => {
  let invoked = false;
  await assert.rejects(
    withBackendConcurrencySlot({
      backendName: `test-expired-${process.pid}-${Date.now()}`,
      maxConcurrency: 1,
      deadline: Date.now() - 1000,
      fn: () => { invoked = true; },
    }),
    (err) => isTimeoutError(err)
  );
  assert.equal(invoked, false, 'fn must not run on a spent budget');
});

test('uncapped backends also refuse an expired shared deadline (#567)', async () => {
  let invoked = false;
  await assert.rejects(
    withBackendConcurrencySlot({
      backendName: 'test-expired-uncapped',
      maxConcurrency: Infinity,
      deadline: Date.now() - 1000,
      fn: () => { invoked = true; },
    }),
    (err) => isTimeoutError(err)
  );
  assert.equal(invoked, false, 'uncapped path must not run fn with remainingTimeout 0');
});
