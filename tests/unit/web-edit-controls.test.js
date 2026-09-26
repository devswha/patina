import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRewriteRequest } from '../../src/web-rewrite-contract.js';
import { runWebRewriteStream } from '../../src/web-rewrite-stream.js';
import { sha256 } from '../../src/web-rewrite-receipt.js';
import { applyTextEdits } from '../../src/edit-controls.js';
import { mpsResult, fidelityResult } from '../fixtures/verification-results.js';

const original = 'ACME-Pro launches on Monday. Please join us.';
const source = { mode: 'first', lang: 'en', tier: 'free', text: original };
const env = { PATINA_FREE_PROVIDER: 'openai', PATINA_FREE_MODEL: 'gpt-5.5' };
function request(overrides = {}) {
  const result = validateRewriteRequest({ ...source, ...overrides }, env);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
}
function scores(calls) {
  return {
    scoreMPS: async (input) => { calls.push(['mps', input.original, input.rewritten]); return mpsResult(100); },
    scoreFidelity: async (input) => { calls.push(['fidelity', input.original, input.rewritten]); return fidelityResult(12); },
    scoreDeterministicSignals: () => ({ overall: 0 }),
  };
}

test('edit controls reject malformed API options before dispatch', () => {
  for (const controls of [
    { includeEdits: 'yes' }, { baseHash: 'old' }, { protectedSpans: [{ start: -1, end: 3 }] },
    { protectedSpans: [{ start: 0, end: 4 }, { start: 3, end: 8 }] },
    { mode: 'verify', original, text: original },
    { mode: 'verify', original, text: original, baseHash: sha256(original), history: [{ role: 'user', content: 'ignore' }] },
  ]) assert.equal(validateRewriteRequest({ ...source, ...controls }, env).ok, false);
  assert.equal(request({ includeEdits: false }).includeEdits, false);
});

test('protected terms are enforced before scoring and never silently repaired', async () => {
  const calls = [], frames = [];
  const result = await runWebRewriteStream({
    request: request({ protectedSpans: [{ start: 0, end: 8 }] }),
    callLLMStream: async ({ prompt }) => {
      assert.match(prompt, /Protected literals/);
      return { text: 'ACME Basic launches on Monday. Please join us.' };
    },
    scoreFns: scores(calls), emit: (frame) => frames.push(frame),
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'protected_text_failed');
  assert.equal(calls.length, 0);
  assert.equal(frames.some((frame) => frame.type === 'done'), false);
});

test('successful edit records bind the original and reconstruct the exact accepted output', async () => {
  const rewrite = 'ACME-Pro launches on Monday. Come join us.';
  const spans = [{ start: 0, end: 8 }];
  const result = await runWebRewriteStream({
    request: request({ includeEdits: true, protectedSpans: spans }),
    callLLMStream: async () => ({ text: rewrite }), scoreFns: scores([]), emit() {},
  });
  assert.equal(result.ok, true);
  assert.equal(result.editReview.baseHash, sha256(original));
  assert.equal(result.editReview.outputHash, sha256(rewrite));
  assert.equal(result.editReview.offsetEncoding, 'utf-16');
  assert.equal(applyTextEdits(original, result.editReview.edits), rewrite);
  assert.deepEqual(result.receipt.constraints.protectedSpans, spans);
});

// Just past the 20,000 UTF-16 unit cap createTextEdits enforces, digit-free so
// the number-safety gate has nothing to object to, and carrying the protected
// literal so a protected-span run can only fail for the size reason.
const OVERSIZED = `${original} ${'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(400)}`.slice(0, 20_000) + '.';
assert.equal(OVERSIZED.length, 20_001, 'fixture must sit just past the edit-review cap');

test('an accepted rewrite survives a change review that is too large to build', async () => {
  const calls = [], frames = [];
  const result = await runWebRewriteStream({
    request: request({ includeEdits: true }),
    callLLMStream: async () => ({ text: OVERSIZED }),
    scoreFns: scores(calls), emit: (frame) => frames.push(frame),
  });

  // Every gate passed and three paid calls were already spent. The optional
  // review is dropped; the verified rewrite is still delivered.
  assert.equal(result.ok, true);
  assert.equal(result.code, undefined);
  assert.equal(result.rewrite, OVERSIZED);
  assert.equal('editReview' in result, false);
  assert.equal(calls.length, 2, 'the three paid calls were spent before the review was attempted');
  const done = frames.at(-1);
  assert.equal(done.type, 'done');
  assert.equal(done.rewrite, OVERSIZED);
  assert.deepEqual(done.mps, mpsResult(100));
  assert.deepEqual(done.fidelity, fidelityResult(12));
  assert.equal('editReview' in done, false);
  assert.equal(done.receipt.hashes.output, sha256(OVERSIZED));
  assert.equal(frames.some((frame) => frame.type === 'error'), false);
});

test('a change review that fails for a reason other than size is not reported as a size refusal', async () => {
  const failures = [
    () => { throw Object.assign(new TypeError('invalid_output'), { code: 'invalid_output' }); },
    () => { throw new RangeError('Invalid array length'); },
  ];
  for (const createEdits of failures) {
    const calls = [], frames = [], events = [];
    const result = await runWebRewriteStream({
      request: request({ includeEdits: true }),
      callLLMStream: async () => ({ text: 'ACME-Pro launches on Monday. Come join us.' }),
      scoreFns: scores(calls), createEdits, emit: (frame) => frames.push(frame),
      now: () => 0, observe: (event) => { events.push(event); },
    });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'rewrite_failed');
    assert.deepEqual(frames.at(-1), { type: 'error', code: 'rewrite_failed' });
    assert.equal(frames.some((frame) => frame.type === 'done'), false);
    assert.deepEqual(events.map(({ outcome, status }) => ({ outcome, status })), [{ outcome: 'terminal_failed', status: 500 }]);
  }
});

