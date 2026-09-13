import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';

import {
  resolveBackendMaxConcurrency,
  isRetryableBackendError,
  withBackendConcurrencySlot,
  backendSupportsStructuredOutput,
  spawnOwnedCliProcess,
  TimeoutError,
  isTimeoutError,
} from '../../src/backends/contract.js';

class FakePipe extends EventEmitter {
  constructor() {
    super();
    this.destroyed = false;
    this.destroyCalls = 0;
  }

  destroy() {
    if (this.destroyed) return this;
    this.destroyed = true;
    this.destroyCalls += 1;
    this.emit('close');
    return this;
  }
}

class FakeChild extends EventEmitter {
  constructor(pid) {
    super();
    this.pid = pid;
    this.killed = false;
    this.killSignals = [];
    this.stdin = new FakePipe();
    this.stdout = new FakePipe();
    this.stderr = new FakePipe();
    for (const stream of [this.stdin, this.stdout, this.stderr]) {
      stream.once('close', () => {
        if ([this.stdin, this.stdout, this.stderr].every((pipe) => pipe.destroyed)) {
          globalThis.queueMicrotask(() => this.emit('close', 0, null));
        }
      });
    }
  }

  kill(signal) {
    this.killed = true;
    this.killSignals.push(signal);
    return true;
  }
}

test('spawnOwnedCliProcess preserves normal output and closes direct-child pipes only on termination', async () => {
  const normalChild = new FakeChild(4101);
  const normal = spawnOwnedCliProcess('fixture', [], {}, {
    platform: 'win32',
    spawnImpl: () => normalChild,
  });
  const normalClose = normal.waitForClose();
  normalChild.emit('exit', 0, null);
  for (const stream of [normalChild.stdin, normalChild.stdout, normalChild.stderr]) {
    assert.equal(stream.destroyed, false, 'normal exit must allow buffered output to drain');
  }
  normalChild.emit('close', 0, null);
  assert.deepEqual(await normalClose, { code: 0, signal: null });

  // If cancellation/timeout arrives after the leader exit, closing the
  // parent-owned streams still breaks a descendant-held pipe promptly.
  const exitedChild = new FakeChild(4102);
  const exited = spawnOwnedCliProcess('fixture', [], {}, {
    platform: 'win32',
    spawnImpl: () => exitedChild,
  });
  const exitedClose = exited.waitForClose();
  exitedChild.emit('exit', null, 'SIGKILL');
  exited.terminate('SIGKILL');
  const exitedResult = await exitedClose;
  assert.deepEqual(exitedResult, { code: 0, signal: null });
  for (const stream of [exitedChild.stdin, exitedChild.stdout, exitedChild.stderr]) {
    assert.equal(stream.destroyed, true);
    assert.equal(stream.destroyCalls, 1);
  }
  assert.deepEqual(exitedChild.killSignals, ['SIGKILL']);

  // Conversely, termination before the leader's exit must defer pipe closure
  // until the exit event confirms the direct child is gone.
  const pendingChild = new FakeChild(4103);
  const pending = spawnOwnedCliProcess('fixture', [], {}, {
    platform: 'win32',
    spawnImpl: () => pendingChild,
  });
  const pendingClose = pending.waitForClose();
  pending.terminate('SIGKILL');
  assert.equal(pendingChild.stdout.destroyed, false);
  pendingChild.emit('exit', null, 'SIGKILL');
  assert.deepEqual(await pendingClose, { code: 0, signal: null });

  const posixChild = new FakeChild(4104);
  let posixOptions;
  const groupSignals = [];
  const posix = spawnOwnedCliProcess('fixture', [], {}, {
    platform: 'linux',
    spawnImpl: (_command, _args, options) => {
      posixOptions = options;
      return posixChild;
    },
    killImpl: (pid, signal) => groupSignals.push({ pid, signal }),
  });
  const posixClose = posix.waitForClose();
  posixChild.emit('exit', 0, null);
  assert.equal(posixOptions.detached, true);
  assert.deepEqual(groupSignals, [{ pid: -4104, signal: 'SIGKILL' }]);
  assert.equal(posixChild.stdout.destroyed, false);
  posixChild.emit('close', 0, null);
  assert.deepEqual(await posixClose, { code: 0, signal: null });
});

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
  for (const cli of ['codex-cli', 'claude-cli', 'gemini-cli', 'kimi-cli', 'agy-cli']) {
    assert.equal(backendSupportsStructuredOutput(cli), false);
  }
  // Unknown backends fail closed: structured output is never sent.
  assert.equal(backendSupportsStructuredOutput('mystery-backend'), false);
});

