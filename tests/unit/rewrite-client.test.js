import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { CONTEXT_LIMITS, WEB_TIERS } from '../../src/web-rewrite-contract.js';
import {
  classifyRewriteError,
  createRewriteThread,
  REWRITE_ERROR_KINDS,
  rewriteRecovery,
  streamRewrite,
} from '../../playground/rewrite-client.js';

function streamResponse(lines, { status = 200 } = {}) {
  const encoder = new globalThis.TextEncoder();
  return {
    ok: status >= 200 && status < 300,
    status,
    body: new globalThis.ReadableStream({
      start(controller) {
        for (const chunk of lines) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
  };
}

test('streamRewrite dispatches a split success stream in protocol order', async () => {
  const events = [];
  const fetchCalls = [];
  const fetchImpl = async (url, init) => {
    fetchCalls.push({ url, init });
    return streamResponse([
      '{"type":"start","id":"r1"}\n{"type":"delta","text":"Hel',
      'lo"}\n{"type":"delta","text":" world"}\n{"type":"done","mps":92,"fidelity":91}\n',
    ]);
  };

  const summary = await streamRewrite({
    body: { mode: 'first', lang: 'en', tier: 'free', text: 'Hello' },
    fetchImpl,
    onStart: () => events.push(['start']),
    onDelta: (text, accumulated) => events.push(['delta', text, accumulated]),
    onDone: (frame) => events.push(['done', frame.mps, frame.fidelity]),
    onError: (frame) => events.push(['error', frame.error]),
  });

  assert.equal(summary.ok, true);
  assert.equal(summary.finalFrame.type, 'done');
  assert.deepEqual(events, [
    ['start'],
    ['delta', 'Hello', 'Hello'],
    ['delta', ' world', 'Hello world'],
    ['done', 92, 91],
  ]);
  assert.equal(fetchCalls[0].url, '/api/rewrite');
  assert.equal(fetchCalls[0].init.method, 'POST');
  assert.equal(fetchCalls[0].init.headers['content-type'], 'application/json');
});
test('streamRewrite sends a Pro Bearer license only in the Authorization header', async () => {
  const body = { mode: 'first', lang: 'en', tier: 'pro', text: 'Hello' };
  const fetchCalls = [];
  const license = 'Bearer pro-license-token';

  await streamRewrite({
    body,
    authorization: license,
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url, init });
      return streamResponse(['{"type":"done"}\n']);
    },
  });

  assert.equal(fetchCalls.length, 1);
  const { init } = fetchCalls[0];
  assert.equal(init.headers.Authorization, license);
  assert.deepEqual(JSON.parse(init.body), {
    mode: 'first',
    lang: 'en',
    tier: 'pro',
    text: 'Hello',
  });
  assert.equal('authorization' in body, false);
  assert.equal('license' in body, false);
  assert.equal('Authorization' in JSON.parse(init.body), false);
  assert.equal('license' in JSON.parse(init.body), false);
});

test('streamRewrite treats terminal floor_failed frame as error and never calls done', async () => {
  const events = [];
  const fetchImpl = async () => streamResponse([
    '{"type":"start"}\n',
    '{"type":"delta","text":"unsafe"}\n',
    '{"type":"error","code":"floor_failed","error":"floors failed"}\n',
    '{"type":"done"}\n',
  ]);

  const summary = await streamRewrite({
    body: { mode: 'first', lang: 'en', tier: 'free', text: 'Hello' },
    fetchImpl,
    onDelta: (text) => events.push(['delta', text]),
    onDone: () => events.push(['done']),
    onError: (frame) => events.push(['error', frame.code]),
  });

  assert.equal(summary.ok, false);
  assert.deepEqual(events, [['delta', 'unsafe'], ['error', 'floor_failed']]);
});
test('streamRewrite resolves at the first terminal frame without awaiting EOF or later frames', async () => {
  const encoder = new globalThis.TextEncoder();
  let cancelled = 0;
  const response = {
    ok: true,
    status: 200,
    body: new globalThis.ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('{"type":"done","mps":92,"fidelity":91}\n{"type":"error","error":"late failure"}\n'));
      },
      cancel() {
        cancelled += 1;
      },
    }),
  };
  const events = [];
  const pending = streamRewrite({
    body: { mode: 'first', lang: 'en', tier: 'free', text: 'Hello' },
    fetchImpl: async () => response,
    onDone: () => events.push('done'),
    onError: () => events.push('error'),
  });
  let timeout;
  try {
    const summary = await Promise.race([
      pending,
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('terminal frame did not resolve promptly')), 50); }),
    ]);
    assert.equal(summary.ok, true);
    assert.equal(summary.finalFrame.type, 'done');
  } finally {
    clearTimeout(timeout);
  }
  await Promise.resolve();
  assert.equal(cancelled, 1);
  assert.deepEqual(events, ['done']);
});