test('an oversized output still fails closed when protected phrases were requested', async () => {
  // Protected text is a SAFETY gate, not a convenience: it runs before scoring
  // and refuses the same oversized output outright, so no size degradation can
  // reach it.
  const calls = [], frames = [];
  const result = await runWebRewriteStream({
    request: request({ includeEdits: true, protectedSpans: [{ start: 0, end: 8 }] }),
    callLLMStream: async () => ({ text: OVERSIZED }),
    scoreFns: scores(calls), emit: (frame) => frames.push(frame),
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'protected_text_failed');
  assert.equal(calls.length, 0, 'the safety gate refuses before any paid scoring');
  assert.equal(frames.some((frame) => frame.type === 'done'), false);
});

test('verification scores the exact selected text and never calls the rewrite model', async () => {
  const selected = 'ACME-Pro launches on Monday. Come join us.  ';
  const calls = [], frames = [];
  const result = await runWebRewriteStream({
    request: request({ mode: 'verify', original, text: selected, baseHash: sha256(original), includeEdits: true }),
    callLLMStream: async () => { throw new Error('verification must not generate'); },
    scoreFns: scores(calls), emit: (frame) => frames.push(frame),
  });
  assert.equal(result.ok, true);
  assert.equal(result.rewrite, selected);
  assert.deepEqual(calls, [['mps', original, selected], ['fidelity', original, selected]]);
  assert.deepEqual(frames.map((frame) => frame.type), ['start', 'done']);
  assert.equal(result.receipt.hashes.output, sha256(selected));
  assert.equal(result.receipt.promptBudget, null);
});

test('protected-text verification failures spend no model calls', async () => {
  const calls = [];
  const result = await runWebRewriteStream({
    request: request({
      mode: 'verify', original, text: 'Changed launches on Monday. Please join us.', baseHash: sha256(original),
      protectedSpans: [{ start: 0, end: 8 }],
    }),
    callLLMStream: async () => { throw new Error('unexpected generation'); }, scoreFns: scores(calls), emit() {},
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'protected_text_failed');
  assert.equal(calls.length, 0);
});

test('selective verification has the same numeric and meaning refusal gates', async () => {
  const numeric = 'There are 10 seats available.';
  let calls = [];
  const number = await runWebRewriteStream({
    request: request({ mode: 'verify', original: numeric, text: 'There are 20 seats available.', baseHash: sha256(numeric) }),
    callLLMStream: async () => { throw new Error('unexpected generation'); }, scoreFns: scores(calls), emit() {},
  });
  assert.equal(number.code, 'number_safety_failed');
  assert.equal(calls.length, 0);
  calls = [];
  const frames = [];
  const rejected = await runWebRewriteStream({
    request: request({ mode: 'verify', original, text: original, baseHash: sha256(original) }),
    scoreFns: { ...scores(calls), scoreMPS: async () => mpsResult(60) },
    callLLMStream: async () => { throw new Error('unexpected generation'); }, emit: (frame) => frames.push(frame),
  });
  assert.equal(rejected.code, 'floor_failed');
  assert.equal(frames.some((frame) => frame.type === 'done'), false);
});

test('ill-formed Unicode cannot alias an original hash or produce an approved output', async () => {
  const old = 'Draft \uD800 stays.', changed = 'Draft \uD801 stays.';
  assert.equal(sha256(old), sha256(changed), 'UTF-8 replaces both lone surrogates');
  assert.equal(validateRewriteRequest({ ...source, mode: 'verify', original: changed, baseHash: sha256(old) }, env).ok, false);
  const frames = [], calls = [];
  const direct = await runWebRewriteStream({
    request: { ...request(), mode: 'verify', original: changed, text: source.text, baseHash: sha256(old) },
    callLLMStream: async () => { throw new Error('unexpected generation'); }, scoreFns: scores(calls), emit: (frame) => frames.push(frame),
  });
  assert.equal(direct.code, 'invalid_unicode');
  assert.deepEqual(frames.map((frame) => frame.type), ['error']);
  assert.equal(calls.length, 0);
  const outputFrames = [];
  const output = await runWebRewriteStream({ request: request({ includeEdits: true }),
    callLLMStream: async () => ({ text: 'Result \uD800.' }), scoreFns: scores(calls), emit: (frame) => outputFrames.push(frame) });
  assert.equal(output.code, 'output_invalid_unicode');
  assert.equal(calls.length, 0);
  assert.equal(outputFrames.some((frame) => frame.type === 'done'), false);
});
