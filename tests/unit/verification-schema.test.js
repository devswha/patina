import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMps, validateFidelityCriteria, validateFidelityResult, evaluateVerification } from '../../src/verification-schema.js';
import { scoreMPS, scoreFidelity, SCORE_ERRORS } from '../../src/scoring.js';
import { verifyRewrite } from '../../src/verify.js';
import { runWebRewriteStream } from '../../src/web-rewrite-stream.js';
import { validateRawMps, validateRawFidelity } from '../../scripts/research/study-validation.mjs';
import { mpsResult, fidelityResult, zeroAnchorMps, highHardFailMps } from '../fixtures/verification-results.js';

const logger = { warn() {} };
const criteria = { claims_preserved: 3, no_fabrication: 3, audience_register_match: 3 };
const scoreOptions = { original: 'A factual draft.', rewritten: 'A factual draft.', logger };
const mixed = {
  anchors: [
    { type: 'claim', content: 'The switch exists.', verdict: 'PASS' },
    { type: 'polarity', content: 'It is useful.', verdict: 'PASS' },
    { type: 'negation', content: 'It does not log messages.', verdict: 'SOFT_FAIL' },
  ],
  pass_count: 2, total_count: 3, polarity_pass_count: 1, polarity_total_count: 2, mps: 60,
};

test('MPS validates the weighted Polarity + Negation group and preserves rounded scores', () => {
  assert.equal(validateMps(mixed).mps, 60);
  assert.equal(validateRawMps(JSON.stringify(mixed)).mps, 60);
  assert.throws(() => validateMps({ ...mixed, polarity_total_count: 1 }), /inconsistent-mps-counts/);
  assert.throws(() => validateMps({ ...mixed, mps: 80 }), /inconsistent-mps-score/);
  const rounded = { ...mixed, anchors: mixed.anchors.map((anchor) => ({ ...anchor, type: 'claim' })), polarity_pass_count: 0, polarity_total_count: 0, mps: 66.7 };
  assert.equal(validateMps(rounded).mps, 66.7);
  assert.throws(() => validateMps({ ...rounded, mps: 67 }), /inconsistent-mps-score/);
});

test('zero-anchor 100 is valid; high HARD_FAIL is retained as evidence but cannot verify', () => {
  const zero = zeroAnchorMps();
  assert.equal(evaluateVerification({ mps: zero, fidelity: fidelityResult() }).ok, true);
  const hard = highHardFailMps();
  assert.equal(validateMps(hard).mps, 95);
  assert.equal(validateRawMps(JSON.stringify(hard)).hard_fail_count, 1);
  // Historical wrappers always derived this optional count, retaining raw
  // observations. Production rejects a conflicting count instead.
  assert.equal(validateRawMps(JSON.stringify({ ...hard, hard_fail_count: 0 })).hard_fail_count, 1);
  assert.throws(() => validateMps({ ...hard, hard_fail_count: 0 }), /inconsistent-mps-counts/);
  assert.deepEqual(evaluateVerification({ mps: hard, fidelity: fidelityResult() }), { ok: false, failed: ['mps'] });
  assert.equal(evaluateVerification({ mps: hard, fidelity: fidelityResult() }, { mpsFloor: 0, fidelityFloor: 0 }).ok, false);
});

test('fidelity result arithmetic, criteria ranges and numeric floor upper bounds are checked', () => {
  assert.equal(validateFidelityResult(fidelityResult(11)).fidelity, 91.7);
  assert.throws(() => validateFidelityResult({ ...fidelityResult(6), fidelity: 100 }), /inconsistent-fidelity-score/);
  for (const value of [99, -1, 3.5, '3', null, true]) {
    const raw = { ...criteria, claims_preserved: value };
    assert.throws(() => validateFidelityCriteria(raw), /invalid-fidelity-schema/);
    assert.throws(() => validateRawFidelity(JSON.stringify(raw)), /invalid-fidelity-schema/);
  }
  assert.deepEqual(evaluateVerification({ mps: { mps: 100 }, fidelity: { fidelity: 100 } }), { ok: false, failed: ['mps', 'fidelity'] });
});