test('streamRewrite reports non-2xx responses through onError', async () => {
  const errors = [];
  const summary = await streamRewrite({
    body: { mode: 'first', lang: 'en', tier: 'free', text: 'Hello' },
    fetchImpl: async () => streamResponse([], { status: 429 }),
    onDone: () => assert.fail('onDone must not fire for HTTP errors'),
    onError: (frame) => errors.push(frame),
  });

  assert.equal(summary.ok, false);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].type, 'error');
  assert.equal(errors[0].status, 429);
});

test('createRewriteThread builds first/refine requests (commit-on-done) and caps client history', () => {
  const thread = createRewriteThread({ lang: 'ko' });

  // buildRequest is PURE: before any commit, every request is a first turn.
  const freeBody = thread.buildRequest({ text: '원문', tier: WEB_TIERS.FREE, apiKey: 'sk-never-send' });
  assert.equal(freeBody.mode, 'first');
  assert.equal(freeBody.lang, 'ko');
  assert.equal(freeBody.text, '원문');
  assert.equal('instruction' in freeBody, false, 'a first turn has no draft to instruct against');
  assert.equal('apiKey' in freeBody, false);
  // Pure build does not mutate thread state.
  assert.equal(thread.original, undefined);

  // A second build WITHOUT commit is still a first turn (no original poisoning).
  assert.equal(thread.buildRequest({ text: '원문2', tier: WEB_TIERS.FREE }).mode, 'first');

  // Commit an accepted turn -> original anchored + history recorded.
  thread.commit({ userText: '원문', assistantText: '다시 쓴 원문' });
  assert.equal(thread.original, '원문');
  assert.equal(thread.currentDraft, '다시 쓴 원문');

  // Fill history past the cap via more committed turns.
  for (let i = 0; i < CONTEXT_LIMITS.maxTurns; i++) {
    thread.commit({ userText: `u-${i}`, assistantText: `a-${i}` });
  }
  assert.equal(thread.turns.length, CONTEXT_LIMITS.maxTurns);

  const byokBody = thread.buildRequest({
    text: '더 짧게',
    tier: WEB_TIERS.BYOK,
    provider: 'openai',
    model: 'gpt-4.1-mini',
    apiKey: 'sk-test-key',
  });

  assert.equal(byokBody.mode, 'refine');
  assert.equal(byokBody.original, '원문');
  // `text` is the text to rewrite in every mode: on a refine turn that is the
  // latest accepted draft, and the composer line travels as `instruction`.
  // (Sending the instruction as `text` is what made the server rewrite the
  // follow-up instead of the draft.)
  assert.equal(byokBody.text, thread.currentDraft);
  assert.equal(byokBody.instruction, '더 짧게');
  assert.deepEqual(byokBody.history, thread.turns);
  assert.equal(byokBody.provider, 'openai');
  assert.equal(byokBody.model, 'gpt-4.1-mini');
  assert.equal(byokBody.apiKey, 'sk-test-key');

  thread.reset();
  assert.equal(thread.original, undefined);
  assert.equal(thread.currentDraft, '');
  assert.deepEqual(thread.turns, []);
});

