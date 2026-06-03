import { strict as assert } from 'node:assert';
import test from 'node:test';

import { detectMarkupLeakage } from '../../src/features/markup-leakage.js';
import { analyzeText } from '../../src/features/index.js';

test('detects OpenAI citation markup', () => {
  const r = detectMarkupLeakage('The study found X :contentReference[oaicite:0]{index=0} and more.');
  assert.equal(r.leaked, true);
  assert.ok(r.hits.some((h) => h.id === 'oai-citation-markup'));
});

test('detects model tool tokens (turn0search, navlist, grok_card)', () => {
  for (const s of ['see turn0search1 for', 'rendered navlist here', 'a grok_card block']) {
    assert.equal(detectMarkupLeakage(s).leaked, true, s);
  }
});

test('detects object-replacement character', () => {
  assert.equal(detectMarkupLeakage('a line with ￼ in it').leaked, true);
});

test('detects AI tracking params in URLs', () => {
  assert.equal(detectMarkupLeakage('source: https://example.com/x?utm_source=chatgpt.com').leaked, true);
});

test('detects explicit AI self-identification', () => {
  for (const s of ['As an AI language model, I cannot', "I'm an AI, so", 'as a large language model']) {
    assert.equal(detectMarkupLeakage(s).leaked, true, s);
  }
});

test('does NOT fire on clean human prose', () => {
  const clean =
    'We cut the onboarding doc from 1,400 words to 600. People actually read it now. ' +
    'The team shipped it on a Tuesday and moved on.';
  assert.equal(detectMarkupLeakage(clean).leaked, false);
});

test('does NOT fire on ordinary use of "AI" or "model"', () => {
  assert.equal(detectMarkupLeakage('I built an AI tool. The model is small.').leaked, false);
  assert.equal(detectMarkupLeakage('as an engineer, I think the model works').leaked, false);
});

test('analyzeText forces hot=true when leakage present', () => {
  const text =
    'This is a perfectly ordinary paragraph with varied rhythm and no tells at all.\n\n' +
    'Another normal paragraph here, written plainly by a person.\n\n' +
    'A third one, just to clear the skip threshold, with a citation :contentReference[oaicite:1]{index=1}.';
  const r = analyzeText(text, { lang: 'en' });
  assert.equal(r.markupLeakage.leaked, true);
  assert.equal(r.hot, true);
});

test('analyzeText leaves markupLeakage clean on normal text', () => {
  const text =
    'A plainly written first paragraph that varies its sentence length a little.\n\n' +
    'A second human paragraph, nothing odd here, just prose.\n\n' +
    'And a third to clear the short-input skip, still ordinary writing.';
  const r = analyzeText(text, { lang: 'en' });
  assert.equal(r.markupLeakage.leaked, false);
});
