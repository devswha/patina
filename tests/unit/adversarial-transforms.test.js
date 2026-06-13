import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  zeroWidthInsert,
  homoglyphSubstitute,
  caseFold,
  stripPunctuation,
  repeatSentences,
  ADVERSARIAL_TRANSFORMS,
  summarizeRobustness,
} from '../quality/adversarial-transforms.mjs';

const ZWSP = '\u200B';

test('every adversarial transform is deterministic', () => {
  const sample = 'The tool is innovative. 이 도구는 혁신적이다! Cost: $5, fast?';
  for (const t of ADVERSARIAL_TRANSFORMS) {
    assert.equal(t.apply(sample), t.apply(sample), `${t.id} not deterministic`);
  }
});

test('zeroWidthInsert adds U+200B after every Nth non-space char, never after spaces', () => {
  // "abcdef" -> zero-width after the 4th char (d).
  assert.equal(zeroWidthInsert('abcdef'), `abcd${ZWSP}ef`);
  // Spaces do not advance the counter and never receive a marker.
  assert.equal(zeroWidthInsert('ab cd ef', 4), `ab cd${ZWSP} ef`);
  // Idempotent on empty input.
  assert.equal(zeroWidthInsert(''), '');
  // The marker survives NFC (sanity: still present after normalize).
  assert.ok(zeroWidthInsert('abcd').normalize('NFC').includes(ZWSP));
});

test('homoglyphSubstitute swaps mapped ASCII letters and leaves the rest', () => {
  const out = homoglyphSubstitute('cope');
  assert.notEqual(out, 'cope');
  assert.equal(out.normalize('NFC'), out, 'homoglyphs are not folded by NFC');
  // Each mapped letter changed code point but stays length-1.
  assert.equal([...out].length, 4);
  // Unmapped chars (digits, CJK, uppercase) pass through unchanged.
  assert.equal(homoglyphSubstitute('123 한국어'), '123 한국어');
});

test('caseFold uppercases and stripPunctuation removes ASCII + CJK punctuation', () => {
  assert.equal(caseFold('Hello'), 'HELLO');
  assert.equal(stripPunctuation('a, b. c! 가、나。').replace(/\s+/g, ' ').trim(), 'a b c 가 나');
});

test('repeatSentences duplicates each terminated sentence', () => {
  const out = repeatSentences('One. Two!');
  // Each sentence (+ its delimiter) appears twice.
  assert.equal((out.match(/One/g) || []).length, 2);
  assert.equal((out.match(/Two/g) || []).length, 2);
});

test('summarizeRobustness computes per-transform detection/clean retention and decision flips', () => {
  const rows = [
    // zero_width: 2 AI (one still hot, one evaded), 1 natural still clean.
    { transform: 'zero_width', expected_hot: true, baseline_hot: true, transformed_hot: true },
    { transform: 'zero_width', expected_hot: true, baseline_hot: true, transformed_hot: false },
    { transform: 'zero_width', expected_hot: false, baseline_hot: false, transformed_hot: false },
    // homoglyph: 1 AI fully retained, 1 natural turned into a false positive.
    { transform: 'homoglyph', expected_hot: true, baseline_hot: true, transformed_hot: true },
    { transform: 'homoglyph', expected_hot: false, baseline_hot: false, transformed_hot: true },
  ];
  const summary = summarizeRobustness(rows);
  assert.equal(summary.zero_width.positives, 2);
  assert.equal(summary.zero_width.detectionRetained, 1);
  assert.equal(summary.zero_width.detectionRetainedRate, 0.5);
  assert.equal(summary.zero_width.cleanRetainedRate, 1);
  assert.equal(summary.zero_width.decisionChanged, 1); // the evaded AI fixture flipped

  assert.equal(summary.homoglyph.detectionRetainedRate, 1);
  assert.equal(summary.homoglyph.cleanRetainedRate, 0); // natural became a false positive
  assert.equal(summary.homoglyph.decisionChanged, 1);

  // Empty input is tolerated.
  assert.deepEqual(summarizeRobustness([]), {});
});

test('ADVERSARIAL_TRANSFORMS exposes the five documented transforms in order', () => {
  assert.deepEqual(
    ADVERSARIAL_TRANSFORMS.map((t) => t.id),
    ['zero_width', 'homoglyph', 'case_fold', 'punctuation', 'repetition'],
  );
  for (const t of ADVERSARIAL_TRANSFORMS) {
    assert.equal(typeof t.apply, 'function');
    assert.equal(typeof t.label, 'string');
  }
});
