// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { runWebRewriteStream } from '../../src/web-rewrite-stream.js';

const request = {
  mode: 'refine',
  lang: 'en',
  tier: 'byok',
  text: 'latest draft',
  original: 'original anchor',
  history: [],
  provider: 'openai',
  model: 'gpt-5.5',
  baseURL: 'https://api.openai.com/v1',
  apiKey: 'sk-test',
};

function scoring({ mps = 95, fidelity = 92, calls = [] } = {}) {
  return {
    scoreMPS: async (input) => {
      calls.push(['mps', input.original, input.rewritten]);
      return { mps };
    },
    scoreFidelity: async (input) => {
      calls.push(['fidelity', input.original, input.rewritten]);
      return { fidelity };
    },
    scoreDeterministicSignals: ({ text }) => ({ overall: text.length, text }),
  };
}

test('runWebRewriteStream emits start, deltas, and done with scores/signals/diff', async () => {
  const frames = [];
  const scoreFns = scoring();
  const callLLMStream = async ({ onDelta }) => {
    onDelta('human');
    onDelta(' text');
    return { text: 'human text' };
  };

  const result = await runWebRewriteStream({ request, callLLMStream, scoreFns, emit: (frame) => frames.push(frame) });

  assert.equal(result.ok, true);
  assert.deepEqual(frames.map((f) => f.type), ['start', 'delta', 'delta', 'done']);
  assert.equal(frames[0].provider, 'openai');
  assert.equal(frames[1].text, 'human');
  const done = frames[3];
  assert.equal(done.rewrite, 'human text');
  assert.deepEqual(done.mps, { mps: 95 });
  assert.deepEqual(done.fidelity, { fidelity: 92 });
  assert.equal(done.signals.before.text, 'original anchor');
  assert.equal(done.signals.after.text, 'human text');
  assert.equal(done.diff.beforeChars, 'original anchor'.length);
});

test('runWebRewriteStream fail-closes floor failures with error and no done', async () => {
  const frames = [];
  const callLLMStream = async ({ onDelta }) => {
    onDelta('bad');
    return { text: 'bad rewrite' };
  };

  const result = await runWebRewriteStream({
    request,
    callLLMStream,
    scoreFns: scoring({ mps: 50, fidelity: 95 }),
    emit: (frame) => frames.push(frame),
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'floor_failed');
  assert.equal(frames.some((f) => f.type === 'done'), false);
  const terminal = frames.at(-1);
  assert.equal(terminal.type, 'error');
  assert.equal(terminal.code, 'floor_failed');
  assert.deepEqual(terminal.failed, ['mps']);
  // Floor failures keep the flagged attempt auditable: the already-computed
  // deterministic signals and length diff must ride on the error frame.
  assert.equal(terminal.rewrite, 'bad rewrite');
  assert.deepEqual(terminal.mps, { mps: 50 });
  assert.deepEqual(terminal.fidelity, { fidelity: 95 });
  assert.equal(terminal.signals.before.text, 'original anchor');
  assert.equal(terminal.signals.after.text, 'bad rewrite');
  assert.equal(terminal.diff.beforeChars, 'original anchor'.length);
  assert.equal(terminal.diff.afterChars, 'bad rewrite'.length);
  assert.equal(result.signals.after.text, 'bad rewrite');
  assert.equal(result.diff.afterChars, 'bad rewrite'.length);
});

test('runWebRewriteStream forwards the abort signal and timeout to the LLM stream and scorers', async () => {
  const frames = [];
  const controller = new AbortController();
  const seen = { stream: null, scorers: [] };
  const callLLMStream = async ({ signal, timeout, onDelta }) => {
    seen.stream = { signal, timeout };
    onDelta('ok');
    return { text: 'ok text' };
  };
  const scoreFns = {
    scoreMPS: async ({ signal, timeout }) => { seen.scorers.push({ signal, timeout }); return { mps: 95 }; },
    scoreFidelity: async ({ signal, timeout }) => { seen.scorers.push({ signal, timeout }); return { fidelity: 92 }; },
    scoreDeterministicSignals: ({ text }) => ({ text }),
  };

  const result = await runWebRewriteStream({
    request,
    callLLMStream,
    scoreFns,
    emit: (frame) => frames.push(frame),
    signal: controller.signal,
    timeout: 4321,
  });

  assert.equal(result.ok, true);
  assert.equal(seen.stream.signal, controller.signal);
  assert.equal(seen.stream.timeout, 4321);
  assert.equal(seen.scorers.length, 2);
  for (const scorer of seen.scorers) {
    assert.equal(scorer.signal, controller.signal);
    assert.equal(scorer.timeout, 4321);
  }
});

test('runWebRewriteStream emits stream_failed and no done when transport throws', async () => {
  const frames = [];
  const callLLMStream = async () => {
    throw new Error('upstream exploded sk-secret1234567890');
  };

  const result = await runWebRewriteStream({ request, callLLMStream, scoreFns: scoring(), emit: (frame) => frames.push(frame) });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'stream_failed');
  assert.equal(frames.some((f) => f.type === 'done'), false);
  assert.equal(frames.at(-1).type, 'error');
  assert.equal(frames.at(-1).code, 'stream_failed');
  assert.doesNotMatch(frames.at(-1).error, /sk-secret/);
});

test('runWebRewriteStream scores refine against request.original, not latest draft', async () => {
  const frames = [];
  const calls = [];
  const callLLMStream = async () => ({ text: 'rewritten final' });

  await runWebRewriteStream({
    request,
    callLLMStream,
    scoreFns: scoring({ calls }),
    emit: (frame) => frames.push(frame),
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0][1], 'original anchor');
  assert.equal(calls[1][1], 'original anchor');
  assert.notEqual(calls[0][1], request.text);
  assert.equal(frames.at(-1).type, 'done');
});

test('runWebRewriteStream turns a scoring failure into a terminal redacted error frame (no done, no throw)', async () => {
  const frames = [];
  const callLLMStream = async ({ onDelta }) => {
    onDelta('ok');
    return { text: 'ok text' };
  };
  const scoreFns = {
    scoreMPS: async () => { throw new Error('scorer aborted sk-secret1234567890'); },
    scoreFidelity: async () => ({ fidelity: 92 }),
    scoreDeterministicSignals: ({ text }) => ({ text }),
  };

  // Must resolve (not reject): a throw here would bubble to the API handler's
  // JSON 500 and append a non-frame tail to an already-started NDJSON stream.
  const result = await runWebRewriteStream({ request, callLLMStream, scoreFns, emit: (frame) => frames.push(frame) });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'scoring_failed');
  assert.equal(frames.some((f) => f.type === 'done'), false);
  const terminal = frames.at(-1);
  assert.equal(terminal.type, 'error');
  assert.equal(terminal.code, 'scoring_failed');
  assert.doesNotMatch(terminal.error, /sk-secret/);
});