// Shared shape check for a verified real-invocation compatibility record: the
// fixture carries the verdict, the dated operations receipt carries the
// per-scenario evidence, and neither may contain secrets or raw output.
function assertVerifiedBackendRecord(fixture, { backend, cli, version, record }) {
  assert.equal(fixture.schemaVersion, 1);
  assert.equal(fixture.backend, backend);
  assert.equal(fixture.cli, cli);
  assert.equal(fixture.observedVersion, version);
  assert.equal(fixture.status, 'verified');
  assert.equal(fixture.evidence.kind, 'real-invocation');
  assert.equal(fixture.evidence.realInvocation, true);
  assert.equal(fixture.evidence.record, record);
  assert.equal(existsSync(new URL(`../../${record}`, import.meta.url)), true);
  for (const flag of ['outputParsingVerified', 'errorsVerified', 'authVerified', 'timeoutVerified']) {
    assert.equal(fixture.evidence[flag], true, flag);
  }
  // Quota was never exercised; a verified record must not imply it was.
  assert.equal(fixture.evidence.quotaVerified, false);
  assert.equal(fixture.syntheticFixture, false);
  assert.equal(fixture.rawOutputIncluded, false);
  assert.deepEqual(Object.keys(fixture.requiredContracts), ['output', 'errors', 'auth', 'quota', 'timeout']);
  for (const key of ['credentials', 'prompt', 'response']) {
    assert.equal(Object.hasOwn(fixture, key), false, key);
  }
  assert.ok(Number.isInteger(fixture.scope.invocations) && fixture.scope.invocations > 0);
}

test('Claude CLI compatibility record is a real-invocation verification without raw output', () => {
  const fixture = JSON.parse(readFileSync(
    new URL('../fixtures/backend-claude-contract.json', import.meta.url),
    'utf8',
  ));
  assertVerifiedBackendRecord(fixture, {
    backend: 'claude-cli',
    cli: 'claude',
    version: '2.1.269',
    record: 'docs/operations/backend-compat-kimi-gemini-agy-20260913.json',
  });
  // Earlier statuses are retained as history, not erased.
  assert.match(fixture.history['2026-09-09'], /version-only/);
  assert.match(fixture.history['2026-09-10'], /2\.1\.261/);
});

test('Codex CLI compatibility record is a real-invocation verification without raw output', () => {
  const fixture = JSON.parse(readFileSync(
    new URL('../fixtures/backend-codex-contract.json', import.meta.url),
    'utf8',
  ));
  assertVerifiedBackendRecord(fixture, {
    backend: 'codex-cli',
    cli: 'codex',
    version: '0.154.0',
    record: 'docs/operations/backend-compat-kimi-gemini-agy-20260913.json',
  });
  assert.match(fixture.history['2026-09-10'], /0\.153\.4/);
});

test('Kimi CLI compatibility record is a real-invocation verification without raw output', () => {
  const fixture = JSON.parse(readFileSync(
    new URL('../fixtures/backend-kimi-contract.json', import.meta.url),
    'utf8',
  ));
  assertVerifiedBackendRecord(fixture, {
    backend: 'kimi-cli',
    cli: 'kimi',
    version: '0.42.0',
    record: 'docs/operations/backend-compat-kimi-gemini-agy-20260913.json',
  });
  // The OAuth-path verification is what upgraded this record from not-exercised.
  assert.match(fixture.scope.authPath, /OAuth session/);
  assert.match(fixture.scope.authPath, /KIMI_API_KEY and MOONSHOT_API_KEY were unset/);
});

test('Gemini CLI compatibility record is a real-invocation verification without raw output', () => {
  const fixture = JSON.parse(readFileSync(
    new URL('../fixtures/backend-gemini-contract.json', import.meta.url),
    'utf8',
  ));
  assertVerifiedBackendRecord(fixture, {
    backend: 'gemini-cli',
    cli: 'gemini',
    version: '0.59.0',
    record: 'docs/operations/backend-compat-kimi-gemini-agy-20260913.json',
  });
  // Verified over personal OAuth with the product env key unset, per policy.
  assert.match(fixture.scope.authPath, /oauth-personal/);
  assert.match(fixture.scope.authPath, /GEMINI_API_KEY was unset/);
});

test('Antigravity CLI compatibility record is a real-invocation verification without raw output', () => {
  const fixture = JSON.parse(readFileSync(
    new URL('../fixtures/backend-agy-contract.json', import.meta.url),
    'utf8',
  ));
  assertVerifiedBackendRecord(fixture, {
    backend: 'agy-cli',
    cli: 'agy',
    version: '1.2.2',
    record: 'docs/operations/backend-compat-kimi-gemini-agy-20260913.json',
  });
  // This backend has no API-key path at all; the verdict is plan-backed OAuth.
  assert.match(fixture.scope.authPath, /no API-key path/);
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
