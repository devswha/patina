import { strict as assert } from 'node:assert';
import test from 'node:test';

import {
  detectFakeCandor,
  detectThematicBreaks,
  detectDiscourseTells,
} from '../../src/features/discourse-tells.js';
import { analyzeText } from '../../src/features/index.js';

test('fake-candor fires at >= 2 openers, not at 1', () => {
  assert.equal(detectFakeCandor("Here's the thing, it works.").hot, false);
  const two = detectFakeCandor("Here's the thing. And the truth is, it also scales.");
  assert.equal(two.hot, true);
  assert.ok(two.count >= 2);
});

test('fake-candor matches the documented opener set', () => {
  const text = "Let's be honest. Real talk. I'll be honest with you.";
  const r = detectFakeCandor(text);
  assert.ok(r.count >= 3);
  assert.equal(r.hot, true);
});

test('fake-candor does not fire on ordinary prose', () => {
  const clean = 'We shipped the feature on Tuesday. The team reviewed it and moved on.';
  assert.equal(detectFakeCandor(clean).hot, false);
  assert.equal(detectFakeCandor(clean).count, 0);
});

test('thematic breaks fire at >= 3 dividers, not at 2', () => {
  const two = 'A para\n\n---\n\nB para\n\n***\n\nC para';
  assert.equal(detectThematicBreaks(two).hot, false);
  const three = 'A\n\n---\n\nB\n\n***\n\nC\n\n___\n\nD';
  const r = detectThematicBreaks(three);
  assert.equal(r.hot, true);
  assert.ok(r.count >= 3);
});

test('thematic breaks count adjacency to headings', () => {
  const md = '---\n# Title\n\nbody\n\n---\n## Section\n\nmore\n\n---\n### Sub\n';
  const r = detectThematicBreaks(md);
  assert.equal(r.count, 3);
  assert.equal(r.adjacentToHeading, 3);
  assert.equal(r.hot, true);
});

test('thematic break does not fire on normal markdown with one rule', () => {
  const md = '# Title\n\nSome body text here.\n\n---\n\nA footer note.';
  assert.equal(detectThematicBreaks(md).hot, false);
});

test('detectDiscourseTells aggregates both', () => {
  const r = detectDiscourseTells("Here's the thing. The truth is, this works.\n\n---\n\nmore");
  assert.equal(r.fakeCandor.hot, true);
  assert.equal(r.thematicBreaks.hot, false);
  assert.equal(r.hot, true);
});

test('analyzeText attributes gated fake-candor to the carrying paragraphs (#391)', () => {
  // There is no document-level discourseTells.hot disjunct anymore: the
  // document goes hot because the opener-carrying paragraphs go hot.
  const text =
    "Here's the thing about this tool, it varies sentence length nicely here.\n\n" +
    "And the truth is, a second plainly written human paragraph follows.\n\n" +
    'A third paragraph clears the short-input skip threshold cleanly.';
  const r = analyzeText(text, { lang: 'en' });
  assert.equal(r.discourseTells.fakeCandor.hot, true);
  assert.deepEqual(r.paragraphs.map((p) => p.candorHot), [true, true, false]);
  assert.deepEqual(r.paragraphs.map((p) => p.candorCount), [1, 1, 0]);
  assert.equal(r.paragraphs[0].hot, true);
  assert.equal(r.paragraphs[1].hot, true);
  assert.equal(r.hot, true);
  assert.equal(
    r.hot,
    r.markupLeakage.leaked || r.structuralClassifier.hot === true || r.paragraphs.some((p) => p.hot),
  );
});

test('analyzeText attributes gated thematic breaks and they alone carry the document verdict (#391)', () => {
  // Three bare dividers between plainly human paragraphs: the dividers become
  // their own pseudo-paragraphs, each goes hot via thematicBreakHot, and the
  // document verdict rides on them — no other detector fires.
  const text = [
    'The standup ran long because the staging database fell over mid-demo again today.',
    '---',
    'Kwon restored it fast. Six minutes, snapshot from Tuesday, slow storage tier and all.',
    '---',
    'We still lost the seed data for the pricing experiment, which nobody mourned much.',
    '---',
  ].join('\n\n');
  const r = analyzeText(text, { lang: 'en' });

  assert.equal(r.discourseTells.thematicBreaks.hot, true);
  assert.equal(r.discourseTells.fakeCandor.hot, false);
  assert.equal(r.paragraphs.length, 6);
  assert.deepEqual(
    r.paragraphs.map((p) => p.thematicBreakHot),
    [false, true, false, true, false, true],
  );
  assert.deepEqual(
    r.paragraphs.map((p) => p.thematicBreakOnly),
    [false, true, false, true, false, true],
  );
  // The divider pseudo-paragraphs are exactly the hot ones.
  assert.deepEqual(
    r.paragraphs.map((p) => p.hot),
    [false, true, false, true, false, true],
  );
  assert.equal(r.markupLeakage.leaked, false);
  assert.notEqual(r.structuralClassifier.hot, true);
  assert.equal(r.hot, true);
});

test('thematic breaks below the document gate leave divider paragraphs cold', () => {
  const text = [
    'The standup ran long because the staging database fell over mid-demo again today.',
    '---',
    'Kwon restored it fast. Six minutes, snapshot from Tuesday, slow storage tier and all.',
    'We still lost the seed data for the pricing experiment, which nobody mourned much.',
  ].join('\n\n');
  const r = analyzeText(text, { lang: 'en' });

  assert.equal(r.discourseTells.thematicBreaks.hot, false);
  assert.equal(r.paragraphs[1].thematicBreakOnly, true);
  assert.equal(r.paragraphs[1].thematicBreakHot, false);
  assert.equal(r.paragraphs[1].hot, false);
  assert.equal(r.hot, false);
});

test('analyzeText leaves discourseTells clean on ordinary prose', () => {
  const text =
    'A plainly written first paragraph with some natural variation in length.\n\n' +
    'A second ordinary human paragraph, nothing unusual in here at all.\n\n' +
    'A third one to clear the skip threshold, still just normal writing.';
  const r = analyzeText(text, { lang: 'en' });
  assert.equal(r.discourseTells.hot, false);
});
