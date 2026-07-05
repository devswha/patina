import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deterministicMeaningGuard, verifyRewrite } from '../../src/verify.js';
import { validateVerifyRequest, parseArgs } from '../../src/cli/args.js';

// ---------- deterministicMeaningGuard (no LLM) ----------

test('deterministicMeaningGuard flags numbers dropped from the source', () => {
  const warnings = deterministicMeaningGuard('Revenue grew 42% to 1.5M in 2025.', 'Revenue grew a lot recently.');
  assert.ok(warnings.some((w) => /numbers/.test(w)), warnings.join(' | '));
});

test('deterministicMeaningGuard stays silent when numbers and length are preserved', () => {
  const original = 'The team shipped 3 features and fixed 12 bugs across this sprint cycle.';
  const rewrite = 'The team shipped 3 features and fixed 12 bugs during this sprint.';
  assert.deepEqual(deterministicMeaningGuard(original, rewrite), []);
});

test('deterministicMeaningGuard treats grouped and plain numbers as equal (1,200 === 1200)', () => {
  assert.deepEqual(
    deterministicMeaningGuard('We reached 1200 users and 42% growth.', 'We reached 1,200 users with 42% growth.'),
    [],
  );
});

test('deterministicMeaningGuard preserves non-standard grouping so a dropped 1,2 is not masked by 12', () => {
  // Valid thousands grouping still normalizes (no false positive).
  assert.deepEqual(deterministicMeaningGuard('n 1,234,567', 'n 1234567'), []);
  // "1,2" (list/version/coordinate) must NOT collapse onto "12": dropping it
  // while the rewrite happens to contain 12 must still flag on the enforcing guard.
  const warnings = deterministicMeaningGuard('rated 1,2 overall', 'rated 12 overall');
  assert.ok(warnings.some((w) => /numbers/.test(w)), warnings.join(' | '));
});

// ---------- verifyRewrite (injected scorers + callLLM) ----------

const baseArgs = {
  original: 'Original claim with the number 42.',
  config: {},
  patterns: [],
  profile: null,
  voice: null,
  scoring: null,
  apiKey: 'k',
  baseURL: 'b',
  model: 'm',
  logger: { warn() {}, info() {} },
};

test('verifyRewrite accepts the first rewrite when both floors pass (no retry)', async () => {
  let calls = 0;
  const result = await verifyRewrite({
    ...baseArgs,
    rewrite: 'good rewrite',
    callLLM: async () => { calls += 1; return 'RETRY'; },
    scoreFns: { scoreMPS: async () => ({ mps: 90 }), scoreFidelity: async () => ({ fidelity: 85 }) },
  });
  assert.equal(result.verified, true);
  assert.equal(result.retried, false);
  assert.equal(result.text, 'good rewrite');
  assert.equal(calls, 0);
});

test('verifyRewrite retries conservatively and accepts a passing retry', async () => {
  let calls = 0;
  const result = await verifyRewrite({
    ...baseArgs,
    rewrite: 'first',
    callLLM: async () => { calls += 1; return '[BODY]second[/BODY]'; },
    scoreFns: {
      scoreMPS: async ({ rewritten }) => ({ mps: rewritten === 'first' ? 50 : 90 }),
      scoreFidelity: async ({ rewritten }) => ({ fidelity: rewritten === 'first' ? 50 : 88 }),
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.verified, true);
  assert.equal(result.retried, true);
  assert.equal(result.text, 'second');
});

test('verifyRewrite fails closed to the highest-fidelity candidate', async () => {
  const result = await verifyRewrite({
    ...baseArgs,
    rewrite: 'first-rw',
    callLLM: async () => 'retry-rw',
    scoreFns: {
      scoreMPS: async ({ rewritten }) => ({ mps: rewritten === 'first-rw' ? 40 : 60 }),
      scoreFidelity: async ({ rewritten }) => ({ fidelity: rewritten === 'first-rw' ? 50 : 65 }),
    },
  });
  assert.equal(result.verified, false);
  assert.equal(result.reason, 'floor-not-met');
  assert.equal(result.text, 'retry-rw');
  assert.equal(result.fidelity, 65);
});

test('verifyRewrite keeps the first rewrite when the retry call throws', async () => {
  const result = await verifyRewrite({
    ...baseArgs,
    rewrite: 'first',
    callLLM: async () => { throw new Error('network down'); },
    scoreFns: { scoreMPS: async () => ({ mps: 40 }), scoreFidelity: async () => ({ fidelity: 40 }) },
  });
  assert.equal(result.verified, false);
  assert.equal(result.reason, 'retry-error');
  assert.equal(result.text, 'first');
});

test('verifyRewrite treats a null MPS as a floor miss (fail closed)', async () => {
  let mpsCalls = 0;
  const result = await verifyRewrite({
    ...baseArgs,
    rewrite: 'first',
    callLLM: async () => 'retry',
    scoreFns: {
      scoreMPS: async () => (mpsCalls++ === 0 ? { mps: null } : { mps: 90 }),
      scoreFidelity: async () => ({ fidelity: 90 }),
    },
  });
  assert.equal(result.retried, true);
  assert.equal(result.verified, true);
  assert.equal(result.text, 'retry');
});

test('verifyRewrite honors configured floors', async () => {
  // fidelity 75 passes the default 70 floor but fails an 80 floor → retry.
  let calls = 0;
  const result = await verifyRewrite({
    ...baseArgs,
    config: { ouroboros: { 'mps-floor': 80, 'fidelity-floor': 80 } },
    rewrite: 'first',
    callLLM: async () => { calls += 1; return 'retry'; },
    scoreFns: {
      scoreMPS: async ({ rewritten }) => ({ mps: rewritten === 'first' ? 75 : 90 }),
      scoreFidelity: async ({ rewritten }) => ({ fidelity: rewritten === 'first' ? 75 : 90 }),
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.verified, true);
  assert.equal(result.retried, true);
});

// ---------- validateVerifyRequest ----------

test('validateVerifyRequest rejects non-rewrite and preview surfaces', () => {
  for (const flag of ['score', 'audit', 'diff', 'preview']) {
    assert.throws(
      () => validateVerifyRequest({ verify: true, [flag]: true }),
      /--verify cannot be combined/,
      flag,
    );
  }
});

test('validateVerifyRequest allows a plain verified rewrite and is a no-op without --verify', () => {
  assert.doesNotThrow(() => validateVerifyRequest({ verify: true, jargon: 'remove' }));
  assert.doesNotThrow(() => validateVerifyRequest({}));
});

test('the removed --ouroboros flag is rejected at parse time', () => {
  assert.throws(() => parseArgs(['--ouroboros', 'draft.md']), /--ouroboros was removed/);
});
