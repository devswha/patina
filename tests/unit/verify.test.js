import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mpsResult, fidelityResult, zeroAnchorMps } from '../fixtures/verification-results.js';

import { assessRewriteMeaningSafety, deterministicMeaningGuard, verifyRewrite } from '../../src/verify.js';
import { SCORE_ERRORS } from '../../src/scoring.js';
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

test('assessRewriteMeaningSafety keeps vanished digits as dropped-numbers', () => {
  const result = assessRewriteMeaningSafety(
    'The service retains 12 audit logs.',
    'The service retains the audit logs.',
    'en',
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'dropped-numbers');
  assert.deepEqual(result.dropped, ['12']);
});

test('assessRewriteMeaningSafety flags claim-bag changes that keep digit tokens', () => {
  const cases = [
    ['The balance is -5 this quarter.', 'The balance is 5 this quarter.'],
    ['Choose one option before launch.', 'Choose two options before launch.'],
    ['Revenue grew after the pricing change.', 'Revenue grew 42% after the pricing change.'],
    ['We saw 10 and later another 10.', 'We saw 10.'],
  ];
  for (const [original, rewrite] of cases) {
    const result = assessRewriteMeaningSafety(original, rewrite, 'en');
    assert.equal(result.ok, false, original);
    assert.equal(result.reason, 'numeric-claim-changed', original);
    assert.deepEqual(result.dropped, []);
  }
});

test('assessRewriteMeaningSafety does not fail identity unsupported numeric syntax', () => {
  const result = assessRewriteMeaningSafety('The study reported p < 0.05.', 'The study reported p < 0.05.', 'en');
  assert.equal(result.ok, true);
  assert.equal(result.reason, null);
  assert.equal(result.numberSafety.reason, 'unsupported_numeric_syntax');
});

test('assessRewriteMeaningSafety still treats role-swapped bags as in-scope later work', () => {
  const result = assessRewriteMeaningSafety(
    'The team shipped 3 features and fixed 12 bugs.',
    'The team shipped 12 features and fixed 3 bugs.',
    'en',
  );
  assert.equal(result.ok, true);
  assert.equal(result.reason, null);
});

// ---------- verifyRewrite (injected scorers + callLLM) ----------

const baseArgs = {
  original: 'Original claim with the number 42.',
  config: {},
  patterns: [],
  documentType: null,
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
    scoreFns: { scoreMPS: async () => (mpsResult(90)), scoreFidelity: async () => (fidelityResult(10)) },
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
      scoreMPS: async ({ rewritten }) => mpsResult(rewritten === 'first' ? 50 : 90),
      scoreFidelity: async ({ rewritten }) => fidelityResult(rewritten === 'first' ? 6 : 11),
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
      scoreMPS: async ({ rewritten }) => mpsResult(rewritten === 'first-rw' ? 40 : 60),
      scoreFidelity: async ({ rewritten }) => fidelityResult(rewritten === 'first-rw' ? 6 : 8),
    },
  });
  assert.equal(result.verified, false);
  assert.equal(result.reason, 'floor-not-met');
  assert.equal(result.text, 'retry-rw');
  assert.equal(result.fidelity, 66.7);
});

test('verifyRewrite keeps the first rewrite when the retry call throws', async () => {
  const result = await verifyRewrite({
    ...baseArgs,
    rewrite: 'first',
    callLLM: async () => { throw new Error('network down'); },
    scoreFns: { scoreMPS: async () => (mpsResult(40)), scoreFidelity: async () => (fidelityResult(5)) },
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
      scoreMPS: async () => (mpsCalls++ === 0 ? { mps: null } : mpsResult(90)),
      scoreFidelity: async () => (fidelityResult(11)),
    },
  });
  assert.equal(result.retried, true);
  assert.equal(result.verified, true);
  assert.equal(result.text, 'retry');
});
test('verifyRewrite treats a null fidelity as a floor miss (fail closed)', async () => {
  let fidelityCalls = 0;
  const result = await verifyRewrite({
    ...baseArgs,
    rewrite: 'first',
    callLLM: async () => 'retry',
    scoreFns: {
      scoreMPS: async () => (mpsResult(90)),
      scoreFidelity: async () => (fidelityCalls++ === 0 ? { fidelity: null } : fidelityResult(11)),
    },
  });
  assert.equal(result.retried, true);
  assert.equal(result.verified, true);
  assert.equal(result.text, 'retry');
});


test('verifyRewrite refuses to certify a rewrite whose scorers were never reached', async () => {
  // A scorer that never got a verdict returns a null score carrying
  // SCORE_ERRORS.TRANSPORT_FAILURE. The gate reads `error != null`, so the new
  // value fails closed exactly like a schema failure on the CLI lane too: the
  // caller still gets text, but nothing claims it was verified.
  const unreached = {
    scoreMPS: async () => ({ mps: null, error: SCORE_ERRORS.TRANSPORT_FAILURE }),
    scoreFidelity: async () => ({ fidelity: null, error: SCORE_ERRORS.TRANSPORT_FAILURE }),
  };
  const result = await verifyRewrite({
    ...baseArgs,
    rewrite: 'first',
    callLLM: async () => 'retry',
    scoreFns: unreached,
  });
  assert.equal(result.verified, false);
  assert.equal(result.retried, true);
  assert.equal(result.reason, 'floor-not-met');
  assert.equal(result.mps, null);
  assert.equal(result.fidelity, 0);
});