test('semantic MPS errors use exactly the existing correction retry and keep the raw failure', async () => {
  const invalid = [
    { anchors: [{ type: 'negation', verdict: 'HARD_FAIL', content: 'not retained' }], pass_count: 0, total_count: 1, polarity_pass_count: 0, polarity_total_count: 1, mps: 100 },
    { ...mpsResult(), pass_count: 0 },
    { ...mixed, polarity_total_count: 1 },
    { ...zeroAnchorMps(), mps: 0 },
    { ...mpsResult(), mps: '100' },
    { ...mpsResult(), mps: 101 },
    { ...mpsResult(), total_count: 1.5 },
    { ...mpsResult(), anchors: [{ type: 'unknown', content: 'a', verdict: 'PASS' }] },
    { ...mpsResult(), anchors: [{ type: 'claim', content: '', verdict: 'PASS' }] },
    { mps: 100 },
  ];
  for (const value of invalid) {
    const temperatures = [];
    const raw = JSON.stringify(value);
    const result = await scoreMPS({ ...scoreOptions, callLLM: async ({ temperature }) => { temperatures.push(temperature); return raw; } });
    assert.equal(result.mps, null, raw);
    assert.equal(result.error, 'schema-failure', raw);
    assert.equal(result.raw, raw);
    assert.deepEqual(temperatures, [0.1, 0]);
  }
});

test('malformed fidelity never clamps, and corrected MPS/fidelity use bounded retry telemetry', async () => {
  for (const value of [{ claims_preserved: 99, no_fabrication: 99, audience_register_match: 99 }, {}, { ...criteria, no_fabrication: '3' }]) {
    const raw = JSON.stringify(value);
    let calls = 0;
    const result = await scoreFidelity({ ...scoreOptions, callLLM: async () => { calls++; return raw; } });
    assert.equal(calls, 2);
    assert.equal(result.fidelity, null);
    assert.equal(result.criteria.claims_preserved, null);
    assert.equal(result.error, 'schema-failure');
    assert.equal(result.raw, raw);
  }
  for (const [score, bad, good] of [
    [scoreMPS, { ...zeroAnchorMps(), mps: 90 }, zeroAnchorMps()],
    [scoreFidelity, { ...criteria, claims_preserved: 99 }, criteria],
  ]) {
    const temperatures = [], attempts = [];
    const result = await score({ ...scoreOptions, onAttempt: (record) => attempts.push(record), callLLM: async ({ temperature, onAttempt }) => {
      temperatures.push(temperature);
      onAttempt({ attemptIndex: 1, requestedModel: 'test', effectiveModel: 'test', usage: null, retryReason: 'initial', minimumChargeApplied: false, outcome: 'success' });
      return JSON.stringify(temperatures.length === 1 ? bad : good);
    } });
    assert.equal(result.error, undefined);
    assert.deepEqual(temperatures, [0.1, 0]);
    assert.deepEqual(attempts.map(({ attemptIndex, retryReason, outcome }) => ({ attemptIndex, retryReason, outcome })), [
      { attemptIndex: 1, retryReason: 'score_schema_parse', outcome: 'error' },
      { attemptIndex: 2, retryReason: 'initial', outcome: 'success' },
    ]);
  }
});

test('consistent HARD_FAIL is an observation, not a schema error to retry away', async () => {
  let calls = 0;
  const result = await scoreMPS({ ...scoreOptions, callLLM: async () => { calls++; return JSON.stringify(highHardFailMps()); } });
  assert.equal(calls, 1);
  assert.equal(result.mps, 95);
  assert.equal(result.hard_fail_count, 1);
  assert.equal(result.error, undefined);
});