test('client history obeys the server byte cap and an over-cap draft still travels as text', () => {
  const thread = createRewriteThread({ lang: 'en' });
  const hugeDraft = 'D'.repeat(CONTEXT_LIMITS.maxBytes + 1);
  thread.commit({ userText: 'Source paragraph.', assistantText: hugeDraft });

  // The server drops history it cannot fit (normalizeHistory trims oldest-first
  // under maxBytes); the client now drops exactly the same turns instead of
  // sending turns the server would discard.
  assert.deepEqual(thread.turns, []);
  const body = thread.buildRequest({ text: 'Make it shorter.', tier: WEB_TIERS.FREE });
  assert.deepEqual(body.history, []);
  // Losing history loses edit preferences only: the draft is the rewrite target.
  assert.equal(body.text, hugeDraft);
  assert.equal(body.instruction, 'Make it shorter.');

  // A blank composer line adds no instruction field; the draft is still the target.
  const blank = thread.buildRequest({ text: '   ', tier: WEB_TIERS.FREE });
  assert.equal('instruction' in blank, false);
  assert.equal(blank.text, hugeDraft);
});

test('buildRequest carries an opted-in voice persona on every turn and omits it by default', () => {
  const thread = createRewriteThread({ lang: 'ko' });
  // No persona -> the field is absent (server picks its default voice).
  assert.equal('persona' in thread.buildRequest({ text: '원문', tier: WEB_TIERS.FREE }), false);
  // Opted-in voice -> present on the first turn.
  const first = thread.buildRequest({ text: '원문', tier: WEB_TIERS.FREE, persona: 'blog-essay' });
  assert.equal(first.persona, 'blog-essay');
  // ...and still present after commit (a refine turn keeps the chosen voice).
  thread.commit({ userText: '원문', assistantText: '다시 쓴 원문' });
  const refine = thread.buildRequest({ text: '더 짧게', tier: WEB_TIERS.FREE, persona: 'blog-essay' });
  assert.equal(refine.mode, 'refine');
  assert.equal(refine.persona, 'blog-essay');
});

test('classifyRewriteError maps every server reason string to a stable kind', () => {
  const K = REWRITE_ERROR_KINDS;
  // Exact reason strings emitted by src/rate-limit.js, api/rewrite.js, and
  // validateRewriteRequest — the classifier is the single recognition point.
  assert.equal(classifyRewriteError({ status: 429, error: 'daily quota exceeded' }), K.QUOTA_DAILY);
  assert.equal(classifyRewriteError({ status: 429, error: 'hourly burst exceeded' }), K.QUOTA_HOURLY);
  assert.equal(classifyRewriteError({ status: 429, error: 'concurrent limit exceeded' }), K.QUOTA_CONCURRENT);
  assert.equal(classifyRewriteError({ status: 400, error: 'client ip unavailable' }), K.IP_UNAVAILABLE);
  assert.equal(classifyRewriteError({ status: 503, error: 'quota storage unavailable' }), K.QUOTA_STORAGE);
  assert.equal(classifyRewriteError({ status: 503, error: 'quota secret unavailable' }), K.QUOTA_SECRET);
  assert.equal(classifyRewriteError({ status: 503, error: 'rewrite service unavailable' }), K.SERVICE_UNAVAILABLE);
  assert.equal(classifyRewriteError({ status: 413, error: 'text exceeds 4000 characters for tier free' }), K.TEXT_TOO_LONG);
  assert.equal(classifyRewriteError({ status: 413, error: 'original exceeds 20000 characters for tier byok' }), K.TEXT_TOO_LONG);
  assert.equal(classifyRewriteError({ code: 'floor_failed', error: 'floors failed' }), K.FLOOR_FAILED);
  // number_safety_failed frames carry no error string/status; the code alone
  // must map to dedicated copy instead of the generic "check the mode/key".
  assert.equal(classifyRewriteError({ code: 'number_safety_failed' }), K.NUMBER_SAFETY);
});

