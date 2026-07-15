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

const PRIVATE_SENTINELS = new Set([
  'private-requested-model',
  'private-effective-model',
  'private-provider',
  'private-cache-token',
]);

const PRIVATE_FRAME_FIELDS = new Set([
  'apiKey',
  'attemptIndex',
  'attempts',
  'baseURL',
  'cacheTokens',
  'effectiveModel',
  'minimumChargeApplied',
  'model',
  'outcome',
  'provider',
  'rawResponse',
  'requestedModel',
  'retryReason',
  'temperature',
  'usage',
]);

function privateAttempt(overrides = {}) {
  return {
    attemptIndex: 1,
    requestedModel: 'private-requested-model',
    effectiveModel: 'private-effective-model',
    usage: {
      prompt_tokens: 4,
      cache_marker: 'private-cache-token',
    },
    retryReason: 'initial',
    minimumChargeApplied: true,
    outcome: 'success',
    ...overrides,
  };
}

function assertFramesDoNotLeakPrivateMetadata(frames) {
  const inspect = (value, path) => {
    if (typeof value === 'string') {
      assert.equal(PRIVATE_SENTINELS.has(value), false, `${path} leaked private metadata`);
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => inspect(item, `${path}[${index}]`));
    } else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        assert.equal(PRIVATE_FRAME_FIELDS.has(key), false, `${path}.${key} is private`);
        inspect(child, `${path}.${key}`);
      }
    }
  };

  for (const [index, frame] of frames.entries()) {
    inspect(frame, `frames[${index}]`);
  }
}

function scoring({ mps = 95, fidelity = 92, calls = [] } = {}) {
  return {
    scoreMPS: async (input) => {
      input.onAttempt(privateAttempt());
      calls.push(['mps', input.original, input.rewritten]);
      return { mps };
    },
    scoreFidelity: async (input) => {
      input.onAttempt(privateAttempt());
      calls.push(['fidelity', input.original, input.rewritten]);
      return { fidelity };
    },
    scoreDeterministicSignals: ({ text }) => ({ overall: text.length, text }),
  };
}