test('web and CLI runtime gates reject forged full results and hard fails, preserving failed text', async () => {
  const bad = [
    [{ ...mpsResult(), pass_count: 0 }, fidelityResult(), ['mps']],
    [{ ...mixed, polarity_total_count: 1, mps: 100 }, fidelityResult(), ['mps']],
    [mpsResult(), { ...fidelityResult(), criteria: { ...fidelityResult().criteria, claims_preserved: 99 } }, ['fidelity']],
    [highHardFailMps(), fidelityResult(), ['mps']],
    [mpsResult(), { ...fidelityResult(6), fidelity: 100 }, ['fidelity']],
    [{ ...mpsResult(), error: 'schema-failure' }, fidelityResult(), ['mps']],
    [mpsResult(), { ...fidelityResult(), error: 'schema-failure' }, ['fidelity']],
  ];
  for (const [mps, fidelity, failed] of bad) {
    const scoreFns = { scoreMPS: async () => mps, scoreFidelity: async () => fidelity, scoreDeterministicSignals: () => ({}) };
    const frames = [];
    const web = await runWebRewriteStream({
      request: { mode: 'first', tier: 'byok', lang: 'en', text: 'A factual draft.', original: 'A factual draft.', history: [] },
      config: { language: 'en' }, scoreFns, emit: (frame) => frames.push(frame),
      callLLMStream: async () => ({ text: 'A factual draft.' }),
    });
    assert.equal(web.ok, false);
    assert.equal(web.code, 'floor_failed');
    assert.deepEqual(web.failed, failed);
    assert.equal(frames.some((frame) => frame.type === 'done'), false);
    let rewriteCalls = 0;
    const cli = await verifyRewrite({ original: 'A factual draft.', rewrite: 'A factual draft.', config: {}, patterns: [], scoreFns, logger,
      callLLM: async () => { rewriteCalls++; return 'A factual draft.'; } });
    assert.equal(cli.verified, false);
    assert.equal(cli.text, 'A factual draft.');
    assert.equal(cli.retried, true);
    assert.equal(rewriteCalls, 1);
  }
});

test('the runtime gate refuses a score whose judge was never reached', async () => {
  // Same refusal as a schema failure — `error != null` is the rule — but the
  // web surface separates the two so it never reports a meaning-floor failure
  // for a rewrite that was never scored.
  const unreachedMps = { mps: null, error: SCORE_ERRORS.TRANSPORT_FAILURE };
  const unreachedFidelity = { fidelity: null, error: SCORE_ERRORS.TRANSPORT_FAILURE };
  assert.deepEqual(evaluateVerification({ mps: unreachedMps, fidelity: fidelityResult() }).failed, ['mps']);
  assert.deepEqual(evaluateVerification({ mps: mpsResult(), fidelity: unreachedFidelity }).failed, ['fidelity']);
  assert.deepEqual(evaluateVerification({ mps: unreachedMps, fidelity: unreachedFidelity }).failed, ['mps', 'fidelity']);

  for (const [mps, fidelity] of [[unreachedMps, fidelityResult()], [mpsResult(), unreachedFidelity]]) {
    const scoreFns = { scoreMPS: async () => mps, scoreFidelity: async () => fidelity, scoreDeterministicSignals: () => ({}) };
    const frames = [];
    const web = await runWebRewriteStream({
      request: { mode: 'first', tier: 'byok', lang: 'en', text: 'A factual draft.', original: 'A factual draft.', history: [] },
      config: { language: 'en' }, scoreFns, emit: (frame) => frames.push(frame),
      callLLMStream: async () => ({ text: 'A factual draft.' }),
    });
    assert.equal(web.ok, false);
    assert.equal(web.code, 'scoring_failed');
    assert.equal(frames.some((frame) => frame.type === 'done'), false);
  }
});

test('real scorers feed semantic correction and hard-fail validity through the web gate', async () => {
  for (const scenario of ['corrected', 'hard-fail', 'malformed']) {
    const counts = { mps: 0, fidelity: 0 };
    const scoreFns = {
      scoreMPS: (options) => scoreMPS({ ...options, logger, callLLM: async () => {
        counts.mps++;
        if (scenario === 'hard-fail') return JSON.stringify(highHardFailMps());
        return JSON.stringify(scenario === 'malformed' || counts.mps === 1 ? { mps: 100 } : zeroAnchorMps());
      } }),
      scoreFidelity: (options) => scoreFidelity({ ...options, logger, callLLM: async () => { counts.fidelity++; return JSON.stringify(criteria); } }),
      scoreDeterministicSignals: () => ({}),
    };
    const result = await runWebRewriteStream({ request: { mode: 'first', tier: 'byok', lang: 'en', text: 'A draft.', original: 'A draft.', history: [] },
      config: { language: 'en' }, scoreFns, emit() {}, callLLMStream: async () => ({ text: 'A draft.' }) });
    assert.equal(result.ok, scenario === 'corrected');
    assert.equal(counts.mps, scenario === 'hard-fail' ? 1 : 2);
    assert.equal(counts.fidelity, 1);
  }
});
