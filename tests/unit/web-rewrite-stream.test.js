// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { mpsResult, fidelityResult } from '../fixtures/verification-results.js';
import { rewriteExtraBody, runWebRewriteStream, scoringExtraBody } from '../../src/web-rewrite-stream.js';
import { buildWebRewriteReceipt, canonicalJson, sha256 } from '../../src/web-rewrite-receipt.js';
import { loadWebConfig, resolveBundleRoot } from '../../src/web-config.js';
import { buildWebRewritePrompt, loadWebAssets } from '../../src/web-rewrite.js';

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
      completion_tokens: 0,
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
    if (frame.type !== 'done') assert.equal('receipt' in frame, false, `frames[${index}] must not carry a receipt`);
    inspect(frame, `frames[${index}]`);
  }
}

function scoring({ mps = 95, fidelity = 92, calls = [] } = {}) {
  return {
    scoreMPS: async (input) => {
      input.onAttempt(privateAttempt());
      calls.push(['mps', input.original, input.rewritten]);
      return mpsResult(mps);
    },
    scoreFidelity: async (input) => {
      input.onAttempt(privateAttempt());
      calls.push(['fidelity', input.original, input.rewritten]);
      return fidelityResult(Math.round(fidelity * 12 / 100));
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
  assert.deepEqual(done.mps, mpsResult(95));
  assert.deepEqual(done.fidelity, fidelityResult(11));
  assert.equal(done.signals.before.text, 'original anchor');
  assert.equal(done.signals.after.text, 'human text');
  assert.equal(done.diff.beforeChars, 'original anchor'.length);
  assert.match(done.receipt.receiptHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(done.receipt.hashes.original, sha256('original anchor'));
  assert.equal(done.receipt.hashes.latest, sha256('latest draft'));
  assert.equal(done.receipt.hashes.output, sha256('human text'));
  assert.deepEqual(result.receipt, done.receipt);
  assertFramesDoNotLeakPrivateMetadata(frames);
});

test('runWebRewriteStream applies the resolved prompt budget without changing successful frames or scorers', async () => {
  const repoRoot = resolveBundleRoot();
  const config = loadWebConfig({ repoRoot });
  config.language = 'en';
  config.documentType = 'default';
  const budgetRequest = {
    ...request,
    mode: 'first',
    text: 'Welcome home.',
    original: 'Welcome home.',
  };
  const assets = loadWebAssets({ repoRoot, lang: 'en', documentType: 'default', config });
  const prompts = [];
  const calls = [];
  const callLLMStream = async ({ prompt, onAttempt }) => {
    prompts.push(prompt);
    onAttempt(privateAttempt());
    return { text: 'Welcome home.' };
  };

  const shadow = await runWebRewriteStream({
    request: budgetRequest,
    config,
    repoRoot,
    env: { PATINA_WEB_PROMPT_BUDGET: 'shadow' },
    callLLMStream,
    scoreFns: scoring({ calls }),
    emit: () => {},
  });
  const active = await runWebRewriteStream({
    request: budgetRequest,
    config,
    repoRoot,
    env: { PATINA_WEB_PROMPT_BUDGET: 'active' },
    callLLMStream,
    scoreFns: scoring({ calls }),
    emit: () => {},
  });

  assert.equal(prompts[0], buildWebRewritePrompt({ request: budgetRequest, config, assets, promptMode: 'strict' }));
  assert.equal(prompts[1], buildWebRewritePrompt({ request: budgetRequest, config, assets, promptMode: 'minimal' }));
  assert.deepEqual(shadow.budget, { policy: 'shadow', selected: 'minimal', applied: 'strict', reason: 'eligible' });
  assert.deepEqual(active.budget, { policy: 'active', selected: 'minimal', applied: 'minimal', reason: 'eligible' });
  assert.equal(shadow.receipt.schemaVersion, 'patina-rewrite-receipt-v2');
  assert.deepEqual(shadow.receipt.promptBudget, shadow.budget);
  assert.deepEqual(active.receipt.promptBudget, active.budget);
  assert.equal(calls.filter(([stage]) => stage === 'mps').length, 2);
  assert.equal(calls.filter(([stage]) => stage === 'fidelity').length, 2);
});

test('rewrite receipt canonically binds exact source inputs without exposing them', () => {
  const input = {
    request: { mode: 'refine', lang: 'en', tier: 'pro', persona: '', register: 'plain', apiKey: 'sk-private' },
    documentType: 'article',
    original: 'original private text',
    latest: 'latest private text',
    prompt: 'exact private prompt',
    output: 'accepted private output',
    mps: { mps: 95, provider: 'private-provider', raw: 'exact private prompt' },
    fidelity: { fidelity: 92, model: 'private-model' },
    signals: { before: { text: 'original private text', overall: 40 }, after: { text: 'accepted private output', overall: 10 } },
    diff: { beforeChars: 21, afterChars: 23 },
  };
  const receipt = buildWebRewriteReceipt(input);
  const again = buildWebRewriteReceipt({ ...input, request: { ...input.request } });

  assert.deepEqual(receipt, again);
  assert.match(receipt.receiptHash, /^sha256:[0-9a-f]{64}$/);
  for (const hash of Object.values(receipt.hashes)) assert.match(hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(receipt.request.persona, null);
  assert.equal(receipt.request.documentType, 'article');
  assert.equal(receipt.receiptHash, sha256(canonicalJson({ ...receipt, receiptHash: undefined })));
  const serialized = JSON.stringify(receipt);
  for (const privateValue of ['original private text', 'latest private text', 'exact private prompt', 'accepted private output', 'sk-private', 'private-provider', 'private-model']) {
    assert.doesNotMatch(serialized, new RegExp(privateValue));
  }
  const verification = /** @type {{mps: object, fidelity: object}} */ (receipt.verification);
  assert.equal('provider' in verification.mps, false);
  assert.equal('model' in verification.fidelity, false);
  assert.equal('raw' in verification.mps, false);

  for (const [field, value] of Object.entries({
    original: 'changed original',
    latest: 'changed latest',
    prompt: 'changed prompt',
    output: 'changed output',
  })) {
    assert.notEqual(buildWebRewriteReceipt({ ...input, [field]: value }).receiptHash, receipt.receiptHash, field);
  }
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
      return mpsResult(95);
    },
    scoreFidelity: async ({ onAttempt }) => {
      onAttempt({ ...attempt, effectiveModel: 'fidelity-model', usage: { prompt_tokens: 4 } });
      return fidelityResult(11);
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
          return mpsResult(95);
        },
        scoreFidelity: async ({ onAttempt }) => {
          onAttempt(privateAttempt());
          return fidelityResult(11);
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
      return mpsResult(95);
    },
    scoreFidelity: async ({ onAttempt }) => {
      onAttempt(privateAttempt());
      return fidelityResult(11);
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
    scoreMPS: async () => { scorerCalls += 1; return mpsResult(95); },
    scoreFidelity: async () => { scorerCalls += 1; return fidelityResult(11); },
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
    numberSafetyRetries: 0,
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
test('runWebRewriteStream retries a number-safety failure without re-emitting deltas', async () => {
  const frames = [];
  let llmCalls = 0;
  const result = await runWebRewriteStream({
    request: { ...request, original: 'We shipped 3 units.' },
    callLLMStream: async ({ onDelta, onAttempt }) => {
      llmCalls += 1;
      onAttempt(privateAttempt());
      if (llmCalls === 1) {
        onDelta('We shipped 4 units.');
        return { text: 'We shipped 4 units.' };
      }
      onDelta('We shipped 3 units, done.');
      return { text: 'We shipped 3 units, done.' };
    },
    scoreFns: {
      scoreMPS: async () => (mpsResult(95)),
      scoreFidelity: async () => (fidelityResult(11)),
      scoreDeterministicSignals: () => ({ signalScore: 0 }),
    },
    emit: (frame) => frames.push(frame),
  });

  assert.equal(result.ok, true);
  assert.equal(llmCalls, 2);
  assert.equal(result.rewrite, 'We shipped 3 units, done.');
  // Deltas come only from the live first run; the retry is buffered and the
  // done frame carries the accepted rewrite (the client replaces bubble text).
  assert.deepEqual(frames.filter((f) => f.type === 'delta'), [{ type: 'delta', text: 'We shipped 4 units.' }]);
  assert.equal(frames.at(-1).type, 'done');
  assert.equal(frames.at(-1).rewrite, 'We shipped 3 units, done.');
  // Both paid attempts are ledgered with contiguous one-based indices.
  assert.equal(result.attempts.valid, true);
  assert.deepEqual(result.attempts.rewrite.map((a) => a.attemptIndex), [1, 2]);
  assertFramesDoNotLeakPrivateMetadata(frames);
});

test('runWebRewriteStream exhausts number-safety retries and fails closed', async () => {
  const frames = [];
  let llmCalls = 0;
  const result = await runWebRewriteStream({
    request: { ...request, original: 'We shipped 3 units.' },
    callLLMStream: async ({ onAttempt }) => {
      llmCalls += 1;
      onAttempt(privateAttempt());
      return { text: 'We shipped 4 units.' };
    },
    scoreFns: {
      scoreMPS: async () => { throw new Error('scoring must not run'); },
      scoreFidelity: async () => { throw new Error('scoring must not run'); },
      scoreDeterministicSignals: () => { throw new Error('scoring must not run'); },
    },
    emit: (frame) => frames.push(frame),
  });

  // Default budget: one live run + one buffered retry, then fail closed.
  assert.equal(llmCalls, 2);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'number_safety_failed');
  assert.equal(result.attempts.valid, true);
  assert.deepEqual(result.attempts.rewrite.map((a) => a.attemptIndex), [1, 2]);
  assert.deepEqual(frames.at(-1), { type: 'error', code: 'number_safety_failed' });
  assertFramesDoNotLeakPrivateMetadata(frames);
});

test('runWebRewriteStream keeps heuristic Korean invariants advisory', async () => {
  // Given: a Korean rewrite that the heuristic flags for polarity.
  const frames = [];
  let scorerCalls = 0;
  const original = '운영팀은 배포를 승인하지 않았다. 결과는 담당자에 의해 검토된다. 일정은 운영팀에 의해 조정된다.';

  // When: the streamed candidate inverts polarity.
  const result = await runWebRewriteStream({
    request: {
      ...request,
      mode: 'first',
      lang: 'ko',
      text: original,
      original,
    },
    env: { PATINA_KO_DIAGNOSIS_RESEARCH: '1' },
    callLLMStream: async () => ({ text: '운영팀은 배포를 승인했다. 결과는 담당자에 의해 검토된다. 일정은 운영팀에 의해 조정된다.' }),
    scoreFns: {
      scoreMPS: async () => { scorerCalls += 1; return mpsResult(95); },
      scoreFidelity: async () => { scorerCalls += 1; return fidelityResult(11); },
      scoreDeterministicSignals: () => ({}),
    },
    emit: (frame) => frames.push(frame),
    numberSafetyRetries: 0,
  });

  // Then: the heuristic is returned privately but cannot create a new terminal error.
  assert.equal(result.ok, true);
  assert.equal(result.koreanInvariants.checks.polarity.ok, false);
  assert.equal(scorerCalls, 2);
  assert.deepEqual(frames.map((frame) => frame.type), ['start', 'done']);
});

test('runWebRewriteStream does not bypass detector-clean Korean prose', async () => {
  // Given: a detector-clean first-turn Korean request.
  const text = '창문을 열자 빗소리가 가까워졌다. 잠시 뒤 골목이 조용해졌다.';
  const frames = [];
  let calls = 0;
  let seenPrompt = '';

  // When: the hosted stream runs.
  const result = await runWebRewriteStream({
    request: {
      ...request,
      mode: 'first',
      lang: 'ko',
      text,
      original: text,
    },
    callLLMStream: async ({ prompt }) => {
      calls += 1;
      seenPrompt = prompt;
      return { text: '창문을 여니 빗소리가 한층 가까워졌다. 이내 골목은 다시 조용해졌다.' };
    },
    scoreFns: {
      scoreMPS: async () => (mpsResult(95)),
      scoreFidelity: async () => (fidelityResult(11)),
      scoreDeterministicSignals: () => ({}),
    },
    emit: (frame) => frames.push(frame),
  });

  // Then: the model still runs and start/done is preserved.
  assert.equal(result.ok, true);
  assert.equal(result.rewrite, '창문을 여니 빗소리가 한층 가까워졌다. 이내 골목은 다시 조용해졌다.');
  assert.equal(calls, 1);
  assert.doesNotMatch(seenPrompt, /koDiagnosis\.v1/);
  assert.deepEqual(frames.map((frame) => frame.type), ['start', 'done']);
});

test('runWebRewriteStream enables diagnosed structure guidance only behind the research flag', async () => {
  const text = '당신은 커맨드 기둥을 설정한다. 이것은 담당자에 의해 검토된다. 그것은 운영팀에 의해 다시 조정된다.';
  let seenPrompt = '';

  const result = await runWebRewriteStream({
    request: {
      ...request,
      mode: 'first',
      lang: 'ko',
      text,
      original: text,
    },
    env: { PATINA_KO_DIAGNOSIS_RESEARCH: '1' },
    callLLMStream: async ({ prompt }) => {
      seenPrompt = prompt;
      return { text };
    },
    scoreFns: {
      scoreMPS: async () => (mpsResult(100)),
      scoreFidelity: async () => (fidelityResult(12)),
      scoreDeterministicSignals: () => ({}),
    },
    emit() {},
  });

  assert.equal(result.ok, true);
  assert.match(seenPrompt, /fix only the 1–2 highest-impact detected structural issues/);
  assert.doesNotMatch(seenPrompt, /koDiagnosis\.v1/);
});

test('scoringExtraBody sends reasoning control only to the providers it was measured on', () => {
  // gemini (2026-07-29) and deepseek (2026-08-03) are the providers the
  // setting was measured against; sending an unrecognized field blind to a
  // BYOK caller's provider risks a hard 400 (gemini itself rejects
  // reasoning_effort 'none' that way).
  assert.deepEqual(scoringExtraBody('gemini'), { reasoning_effort: 'low' });
  assert.deepEqual(scoringExtraBody('deepseek'), { reasoning_effort: 'low' });
  for (const provider of ['openai', 'claude', 'kimi', 'glm', undefined, '']) {
    assert.equal(scoringExtraBody(provider), undefined, `${provider} must keep the provider default`);
  }
  // Explicit kill switch for operators.
  assert.equal(scoringExtraBody('gemini', { PATINA_SCORING_REASONING: 'off' }), undefined);
  assert.equal(scoringExtraBody('deepseek', { PATINA_SCORING_REASONING: 'off' }), undefined);
  assert.deepEqual(scoringExtraBody('gemini', { PATINA_SCORING_REASONING: 'on' }), { reasoning_effort: 'low' });
});

test('rewriteExtraBody cuts reasoning only for server-paid free-tier deepseek rewrites', () => {
  assert.deepEqual(rewriteExtraBody('deepseek', 'free'), { reasoning_effort: 'low' });
  // BYOK and pro keep their provider defaults: quality belongs to the payer.
  assert.equal(rewriteExtraBody('deepseek', 'byok'), undefined);
  assert.equal(rewriteExtraBody('deepseek', 'pro'), undefined);
  // Other providers never receive the field (gemini amputation lesson).
  for (const provider of ['gemini', 'openai', 'claude', 'kimi', 'glm', undefined]) {
    assert.equal(rewriteExtraBody(provider, 'free'), undefined, `${provider} must keep full rewrite thinking`);
  }
  // Operator override: level allowlist with an off switch; junk falls back to low.
  assert.deepEqual(rewriteExtraBody('deepseek', 'free', { PATINA_FREE_REWRITE_REASONING: 'medium' }), { reasoning_effort: 'medium' });
  assert.equal(rewriteExtraBody('deepseek', 'free', { PATINA_FREE_REWRITE_REASONING: 'off' }), undefined);
  assert.deepEqual(rewriteExtraBody('deepseek', 'free', { PATINA_FREE_REWRITE_REASONING: 'none' }), { reasoning_effort: 'low' });
});

test('runWebRewriteStream forwards scoring reasoning control to both scorers, never to the gemini rewrite', async () => {
  const seen = { rewrite: undefined, mps: undefined, fidelity: undefined };
  await runWebRewriteStream({
    request: { ...request, provider: 'gemini', original: 'We shipped 3 units.' },
    callLLMStream: async (args) => {
      seen.rewrite = args.extraBody;
      return { text: 'We shipped 3 units.' };
    },
    scoreFns: {
      scoreMPS: async (args) => { seen.mps = args.extraBody; return mpsResult(95); },
      scoreFidelity: async (args) => { seen.fidelity = args.extraBody; return fidelityResult(11); },
      scoreDeterministicSignals: () => ({ signalScore: 0 }),
    },
    emit() {},
  });
  assert.deepEqual(seen.mps, { reasoning_effort: 'low' });
  assert.deepEqual(seen.fidelity, { reasoning_effort: 'low' });
  // Reduced thinking on the gemini rewrite call was previously measured to
  // amputate content, so it must never carry the field.
  assert.equal(seen.rewrite, undefined);
});

test('runWebRewriteStream sends the free-tier deepseek rewrite its reasoning cut', async () => {
  const seen = { rewrite: undefined, mps: undefined };
  await runWebRewriteStream({
    request: { ...request, tier: 'free', provider: 'deepseek', original: 'We shipped 3 units.' },
    callLLMStream: async (args) => {
      seen.rewrite = args.extraBody;
      return { text: 'We shipped 3 units.' };
    },
    scoreFns: {
      scoreMPS: async (args) => { seen.mps = args.extraBody; return mpsResult(95); },
      scoreFidelity: async () => (fidelityResult(11)),
      scoreDeterministicSignals: () => ({ signalScore: 0 }),
    },
    emit() {},
  });
  assert.deepEqual(seen.rewrite, { reasoning_effort: 'low' });
  assert.deepEqual(seen.mps, { reasoning_effort: 'low' });
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
  assert.deepEqual(terminal.mps, mpsResult(50));
  assert.deepEqual(terminal.fidelity, fidelityResult(11));
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

test('runWebRewriteStream retains private Korean invariant evidence on floor failure', async () => {
  const original = '운영팀은 배포를 승인하지 않았다. 결과는 담당자에 의해 검토된다.';
  const result = await runWebRewriteStream({
    request: {
      ...request,
      lang: 'ko',
      text: original,
      original,
    },
    env: { PATINA_KO_DIAGNOSIS_RESEARCH: '1' },
    callLLMStream: async () => ({
      text: '운영팀은 배포를 승인했다. 결과는 담당자에 의해 검토된다.',
    }),
    scoreFns: scoring({ mps: 50, fidelity: 95 }),
    emit() {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'floor_failed');
  assert.equal(result.koreanInvariants.checks.polarity.ok, false);
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
      return mpsResult(95);
    },
    scoreFidelity: async ({ signal, timeout, onAttempt }) => {
      seen.scorers.push({ signal, timeout });
      onAttempt(privateAttempt());
      return fidelityResult(11);
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
    now: () => 1000,
    deadlineNow: () => 0, // fixed monotonic clock: the full budget remains at every stage
  });

  assert.equal(result.ok, true);
  // With a total budget, stages receive the deadline-combined signal (fires on
  // caller abort OR exhaustion) — not the raw caller signal — and each stage's
  // timeout is its REMAINING share of the budget (here, all of it: clock fixed).
  assert.notEqual(seen.stream.signal, controller.signal);
  assert.equal(seen.stream.signal.aborted, false);
  assert.equal(seen.stream.timeout, 4321);
  assert.equal(seen.scorers.length, 2);
  for (const scorer of seen.scorers) {
    assert.notEqual(scorer.signal, controller.signal);
    assert.equal(scorer.signal.aborted, false);
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
      return fidelityResult(11);
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
      scoreMPS: async () => { scorerCalls += 1; return mpsResult(95); },
      scoreFidelity: async () => { scorerCalls += 1; return fidelityResult(11); },
      scoreDeterministicSignals: () => {
        throw new Error('deterministic scoring must not run after ambiguous date failure');
      },
    },
    emit: (frame) => frames.push(frame),
    numberSafetyRetries: 0,
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
test('terminal observer maps every terminal outcome once without frame leakage', async () => {
  const canary = 'stream-observer-private-canary';
  const scenarios = [
    {
      name: 'completed',
      request: { ...request, original: 'We shipped 3 units.' },
      callLLMStream: async ({ onAttempt }) => {
        onAttempt(privateAttempt());
        return { text: 'We shipped 3 units.' };
      },
      scoreFns: scoring(),
      expected: { outcome: 'completed', status: 200, totalTokens: 12, llmCalls: 3 },
    },
    {
      name: 'completed with malformed token usage',
      request: { ...request, original: 'We shipped 3 units.' },
      callLLMStream: async ({ onAttempt }) => {
        onAttempt(privateAttempt({ usage: { prompt_tokens: '4', completion_tokens: 0 } }));
        return { text: 'We shipped 3 units.' };
      },
      scoreFns: scoring(),
      expected: { outcome: 'completed', status: 200, totalTokens: undefined, llmCalls: 3 },
    },
    {
      name: 'number safety',
      request: { ...request, original: 'Report date: 01/02/2024.' },
      callLLMStream: async () => ({ text: 'Report date: 01/02/2024.' }),
      scoreFns: scoring(),
      expected: { outcome: 'number_safety_failed', status: 422, totalTokens: undefined, llmCalls: undefined },
    },
    {
      name: 'stream failure',
      request,
      callLLMStream: async () => { throw new Error(canary); },
      scoreFns: scoring(),
      expected: { outcome: 'terminal_failed', status: 500, totalTokens: undefined, llmCalls: undefined },
    },
    {
      name: 'scoring failure',
      request: { ...request, original: 'We shipped three units.' },
      callLLMStream: async () => ({ text: 'We shipped three units.' }),
      scoreFns: {
        ...scoring(),
        scoreMPS: async () => { throw new Error(canary); },
      },
      expected: { outcome: 'terminal_failed', status: 500, totalTokens: undefined, llmCalls: undefined },
    },
    {
      name: 'floor failure',
      request: { ...request, original: 'We shipped three units.' },
      callLLMStream: async () => ({ text: 'We shipped three units.' }),
      scoreFns: scoring({ mps: 1, fidelity: 1 }),
      expected: { outcome: 'terminal_failed', status: 422, totalTokens: undefined, llmCalls: undefined },
    },
  ];
  for (const scenario of scenarios) {
    const frames = [];
    const events = [];
    const result = await runWebRewriteStream({
      request: scenario.request,
      callLLMStream: scenario.callLLMStream,
      scoreFns: scenario.scoreFns,
      emit: (frame) => frames.push(frame),
      now: () => 100,
      observe(event) { events.push(event); return Promise.reject(new Error('observer failure')); },
    });
    assert.equal(result.observed, true, scenario.name);
    assert.deepEqual(events, [{
      tier: scenario.request.tier,
      ...scenario.expected,
      latencyMs: 0,
    }], scenario.name);
    assert.equal(JSON.stringify(events).includes(canary), false, scenario.name);
    assertFramesDoNotLeakPrivateMetadata(frames);
  }
});

test('terminal observer is optional and cannot change frames when it throws', async () => {
  const frames = [];
  const result = await runWebRewriteStream({
    request: { ...request, original: 'We shipped 3 units.' },
    callLLMStream: async () => ({ text: 'We shipped 3 units.' }),
    scoreFns: scoring(),
    emit: (frame) => frames.push(frame),
    observe() { throw new Error('observer failure'); },
  });
  assert.equal(result.ok, true);
  assert.equal(result.observed, true);
  assert.deepEqual(frames.map((frame) => frame.type), ['start', 'done']);

  const unobserved = await runWebRewriteStream({
    request: { ...request, original: 'We shipped 3 units.' },
    callLLMStream: async () => ({ text: 'We shipped 3 units.' }),
    scoreFns: scoring(),
    emit() {},
  });
  assert.equal(unobserved.observed, false);
});

test('runWebRewriteStream treats timeout as ONE total budget shared by every stage', async () => {
  const frames = [];
  let llmCalls = 0;
  // Injectable clock: advance past the deadline after the first paid attempt,
  // so a number-safety retry must NOT start — the total budget is spent.
  let t = 0;
  const deadlineNow = () => t;
  const callLLMStream = async ({ onAttempt, signal, timeout }) => {
    llmCalls += 1;
    assert.notEqual(signal, undefined);
    if (llmCalls === 1) {
      assert.equal(timeout, 5_000);
      onAttempt(privateAttempt());
      t = 10_000; // clock jumps past the 5s deadline before the retry is considered
      return { text: 'We shipped 4 units.' }; // trips number safety → retry
    }
    throw new Error('retry must not run: budget already exhausted');
  };
  const result = await runWebRewriteStream({
    request: { ...request, original: 'We shipped 3 units.' },
    callLLMStream,
    scoreFns: {
      scoreMPS: async () => { throw new Error('scoring must not run'); },
      scoreFidelity: async () => { throw new Error('scoring must not run'); },
      scoreDeterministicSignals: () => { throw new Error('scoring must not run'); },
    },
    emit: (frame) => frames.push(frame),
    timeout: 5_000,
    deadlineNow,
  });

  assert.equal(llmCalls, 1);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'stream_failed');
  assert.equal(result.error, 'stream budget exhausted');
  assert.deepEqual(frames.at(-1), { type: 'error', code: 'stream_failed', error: 'stream budget exhausted' });
});

test('runWebRewriteStream fails scoring closed when the shared budget is exhausted after rewrite', async () => {
  const frames = [];
  let scorerCalls = 0;
  // Clock: rewrite stage runs at t=0 (budget 5s); before the rewrite returns,
  // jump past the deadline so the scorer stage must fail closed, scorers uncalled.
  let t = 0;
  const deadlineNow = () => t;
  const result = await runWebRewriteStream({
    request: { ...request, original: 'We shipped 3 units.' },
    callLLMStream: async ({ onAttempt }) => {
      onAttempt(privateAttempt());
      t = 10_000; // budget exhausted once the rewrite text is in hand
      return { text: 'We shipped 3 units.' };
    },
    scoreFns: {
      scoreMPS: async () => { scorerCalls += 1; throw new Error('must not run'); },
      scoreFidelity: async () => { scorerCalls += 1; throw new Error('must not run'); },
      scoreDeterministicSignals: () => ({ overall: 0, text: '' }),
    },
    emit: (frame) => frames.push(frame),
    timeout: 5_000,
    deadlineNow,
  });

  assert.equal(scorerCalls, 0);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'scoring_failed');
  assert.equal(result.error, 'stream budget exhausted');
  assert.deepEqual(frames.at(-1), { type: 'error', code: 'scoring_failed', error: 'stream budget exhausted' });
});

test('runWebRewriteStream combines the caller signal with the deadline signal', async () => {
  const frames = [];
  const caller = new AbortController();
  /** @type {AbortSignal|undefined} */
  let seenSignal;
  const result = await runWebRewriteStream({
    request: { ...request, original: 'We shipped 3 units.' },
    callLLMStream: ({ signal }) => {
      seenSignal = signal;
      caller.abort(new Error('client disconnected')); // abort after the rewrite is active
      return new Promise(() => {}); // ignores abort; orchestration must still finish
    },
    scoreFns: scoring(),
    emit: (frame) => frames.push(frame),
    signal: caller.signal,
    timeout: 60_000,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'stream_failed');
  assert.notEqual(seenSignal, caller.signal); // the deadline-combined signal, not the raw caller signal
  assert.ok(seenSignal);
  assert.equal(seenSignal.aborted, true);
});

test('runWebRewriteStream deadline completes an in-flight non-settling rewrite and suppresses late deltas', async () => {
  const frames = [];
  const startedAt = Date.now();
  const result = await runWebRewriteStream({
    request: { ...request, original: 'We shipped 3 units.' },
    callLLMStream: ({ onDelta }) => new Promise((resolve) => {
      setTimeout(() => {
        onDelta('late private delta');
        resolve({ text: 'We shipped 3 units.' });
      }, 50);
    }),
    scoreFns: scoring(),
    emit: (frame) => frames.push(frame),
    timeout: 5,
  });
  assert.ok(Date.now() - startedAt < 500, 'orchestration must not await the uncooperative provider');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'stream_failed');
  assert.deepEqual(frames.at(-1), { type: 'error', code: 'stream_failed', error: 'stream budget exhausted' });
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(frames.some((frame) => frame.type === 'delta'), false, 'late provider callbacks are closed');
});

test('runWebRewriteStream deadline completes non-settling scorers', async () => {
  const frames = [];
  // A fake monotonic clock keeps the two deadline paths deterministic: with a
  // real 5 ms budget, a loaded or slower host can exhaust the budget during
  // the stream phase and report stream_failed instead of scoring_failed.
  let now = 1000;
  const result = await runWebRewriteStream({
    request: { ...request, original: 'We shipped 3 units.' },
    callLLMStream: async ({ onAttempt }) => {
      onAttempt(privateAttempt());
      return { text: 'We shipped 3 units.' };
    },
    scoreFns: {
      scoreMPS: () => { now += 10; return new Promise(() => {}); },
      scoreFidelity: () => new Promise(() => {}),
      scoreDeterministicSignals: () => ({}),
    },
    emit: (frame) => frames.push(frame),
    timeout: 5,
    deadlineNow: () => now,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'scoring_failed');
  assert.deepEqual(frames.at(-1), { type: 'error', code: 'scoring_failed', error: 'stream budget exhausted' });
});

test('runWebRewriteStream fails closed with a frame when the deadline clock is invalid', async () => {
  const frames = [];
  let called = false;
  const result = await runWebRewriteStream({
    request: { ...request, original: 'We shipped 3 units.' },
    callLLMStream: async () => { called = true; return { text: 'must not run' }; },
    scoreFns: scoring(),
    emit: (frame) => frames.push(frame),
    timeout: 5_000,
    deadlineNow: () => Number.NaN,
  });
  assert.equal(called, false);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'stream_failed');
  assert.deepEqual(frames.at(-1), { type: 'error', code: 'stream_failed', error: 'stream budget exhausted' });
});

test('runWebRewriteStream without a timeout keeps legacy per-stage behavior', async () => {
  const frames = [];
  let seenTimeout;
  const result = await runWebRewriteStream({
    request: { ...request, original: 'We shipped 3 units.' },
    callLLMStream: async ({ onAttempt, timeout }) => {
      seenTimeout = timeout;
      onAttempt(privateAttempt());
      return { text: 'We shipped 3 units.' };
    },
    scoreFns: scoring(),
    emit: (frame) => frames.push(frame),
  });
  assert.equal(result.ok, true);
  assert.equal(seenTimeout, undefined);
});