test('runWebRewriteStream emits start, deltas, and done with scores/signals/diff', async () => {
  const frames = [];
  const scoreFns = scoring();
  const callLLMStream = async ({ onDelta, onAttempt }) => {
    onAttempt(privateAttempt());
    onDelta('human');
    onDelta(' text');
    return { text: 'human text' };
  };

  const result = await runWebRewriteStream({ request, callLLMStream, scoreFns, emit: (frame) => frames.push(frame) });

  assert.equal(result.ok, true);
  assert.deepEqual(frames.map((f) => f.type), ['start', 'delta', 'delta', 'done']);
  assert.deepEqual(frames[0], { type: 'start' });
  assert.equal(frames[1].text, 'human');
  const done = frames[3];
  assert.equal(done.rewrite, 'human text');
  assert.deepEqual(done.mps, { mps: 95 });
  assert.deepEqual(done.fidelity, { fidelity: 92 });
  assert.equal(done.signals.before.text, 'original anchor');
  assert.equal(done.signals.after.text, 'human text');
  assert.equal(done.diff.beforeChars, 'original anchor'.length);
  assertFramesDoNotLeakPrivateMetadata(frames);
});
test('runWebRewriteStream privately aggregates exact one-based attempts for every paid stage', async () => {
  const frames = [];
  const attempt = privateAttempt({
    requestedModel: 'requested-model',
    effectiveModel: null,
    usage: null,
  });
  const scoreFns = {
    scoreMPS: async ({ onAttempt }) => {
      onAttempt(attempt);
      return { mps: 95 };
    },
    scoreFidelity: async ({ onAttempt }) => {
      onAttempt({ ...attempt, effectiveModel: 'fidelity-model', usage: { prompt_tokens: 4 } });
      return { fidelity: 92 };
    },
    scoreDeterministicSignals: () => ({}),
  };

  const result = await runWebRewriteStream({
    request: { ...request, original: 'We shipped 3 units.' },
    callLLMStream: async ({ onAttempt }) => {
      onAttempt(attempt);
      return { text: 'We shipped 3 units.' };
    },
    scoreFns,
    emit: (frame) => frames.push(frame),
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.attempts, {
    valid: true,
    rewrite: [{ ...attempt, effectiveModel: null, usage: null }],
    mps: [{ ...attempt, effectiveModel: null, usage: null }],
    fidelity: [{ ...attempt, effectiveModel: 'fidelity-model', usage: { prompt_tokens: 4 } }],
  });
  assertFramesDoNotLeakPrivateMetadata(frames);
});
test('runWebRewriteStream drops malformed attempts without fabricating defaults', async () => {
  const frames = [];
  const malformedAttempts = [
    privateAttempt({ attemptIndex: 0 }),
    privateAttempt({ attemptIndex: 2, requestedModel: 42 }),
    privateAttempt({ attemptIndex: 3, usage: [] }),
    privateAttempt({ attemptIndex: 4, retryReason: 'retry' }),
    privateAttempt({ attemptIndex: 5, outcome: 'failed' }),
    { ...privateAttempt({ attemptIndex: 6 }), extra: true },
  ];
  const result = await runWebRewriteStream({
    request,
    callLLMStream: async ({ onAttempt }) => {
      for (const attempt of malformedAttempts) onAttempt(attempt);
      return { text: 'human text' };
    },
    scoreFns: scoring(),
    emit: (frame) => frames.push(frame),
  });

  assert.equal(result.ok, true);
  assert.equal(result.attempts.valid, false);
  assert.deepEqual(result.attempts.rewrite, []);
  assert.deepEqual(result.attempts.mps, [privateAttempt()]);
  assert.deepEqual(result.attempts.fidelity, [privateAttempt()]);
  assertFramesDoNotLeakPrivateMetadata(frames);
});
test('runWebRewriteStream marks local attempt index starts, gaps, and reordering invalid', async () => {
  const validAttempt = privateAttempt();
  const sequences = [
    [{ ...validAttempt, attemptIndex: 7 }],
    [validAttempt, { ...validAttempt, attemptIndex: 3 }],
    [validAttempt, { ...validAttempt, attemptIndex: 3 }, { ...validAttempt, attemptIndex: 2 }],
  ];

  for (const sequence of sequences) {
    const frames = [];
    const result = await runWebRewriteStream({
      request,
      callLLMStream: async ({ onAttempt }) => {
        onAttempt(privateAttempt());
        return { text: 'human text' };
      },
      scoreFns: {
        scoreMPS: async ({ onAttempt }) => {
          for (const attempt of sequence) onAttempt(attempt);
          return { mps: 95 };
        },
        scoreFidelity: async ({ onAttempt }) => {
          onAttempt(privateAttempt());
          return { fidelity: 92 };
        },
        scoreDeterministicSignals: () => ({}),
      },
      emit: (frame) => frames.push(frame),
    });

    assert.equal(result.ok, true);
    assert.equal(result.attempts.valid, false);
    assertFramesDoNotLeakPrivateMetadata(frames);
  }
});
test('runWebRewriteStream marks isolated invalid score evidence without exposing it in frames', async () => {
  const frames = [];
  const scoreFns = {
    scoreMPS: async ({ onAttempt, onAttemptInvalid }) => {
      onAttemptInvalid({ customerFrame: 'private-provider' });
      onAttempt(privateAttempt());
      return { mps: 95 };
    },
    scoreFidelity: async ({ onAttempt }) => {
      onAttempt(privateAttempt());
      return { fidelity: 92 };
    },
    scoreDeterministicSignals: ({ text }) => ({ text }),
  };
  const result = await runWebRewriteStream({
    request,
    callLLMStream: async ({ onAttempt }) => {
      onAttempt(privateAttempt());
      return { text: 'human text' };
    },
    scoreFns,
    emit: (frame) => frames.push(frame),
  });

  assert.equal(result.ok, true);
  assert.equal(result.attempts.valid, false);
  assert.deepEqual(result.attempts.mps, [privateAttempt()]);
  assertFramesDoNotLeakPrivateMetadata(frames);
});


test('runWebRewriteStream rejects changed numeric claims before paid scoring', async () => {
  const frames = [];
  let scorerCalls = 0;
  const scoreFns = {
    scoreMPS: async () => { scorerCalls += 1; return { mps: 95 }; },
    scoreFidelity: async () => { scorerCalls += 1; return { fidelity: 92 }; },
    scoreDeterministicSignals: () => {
      throw new Error('deterministic scoring must not run after number safety failure');
    },
  };

  const result = await runWebRewriteStream({
    request: { ...request, original: 'We shipped 3 units.' },
    callLLMStream: async ({ onAttempt }) => {
      onAttempt(privateAttempt());
      return { text: 'We shipped 4 units.' };
    },
    scoreFns,
    emit: (frame) => frames.push(frame),
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'number_safety_failed');
  assert.equal(result.numberSafety.ok, false);
  assert.equal(scorerCalls, 0);
  assert.deepEqual(result.attempts, {
    valid: true,
    rewrite: [privateAttempt()],
    mps: [],
    fidelity: [],
  });
  assert.deepEqual(frames, [
    { type: 'start' },
    { type: 'error', code: 'number_safety_failed' },
  ]);
  assertFramesDoNotLeakPrivateMetadata(frames);
});

test('runWebRewriteStream fail-closes floor failures with error and no done', async () => {
  const frames = [];
  const callLLMStream = async ({ onDelta, onAttempt }) => {
    onAttempt(privateAttempt());
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
  assert.deepEqual(result.attempts, {
    valid: true,
    rewrite: [privateAttempt()],
    mps: [privateAttempt()],
    fidelity: [privateAttempt()],
  });
  assertFramesDoNotLeakPrivateMetadata(frames);
});

test('runWebRewriteStream forwards the abort signal and timeout to the LLM stream and scorers', async () => {
  const frames = [];
  const controller = new AbortController();
  const seen = { stream: null, scorers: [] };
  const callLLMStream = async ({ signal, timeout, onDelta, onAttempt }) => {
    seen.stream = { signal, timeout };
    onAttempt(privateAttempt());
    onDelta('ok');
    return { text: 'ok text' };
  };
  const scoreFns = {
    scoreMPS: async ({ signal, timeout, onAttempt }) => {
      seen.scorers.push({ signal, timeout });
      onAttempt(privateAttempt());
      return { mps: 95 };
    },
    scoreFidelity: async ({ signal, timeout, onAttempt }) => {
      seen.scorers.push({ signal, timeout });
      onAttempt(privateAttempt());
      return { fidelity: 92 };
    },
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
  assert.deepEqual(result.attempts, {
    valid: true,
    rewrite: [privateAttempt()],
    mps: [privateAttempt()],
    fidelity: [privateAttempt()],
  });
  assertFramesDoNotLeakPrivateMetadata(frames);
});

test('runWebRewriteStream emits stream_failed and no done when transport throws', async () => {
  const frames = [];
  const callLLMStream = async ({ onAttempt }) => {
    onAttempt(privateAttempt({ outcome: 'error', retryReason: 'transport' }));
    throw new Error('upstream exploded sk-secret1234567890');
  };

  const result = await runWebRewriteStream({ request, callLLMStream, scoreFns: scoring(), emit: (frame) => frames.push(frame) });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'stream_failed');
  assert.equal(frames.some((f) => f.type === 'done'), false);
  assert.equal(frames.at(-1).type, 'error');
  assert.equal(frames.at(-1).code, 'stream_failed');
  assert.doesNotMatch(frames.at(-1).error, /sk-secret/);
  assert.deepEqual(result.attempts, {
    valid: true,
    rewrite: [privateAttempt({ outcome: 'error', retryReason: 'transport' })],
    mps: [],
    fidelity: [],
  });
  assertFramesDoNotLeakPrivateMetadata(frames);
});

test('runWebRewriteStream scores refine against request.original, not latest draft', async () => {
  const frames = [];
  const calls = [];
  const callLLMStream = async ({ onAttempt }) => {
    onAttempt(privateAttempt());
    return { text: 'rewritten final' };
  };

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
  assertFramesDoNotLeakPrivateMetadata(frames);
});

test('runWebRewriteStream waits for a started scorer before returning a scoring failure', async () => {
  const frames = [];
  let fidelityFinished = false;
  const callLLMStream = async ({ onDelta, onAttempt }) => {
    onAttempt(privateAttempt());
    onDelta('ok');
    return { text: 'ok text' };
  };
  const scoreFns = {
    scoreMPS: async ({ onAttempt }) => {
      onAttempt(privateAttempt({ outcome: 'error', retryReason: 'score_schema_parse' }));
      throw new Error('scorer aborted sk-secret1234567890');
    },
    scoreFidelity: async ({ onAttempt }) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      onAttempt(privateAttempt({ effectiveModel: 'delayed-fidelity-model' }));
      fidelityFinished = true;
      return { fidelity: 92 };
    },
    scoreDeterministicSignals: ({ text }) => ({ text }),
  };

  const result = await runWebRewriteStream({ request, callLLMStream, scoreFns, emit: (frame) => frames.push(frame) });

  assert.equal(fidelityFinished, true);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'scoring_failed');
  assert.equal(frames.filter((frame) => frame.type === 'error').length, 1);
  assert.equal(frames.some((frame) => frame.type === 'done'), false);
  assert.doesNotMatch(frames.at(-1).error, /sk-secret/);
  const attemptsAtReturn = globalThis.structuredClone(result.attempts);
  assert.deepEqual(result.attempts, {
    valid: true,
    rewrite: [privateAttempt()],
    mps: [privateAttempt({ outcome: 'error', retryReason: 'score_schema_parse' })],
    fidelity: [privateAttempt({ effectiveModel: 'delayed-fidelity-model' })],
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(result.attempts, attemptsAtReturn);
  assertFramesDoNotLeakPrivateMetadata(frames);
});
test('runWebRewriteStream fails closed for unchanged ambiguous dates before scoring', async () => {
  const frames = [];
  let scorerCalls = 0;
  const result = await runWebRewriteStream({
    request: { ...request, original: 'Report date: 01/02/2024.' },
    callLLMStream: async ({ onAttempt }) => {
      onAttempt(privateAttempt());
      return { text: 'Report date: 01/02/2024.' };
    },
    scoreFns: {
      scoreMPS: async () => { scorerCalls += 1; return { mps: 95 }; },
      scoreFidelity: async () => { scorerCalls += 1; return { fidelity: 92 }; },
      scoreDeterministicSignals: () => {
        throw new Error('deterministic scoring must not run after ambiguous date failure');
      },
    },
    emit: (frame) => frames.push(frame),
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'number_safety_failed');
  assert.equal(result.numberSafety.ok, false);
  assert.equal(scorerCalls, 0);
  assert.deepEqual(result.attempts, {
    valid: true,
    rewrite: [privateAttempt()],
    mps: [],
    fidelity: [],
  });
  assert.deepEqual(frames, [
    { type: 'start' },
    { type: 'error', code: 'number_safety_failed' },
  ]);
  assertFramesDoNotLeakPrivateMetadata(frames);
});
