import test from 'node:test';
import assert from 'node:assert';
import {
  detectEnglishShortFormTells,
  DEFAULT_SHORT_FORM_LIMITS,
} from '../../src/features/short-form.js';

test('social/marketing short English maps em-dash count to Low/Medium/High', () => {
  const one = detectEnglishShortFormTells('built it for exactly that — kept the meaning.', {
    profile: 'social',
  });
  assert.strictEqual(one.eligible, true);
  assert.strictEqual(one.emDash.count, 1);
  assert.strictEqual(one.emDash.severity, 1); // Low
  assert.strictEqual(one.emDash.detected, true);
  assert.strictEqual(one.emDash.perSentence, 1);

  const two = detectEnglishShortFormTells('first — then — done.', { profile: 'marketing' });
  assert.strictEqual(two.emDash.count, 2);
  assert.strictEqual(two.emDash.severity, 2); // Medium

  const many = detectEnglishShortFormTells('fast — clean — simple — yours — now.', { profile: 'social' });
  assert.strictEqual(many.emDash.count, 4);
  assert.strictEqual(many.emDash.severity, 3); // High (capped at 3)
});

test('register override activates the branch without a social profile', () => {
  const r = detectEnglishShortFormTells('a clean launch — for teams.', {
    profile: 'default',
    register: 'social',
  });
  assert.strictEqual(r.eligible, true);
  assert.strictEqual(r.emDash.severity, 1);
});

test('the default profile is inert (no false positive on general short text)', () => {
  const r = detectEnglishShortFormTells('built it for exactly that — kept the meaning.', {
    profile: 'default',
  });
  assert.strictEqual(r.eligible, false);
  assert.strictEqual(r.emDash.severity, 0);
  // The raw count is still recorded for observability even when inert.
  assert.strictEqual(r.emDash.count, 1);
  assert.strictEqual(r.emDash.detected, false);
});

test('the branch is English-only', () => {
  const r = detectEnglishShortFormTells('이 도구는 정말 유용하다 — 강력하다.', {
    lang: 'ko',
    profile: 'social',
  });
  assert.strictEqual(r.eligible, false);
  assert.strictEqual(r.emDash.severity, 0);
});

test('size limits gate the branch (chars and sentence count)', () => {
  const longText = 'word — '.repeat(60); // > 200 non-whitespace chars
  const tooLong = detectEnglishShortFormTells(longText, { profile: 'social' });
  assert.ok(tooLong.nonWhitespaceChars > DEFAULT_SHORT_FORM_LIMITS.maxNonWhitespaceChars);
  assert.strictEqual(tooLong.eligible, false);
  assert.strictEqual(tooLong.emDash.severity, 0);

  const manySentences = detectEnglishShortFormTells(
    'One — a. Two — b. Three — c. Four — d. Five — e.',
    { profile: 'social' }
  );
  assert.ok(manySentences.sentenceCount > DEFAULT_SHORT_FORM_LIMITS.maxProseSentences);
  assert.strictEqual(manySentences.eligible, false);
  assert.strictEqual(manySentences.emDash.severity, 0);
});

test('quoted dialogue and code dashes are excluded from the count', () => {
  const quoted = detectEnglishShortFormTells('she said "wait — stop" and left.', {
    profile: 'social',
  });
  assert.strictEqual(quoted.emDash.count, 0);
  assert.strictEqual(quoted.emDash.severity, 0);

  const inlineCode = detectEnglishShortFormTells('run `a — b` right now.', { profile: 'social' });
  assert.strictEqual(inlineCode.emDash.count, 0);

  const fenced = detectEnglishShortFormTells('see:\n```\nx — y\n```\ndone.', { profile: 'social' });
  assert.strictEqual(fenced.emDash.count, 0);
});

test('detector never throws on empty or nullish input', () => {
  for (const input of ['', null, undefined]) {
    const r = detectEnglishShortFormTells(input, { profile: 'social' });
    assert.strictEqual(r.emDash.count, 0);
    assert.strictEqual(r.emDash.severity, 0);
    assert.strictEqual(r.emDash.perSentence, 0);
  }
});
