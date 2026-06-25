import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  CONTEXT_LIMITS,
  MPS_FLOOR,
  FIDELITY_FLOOR,
  PROVIDER_PRESETS,
  WEB_TIERS,
} from '../../src/web-rewrite-contract.js';
import { createRewriteThread, streamRewrite } from '../../playground/rewrite-client.js';
import {
  escapeHtml,
  providerOptions,
  renderDiffSummary,
  renderMessage,
  renderMetrics,
} from '../../playground/chat-ui.js';

function streamResponse(chunks, { status = 200 } = {}) {
  const encoder = new globalThis.TextEncoder();
  return {
    ok: status >= 200 && status < 300,
    status,
    body: new globalThis.ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
  };
}

function assertNoRawDangerousMarkup(html, label) {
  assert.doesNotMatch(html, /<\/?script\b/i, `${label}: raw script tag escaped`);
  assert.doesNotMatch(html, /<img\b/i, `${label}: raw img tag escaped`);
  assert.doesNotMatch(html, /<[^>]+\sonerror\s*=/i, `${label}: raw onerror attribute escaped`);
  assert.doesNotMatch(html, /(?:href|src)\s*=\s*["']?\s*javascript\s*:/i, `${label}: executable javascript URI escaped`);
  assert.doesNotMatch(html, /<\/textarea\s*>/i, `${label}: textarea closer escaped`);
  assert.match(html, /class="rewrite-chat__message|rewrite-diff|rewrite-metrics|&lt;|&gt;|&quot;|&#39;|&amp;/, `${label}: rendered only through known safe markup/escaping`);
}

async function runErrorStream(chunks, { status = 200 } = {}) {
  const events = [];
  const summary = await streamRewrite({
    body: { mode: 'first', lang: 'en', tier: WEB_TIERS.FREE, text: 'break me' },
    fetchImpl: async () => streamResponse(chunks, { status }),
    onDelta: (text) => events.push(['delta', text]),
    onDone: (frame) => events.push(['done', frame]),
    onError: (frame) => events.push(['error', frame]),
  });
  return { events, summary };
}

test('redteam XSS payloads are escaped across message, diff, metric, and streamed-delta render paths', async () => {
  const payloads = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    'javascript:alert(1)',
    '</textarea><script>alert(1)</script>',
    '" autofocus onfocus="alert(1)" data-x="',
    "' onmouseover='alert(1)'",
    '&lt;img src=x onerror=alert(1)&gt;',
    '\u003cscript\u003ealert(1)\u003c/script\u003e',
  ];

  for (const payload of payloads) {
    const escaped = escapeHtml(payload);
    assert.doesNotMatch(escaped, /[<>"']/, `escapeHtml encodes HTML syntax for ${payload}`);
    assertNoRawDangerousMarkup(renderMessage({ role: 'user', text: payload }), `renderMessage user ${payload}`);
    assertNoRawDangerousMarkup(renderMessage({ role: 'assistant', text: payload }), `renderMessage assistant ${payload}`);
    assertNoRawDangerousMarkup(renderDiffSummary({ summary: payload, before: payload, after: payload }), `renderDiffSummary ${payload}`);
  }

  const deltas = [];
  await streamRewrite({
    body: { mode: 'first', lang: 'en', tier: WEB_TIERS.FREE, text: 'xss' },
    fetchImpl: async () => streamResponse([
      '{"type":"delta","text":"<img src=x onerror=alert(1)>"}\n',
      '{"type":"done","mps":90,"fidelity":90}\n',
    ]),
    onDelta: (text) => deltas.push(text),
  });
  assertNoRawDangerousMarkup(renderMessage({ role: 'assistant', text: deltas.join('') }), 'stream delta rendered as chat message');
});

test('redteam terminal error frames, malformed frames, and HTTP failures never call onDone', async () => {
  const cases = [
    ['floor_failed terminal frame', ['{"type":"delta","text":"partial"}\n', '{"type":"error","code":"floor_failed","error":"floors failed"}\n', '{"type":"done"}\n']],
    ['stream_failed terminal frame', ['{"type":"delta","text":"partial"}\n', '{"type":"error","code":"stream_failed","error":"upstream died"}\n']],
    ['malformed frame line', ['not-json\n']],
    ['unknown frame line', ['{"type":"mystery","text":"ignored"}\n']],
    ['non-2xx response', [], { status: 500 }],
  ];

  for (const [label, chunks, options = {}] of cases) {
    const { events, summary } = await runErrorStream(chunks, options);
    assert.equal(summary.ok, false, label);
    assert.equal(events.some(([type]) => type === 'done'), false, label);
    assert.equal(events.some(([type]) => type === 'error'), true, label);
    if (label.includes('terminal frame')) {
      assert.deepEqual(events[0], ['delta', 'partial'], `${label}: partial delta observed before failure`);
    }
  }
});

test('redteam split chunked JSON frame is buffered and parsed once', async () => {
  const deltas = [];
  const summary = await streamRewrite({
    body: { mode: 'first', lang: 'en', tier: WEB_TIERS.FREE, text: 'chunk' },
    fetchImpl: async () => streamResponse([
      '{"type":"delta","text":"split',
      ' across chunks"}\n{"type":"done","mps":91,"fidelity":92}\n',
    ]),
    onDelta: (text, accumulated) => deltas.push([text, accumulated]),
    onDone: () => deltas.push(['done']),
  });

  assert.equal(summary.ok, true);
  assert.deepEqual(deltas, [['split across chunks', 'split across chunks'], ['done']]);
});

test('redteam BYOK apiKey hygiene keeps secrets out of free bodies and URLs', async () => {
  const thread = createRewriteThread({ lang: 'en' });
  const freeBody = thread.buildRequest({
    text: 'original',
    tier: WEB_TIERS.FREE,
    provider: 'evil',
    model: 'evil-model',
    apiKey: 'sk-free-should-not-appear',
  });

  assert.equal('apiKey' in freeBody, false);
  assert.equal('provider' in freeBody, false);
  assert.equal('model' in freeBody, false);
  assert.doesNotMatch(JSON.stringify(freeBody), /sk-free-should-not-appear|evil/);

  const byokBody = thread.buildRequest({
    text: 'refine',
    tier: WEB_TIERS.BYOK,
    provider: 'openai',
    model: 'gpt-4.1-mini',
    apiKey: 'sk-byok-only-in-json-body',
  });
  assert.equal(byokBody.apiKey, 'sk-byok-only-in-json-body');

  const calls = [];
  await streamRewrite({
    body: byokBody,
    url: '/api/rewrite?lang=en',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return streamResponse(['{"type":"done","mps":95,"fidelity":95}\n']);
    },
  });

  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0].url, /sk-byok-only-in-json-body|apiKey|key=/i);
  assert.equal(JSON.parse(calls[0].init.body).apiKey, 'sk-byok-only-in-json-body');
});

test('redteam history cap and refine mode preserve original (commit-on-done) while capping turns', () => {
  const thread = createRewriteThread({ lang: 'ko' });
  const first = thread.buildRequest({ text: '원본', tier: WEB_TIERS.FREE });
  assert.equal(first.mode, 'first');
  assert.equal(thread.original, undefined); // pure build: not committed yet

  // Commit the ACCEPTED first turn -> original anchored.
  thread.commit({ userText: '원본', assistantText: '다시1' });
  assert.equal(thread.original, '원본');

  // A later build is now a refine that preserves the original.
  const second = thread.buildRequest({ text: '새 입력', tier: WEB_TIERS.FREE });
  assert.equal(second.mode, 'refine');
  assert.equal(second.original, '원본');
  assert.equal(thread.original, '원본'); // unchanged by a pure build

  // Many committed turns cap the recent history; the original stays pinned.
  for (let i = 0; i < CONTEXT_LIMITS.maxTurns + 4; i += 1) {
    thread.commit({ userText: `u-${i}`, assistantText: `a-${i}` });
  }
  const refine = thread.buildRequest({ text: '다듬기', tier: WEB_TIERS.FREE });
  assert.equal(refine.mode, 'refine');
  assert.equal(refine.original, '원본');
  assert.equal(thread.turns.length, CONTEXT_LIMITS.maxTurns);
  assert.deepEqual(refine.history, thread.turns);
});

test('redteam failed turn does not poison thread state (no commit on error)', () => {
  const thread = createRewriteThread({ lang: 'en' });
  // A first turn that is NEVER committed (floor_failed/error) must leave the
  // thread pristine so the retry/next request is still a clean first turn.
  thread.buildRequest({ text: 'attempt that fails', tier: WEB_TIERS.FREE });
  assert.equal(thread.original, undefined);
  assert.deepEqual(thread.turns, []);
  const retry = thread.buildRequest({ text: 'attempt that fails', tier: WEB_TIERS.FREE });
  assert.equal(retry.mode, 'first');
});

test('redteam floor warning renders exactly on failed MPS/fidelity/floor flags', () => {
  const passing = renderMetrics({ mps: MPS_FLOOR, fidelity: FIDELITY_FLOOR, floorFailed: false });
  assert.doesNotMatch(passing, /role="alert"/);
  assert.doesNotMatch(passing, /floor warning/i);

  for (const metrics of [
    { mps: MPS_FLOOR - 1, fidelity: FIDELITY_FLOOR },
    { mps: MPS_FLOOR, fidelity: FIDELITY_FLOOR - 1 },
    { mps: MPS_FLOOR, fidelity: FIDELITY_FLOOR, floorFailed: true },
  ]) {
    const html = renderMetrics(metrics);
    assert.match(html, /role="alert"/);
    assert.match(html, /floor warning/i);
  }
});

test('redteam provider options expose only contract allowlist providers and models', () => {
  const options = providerOptions();
  assert.deepEqual(options.map((option) => option.provider).sort(), Object.keys(PROVIDER_PRESETS).sort());

  for (const option of options) {
    const preset = PROVIDER_PRESETS[option.provider];
    assert.ok(preset, `${option.provider} is allowlisted`);
    assert.equal(option.baseURL, preset.baseURL);
    assert.deepEqual(option.models, [...preset.models]);
  }

  const serialized = JSON.stringify(options);
  assert.doesNotMatch(serialized, /evil|localhost|javascript:|__proto__|constructor/i);
});
