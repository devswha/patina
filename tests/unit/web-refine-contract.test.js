// @ts-check
// CROSS-BOUNDARY contract test: browser thread -> request validation -> prompt.
//
// The client suite and the server suite each pinned their own meaning for the
// SAME field, and the two meanings were opposites: the playground pinned `text`
// as the user's follow-up instruction, src/web-rewrite pinned `text` as the
// latest draft. Both suites stayed green while a refine turn asked the model to
// rewrite the instruction string. Nothing is mocked here — the real
// createRewriteThread output goes through the real validateRewriteRequest into
// the real buildWebRewritePrompt — so the two sides cannot drift apart again.
import test from 'node:test';
import assert from 'node:assert/strict';

import { fidelityResult, mpsResult } from '../fixtures/verification-results.js';
import { createRewriteThread } from '../../playground/rewrite-client.js';
import { CONTEXT_LIMITS, validateRewriteRequest } from '../../src/web-rewrite-contract.js';
import { loadWebConfig, resolveBundleRoot } from '../../src/web-config.js';
import { buildWebRewritePrompt, loadWebAssets } from '../../src/web-rewrite.js';
import { runWebRewriteStream } from '../../src/web-rewrite-stream.js';
import { sha256 } from '../../src/web-rewrite-receipt.js';

const repoRoot = resolveBundleRoot();
const INPUT_DATA_FENCE = '⟦⟦⟦PATINA_INPUT_DATA⟧⟧⟧';
const EDIT_REQUEST_LABEL = '## User edit request (this turn)';
// BYOK: the free cap (4,000 chars) cannot carry the over-cap draft case below.
const BYOK = { tier: 'byok', provider: 'openai', model: 'gpt-4.1-mini', apiKey: 'sk-cross-boundary' };

/** Validate a browser-built body with the real contract and return the request. */
function validated(body) {
  const result = validateRewriteRequest(body);
  assert.equal(result.ok, true, `contract rejected the browser request: ${'error' in result ? result.error : ''}`);
  return /** @type {any} */ (result).value;
}

/** Build the prompt a validated request actually produces. */
function promptFor(request) {
  const documentType = request.documentType || 'default';
  const config = { ...loadWebConfig({ repoRoot }), language: request.lang, documentType };
  const assets = loadWebAssets({ repoRoot, lang: request.lang, documentType, config });
  return buildWebRewritePrompt({ request, config, assets });
}

/** Contents of the fenced block under `label`, or null when absent. */
function fencedSection(prompt, label) {
  const heading = prompt.indexOf(label);
  if (heading === -1) return null;
  const opening = prompt.indexOf(INPUT_DATA_FENCE, heading);
  assert.notEqual(opening, -1, `${label} must be fenced`);
  const closing = prompt.indexOf(INPUT_DATA_FENCE, opening + INPUT_DATA_FENCE.length);
  assert.notEqual(closing, -1, `${label} fence must close`);
  return prompt.slice(opening + INPUT_DATA_FENCE.length, closing).trim();
}

/** The rewrite target: the fenced block under the Input Text heading. */
function inputText(prompt) {
  const block = fencedSection(prompt, '## Input Text');
  assert.ok(block !== null, 'prompt must carry a fenced Input Text section');
  return block;
}