test('verifyRewrite honors configured floors', async () => {
  // fidelity 75 passes the default 70 floor but fails an 80 floor → retry.
  let calls = 0;
  const result = await verifyRewrite({
    ...baseArgs,
    config: { verification: { 'mps-floor': 80, 'fidelity-floor': 80 } },
    rewrite: 'first',
    callLLM: async () => { calls += 1; return 'retry'; },
    scoreFns: {
      scoreMPS: async ({ rewritten }) => mpsResult(rewritten === 'first' ? 75 : 90),
      scoreFidelity: async ({ rewritten }) => fidelityResult(rewritten === 'first' ? 9 : 11),
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.verified, true);
  assert.equal(result.retried, true);
});
test('verifyRewrite keeps persona thresholds isolated from verification floors', async () => {
  let calls = 0;
  const result = await verifyRewrite({
    ...baseArgs,
    config: {
      verification: { 'mps-floor': 80, 'fidelity-floor': 80 },
      personas: { thresholds: { mps_floor: 95, fidelity_floor: 95 } },
    },
    rewrite: 'first',
    callLLM: async () => { calls += 1; return 'retry'; },
    scoreFns: {
      scoreMPS: async () => (mpsResult(85)),
      scoreFidelity: async () => (fidelityResult(10)),
    },
  });
  assert.equal(calls, 0);
  assert.equal(result.verified, true);
  assert.equal(result.retried, false);
});

// ---------- empty-anchor MPS (core/scoring.md "MPS = N/A") ----------

test('verifyRewrite refuses to certify an empty-anchor MPS when the source carries numeric claims', async () => {
  // core/scoring.md maps zero extracted anchors to "MPS = N/A", and src/scoring.js
  // renders that as mps: 100 because the JSON contract has no N/A. A perfect-looking
  // 100 must not certify a polarity inversion the scorer never actually checked.
  const result = await verifyRewrite({
    ...baseArgs,
    original: 'Revenue increased 20% last year.',
    rewrite: 'Revenue decreased 20% last year.',
    callLLM: async () => 'Revenue decreased 20% last year.',
    scoreFns: { scoreMPS: async () => zeroAnchorMps(), scoreFidelity: async () => fidelityResult(10) },
  });
  assert.equal(result.verified, false);
});

test('verifyRewrite still certifies an empty-anchor MPS when the source has no numeric claims', async () => {
  // The spec exempts genuinely claim-free text from the MPS floor; the guard must
  // not turn that exemption into a false failure, and must not spend a retry.
  let calls = 0;
  const result = await verifyRewrite({
    ...baseArgs,
    original: 'The garden felt quiet that morning.',
    rewrite: 'The garden was quiet that morning.',
    callLLM: async () => { calls += 1; return 'retry'; },
    scoreFns: { scoreMPS: async () => zeroAnchorMps(), scoreFidelity: async () => fidelityResult(10) },
  });
  assert.equal(result.verified, true);
  assert.equal(result.retried, false);
  assert.equal(calls, 0);
});

test('verifyRewrite still certifies a numeric source once the scorer extracted anchors', async () => {
  // Non-empty-anchor paths stay exactly as they were: the guard keys off zero
  // anchors, never off the presence of numbers alone.
  let calls = 0;
  const result = await verifyRewrite({
    ...baseArgs,
    original: 'Revenue increased 20% last year.',
    rewrite: 'Revenue rose 20% last year.',
    callLLM: async () => { calls += 1; return 'retry'; },
    scoreFns: { scoreMPS: async () => mpsResult(90), scoreFidelity: async () => fidelityResult(10) },
  });
  assert.equal(result.verified, true);
  assert.equal(result.retried, false);
  assert.equal(calls, 0);
});

// ---------- validateVerifyRequest ----------

test('validateVerifyRequest rejects non-rewrite modes', () => {
  for (const flag of ['score', 'audit', 'diff']) {
    assert.throws(
      () => validateVerifyRequest({ verify: true, [flag]: true }),
      /--verify cannot be combined/,
      flag,
    );
  }
});

test('validateVerifyRequest allows a plain verified rewrite and is a no-op without --verify', () => {
  assert.doesNotThrow(() => validateVerifyRequest({ verify: true, register: 'casual' }));
  assert.doesNotThrow(() => validateVerifyRequest({}));
});

test('the retired spelling follows the generic unknown-option exit-2 path', () => {
  const retiredOption = `--${['ouro', 'boros'].join('')}`;
  assert.throws(
    () => parseArgs([retiredOption, 'draft.md']),
    (error) => {
      const [summary] = String(error?.message).split('\n');
      return (
        error?.exitCode === 2
        && summary === `unknown option ${retiredOption}`
        && !/verify|migration|replace/i.test(error.message)
      );
    }
  );
});
