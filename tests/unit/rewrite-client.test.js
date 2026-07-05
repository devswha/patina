import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { CONTEXT_LIMITS, WEB_TIERS } from '../../src/web-rewrite-contract.js';
import {
  classifyRewriteError,
  createRewriteThread,
  REWRITE_ERROR_KINDS,
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
  assert.deepEqual(byokBody.history, thread.turns);
  assert.equal(byokBody.provider, 'openai');
  assert.equal(byokBody.model, 'gpt-4.1-mini');
  assert.equal(byokBody.apiKey, 'sk-test-key');

  thread.reset();
  assert.equal(thread.original, undefined);
  assert.equal(thread.currentDraft, '');
  assert.deepEqual(thread.turns, []);
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
});

test('classifyRewriteError falls back conservatively for unrecognized failures', () => {
  const K = REWRITE_ERROR_KINDS;
  // Unknown quota reason → retry-shortly copy beats a wrong "come back tomorrow".
  assert.equal(classifyRewriteError({ status: 429, error: 'rate limited' }), K.QUOTA_HOURLY);
  assert.equal(classifyRewriteError({ status: 503, error: 'upstream exploded' }), K.SERVICE_UNAVAILABLE);
  assert.equal(classifyRewriteError({ status: 502 }), K.SERVICE_UNAVAILABLE);
  assert.equal(classifyRewriteError({ status: 500, error: 'internal error' }), K.UNKNOWN);
  assert.equal(classifyRewriteError({ status: 400, error: 'invalid JSON' }), K.UNKNOWN);
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