test('classifyRewriteError never reads patina quota copy out of an upstream failure', () => {
  const K = REWRITE_ERROR_KINDS;
  // stream_failed / scoring_failed describe the UPSTREAM provider. A BYOK
  // provider body can repeat patina's own reason strings verbatim, so matching
  // them would show the caller a quota refusal (plus a Pro upsell) for a limit
  // they never hit.
  assert.equal(classifyRewriteError({ code: 'stream_failed', error: 'HTTP 429: daily quota exceeded' }), K.UNKNOWN);
  assert.equal(classifyRewriteError({ code: 'scoring_failed', error: 'HTTP 429: monthly rewrite limit reached' }), K.UNKNOWN);
  assert.equal(classifyRewriteError({ code: 'stream_failed', error: 'HTTP 503: rewrite service unavailable' }), K.UNKNOWN);
  // The closed server-paid vocabulary is inert here by construction.
  assert.equal(classifyRewriteError({ code: 'stream_failed', error: 'upstream_rate_limited' }), K.UNKNOWN);
  // A real transport status on the frame still classifies.
  assert.equal(classifyRewriteError({ status: 503, code: 'stream_failed', error: 'upstream_unavailable' }), K.SERVICE_UNAVAILABLE);
  // patina's own refusals carry no stream code and are unaffected.
  assert.equal(classifyRewriteError({ status: 429, error: 'daily quota exceeded' }), K.QUOTA_DAILY);
});

test('classifyRewriteError falls back conservatively for unrecognized failures', () => {
  const K = REWRITE_ERROR_KINDS;
  // Unknown quota reasons must not invent a quota window or reset time.
  assert.equal(classifyRewriteError({ status: 429, error: 'rate limited' }), K.QUOTA_UNKNOWN);
  assert.equal(classifyRewriteError({ status: 503, error: 'upstream exploded' }), K.SERVICE_UNAVAILABLE);
  assert.equal(classifyRewriteError({ status: 502 }), K.SERVICE_UNAVAILABLE);
  assert.equal(classifyRewriteError({ status: 500, error: 'internal error' }), K.UNKNOWN);
  assert.equal(classifyRewriteError({ status: 400, error: 'invalid JSON' }), K.UNKNOWN);
  // A source the server can never certify is a different message from a
  // rewrite that changed a number; both send the user back to edit the text.
  assert.equal(classifyRewriteError({ code: 'number_safety_failed' }), K.NUMBER_SAFETY);
  assert.equal(classifyRewriteError({ code: 'number_safety_failed', scope: 'source' }), K.NUMBER_SOURCE);
  assert.equal(classifyRewriteError({ code: 'number_safety_failed', scope: 'rewrite' }), K.NUMBER_SAFETY);
  assert.equal(rewriteRecovery(K.NUMBER_SOURCE), 'edit');
  assert.equal(classifyRewriteError({}), K.UNKNOWN);
  assert.equal(classifyRewriteError(null), K.UNKNOWN);
  assert.equal(classifyRewriteError(undefined), K.UNKNOWN);
});

test('streamRewrite abort rejects with AbortError so the caller can classify user cancel', async () => {
  const encoder = new globalThis.TextEncoder();
  const fetchImpl = async (_url, init) => ({
    ok: true,
    status: 200,
    body: new globalThis.ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('{"type":"start"}\n'));
        // Simulate fetch abort semantics: the pending read rejects on abort.
        init.signal.addEventListener('abort', () => {
          controller.error(new globalThis.DOMException('The operation was aborted.', 'AbortError'));
        });
      },
    }),
  });

  const controller = new globalThis.AbortController();
  const done = [];
  await assert.rejects(
    streamRewrite({
      body: { mode: 'first', lang: 'en', tier: 'free', text: 'Hello' },
      fetchImpl,
      signal: controller.signal,
      onStart: () => controller.abort(),
      onDone: () => done.push('done'),
    }),
    (err) => err.name === 'AbortError',
  );
  assert.deepEqual(done, []);
});