test('a browser refine turn rewrites the latest draft and carries the instruction separately', () => {
  const thread = createRewriteThread({ lang: 'en' });
  const source = 'Our team leveraged a holistic framework to unlock synergies across the org.';
  const draft = 'We built one plan for the whole team, and the handoffs got shorter.';
  thread.commit({ userText: source, assistantText: draft }); // an accepted first turn

  const request = validated(thread.buildRequest({ text: 'Make it shorter.', ...BYOK }));
  assert.equal(request.mode, 'refine');
  assert.equal(request.text, draft, 'the request rewrites the latest accepted draft');
  assert.equal(request.instruction, 'Make it shorter.');
  assert.equal(request.original, source, 'meaning is still anchored to the source');

  const prompt = promptFor(request);
  assert.equal(inputText(prompt), draft, 'the draft is the Input Text rewrite target');
  assert.equal(fencedSection(prompt, EDIT_REQUEST_LABEL), 'Make it shorter.', 'the instruction gets its own fenced section');
  assert.ok(!inputText(prompt).includes('Make it shorter.'), 'the instruction is NOT the rewrite target');
  assert.ok(prompt.indexOf(EDIT_REQUEST_LABEL) < prompt.indexOf('## Input Text'), 'the edit request is reference data, read before the target');
  assert.match(prompt, /the user's edit request for THIS turn/);
});

test('a Korean refine turn carries the same split with the Korean trusted directive', () => {
  const thread = createRewriteThread({ lang: 'ko' });
  const source = '우리 팀은 총체적인 프레임워크를 활용하여 시너지를 창출했습니다.';
  const draft = '우리 팀은 계획을 하나로 합쳤고, 그래서 인수인계가 짧아졌다.';
  thread.commit({ userText: source, assistantText: draft });

  const request = validated(thread.buildRequest({ text: '더 짧게', ...BYOK }));
  assert.equal(request.text, draft);
  assert.equal(request.instruction, '더 짧게');

  const prompt = promptFor(request);
  assert.equal(inputText(prompt), draft);
  assert.equal(fencedSection(prompt, EDIT_REQUEST_LABEL), '더 짧게');
  assert.match(prompt, /"사용자 편집 요청"은 이번 턴에 사용자가 요청한 편집이다/);
  assert.ok(prompt.indexOf('다듬기(refine) 지시 — 신뢰 지시문') < prompt.indexOf(INPUT_DATA_FENCE), 'the Korean directive stays outside every fence');
});

test('a draft larger than the history byte cap is still the rewrite target', () => {
  const thread = createRewriteThread({ lang: 'en' });
  const source = 'A source paragraph that the first turn rewrote.';
  // One turn over the history byte cap: normalizeHistory empties the array, so
  // before the instruction field existed the prompt held no draft at all.
  const draft = `LONG DRAFT START. ${'The team shipped the change and moved on. '.repeat(400)}LONG DRAFT END.`;
  assert.ok(new globalThis.TextEncoder().encode(draft).length > CONTEXT_LIMITS.maxBytes);
  thread.commit({ userText: source, assistantText: draft });

  const request = validated(thread.buildRequest({ text: 'Make it shorter.', ...BYOK }));
  assert.deepEqual(request.history, [], 'the contract drops history it cannot fit');
  assert.equal(request.text, draft);

  const prompt = promptFor(request);
  assert.equal(inputText(prompt), draft, 'the draft reaches the model as Input Text, not through history');
  assert.equal(fencedSection(prompt, '## Conversation history (edit preference)'), '(none)');
  assert.equal(fencedSection(prompt, EDIT_REQUEST_LABEL), 'Make it shorter.');
});

test('the hosted stream path carries the instruction and receipts the draft', async () => {
  // The prompt the hosted surface really builds: api/rewrite.js forwards the
  // validated request to runWebRewriteStream, which hands it to
  // buildWebRewritePrompt. Stubs stand in for the model and the scorers only.
  const thread = createRewriteThread({ lang: 'en' });
  const source = 'Our team leveraged a holistic framework to unlock synergies across the org.';
  const draft = 'We built one plan for the whole team, and the handoffs got shorter.';
  thread.commit({ userText: source, assistantText: draft });
  const request = validated(thread.buildRequest({ text: 'Make it shorter.', ...BYOK }));

  let prompt = '';
  const frames = [];
  const result = await runWebRewriteStream({
    request,
    callLLMStream: async (options) => {
      prompt = String(options.prompt);
      // No numeric claim: the number-safety gate compares the output with the
      // original anchor, which has none.
      options.onDelta('Shared plans, shorter handoffs.');
      return { text: 'Shared plans, shorter handoffs.' };
    },
    scoreFns: {
      scoreMPS: async () => mpsResult(95),
      scoreFidelity: async () => fidelityResult(11),
      scoreDeterministicSignals: ({ text }) => ({ overall: text.length, text }),
    },
    emit: (frame) => frames.push(frame),
  });

  assert.equal(result.ok, true, 'the stubbed refine run must complete');
  assert.equal(inputText(prompt), draft, 'the hosted prompt rewrites the draft');
  assert.equal(fencedSection(prompt, EDIT_REQUEST_LABEL), 'Make it shorter.');
  // The receipt's `latest` hash binds the draft this turn rewrote, not the
  // instruction string.
  assert.equal(frames.at(-1).receipt.hashes.latest, sha256(draft));
  assert.equal(frames.at(-1).receipt.hashes.original, sha256(source));
});

test('a legacy refine body without an instruction validates and builds the pre-instruction prompt', () => {
  // Exactly what a deployed old client sends: the follow-up as `text`, no
  // instruction field. It must keep working and must not grow a new section.
  const legacy = {
    mode: 'refine',
    lang: 'en',
    tier: 'byok',
    text: 'Make it shorter.',
    original: 'Our team leveraged a holistic framework to unlock synergies.',
    history: [{ role: 'assistant', content: 'We built one plan for the whole team.' }],
    provider: 'openai',
    model: 'gpt-4.1-mini',
    apiKey: 'sk-legacy-client',
  };
  const request = validated(legacy);
  assert.equal('instruction' in request, false);

  const prompt = promptFor(request);
  assert.equal(prompt.indexOf(EDIT_REQUEST_LABEL), -1, 'no edit-request section without an instruction');
  assert.equal(prompt.split(INPUT_DATA_FENCE).length - 1, 6, 'three fenced sections, exactly as before');
  assert.equal(inputText(prompt), 'Make it shorter.', 'legacy semantics are unchanged: text is still the rewrite target');
});
