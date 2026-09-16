import test from 'node:test';
import assert from 'node:assert';
import {
  detectEnglishShortFormTells,
  DEFAULT_SHORT_FORM_LIMITS,
} from '../../src/features/short-form.js';

test('social/marketing short English maps em-dash count to Low/Medium/High', () => {
  const one = detectEnglishShortFormTells('built it for exactly that — kept the meaning.', {
    documentType: 'social',
  });
  assert.strictEqual(one.eligible, true);
  assert.strictEqual(one.emDash.count, 1);
  assert.strictEqual(one.emDash.severity, 1); // Low
  assert.strictEqual(one.emDash.detected, true);
  assert.strictEqual(one.emDash.perSentence, 1);

  const two = detectEnglishShortFormTells('first — then — done.', { documentType: 'marketing' });
  assert.strictEqual(two.emDash.count, 2);
  assert.strictEqual(two.emDash.severity, 2); // Medium

  const many = detectEnglishShortFormTells('fast — clean — simple — yours — now.', { documentType: 'social' });
  assert.strictEqual(many.emDash.count, 4);
  assert.strictEqual(many.emDash.severity, 3); // High (capped at 3)
});

test('register does not activate a Document-Type-specific signal', () => {
  const result = detectEnglishShortFormTells('a clean launch — for teams.', {
    documentType: 'default',
    register: 'casual',
  });
  assert.strictEqual(result.eligible, false);
  assert.strictEqual(result.emDash.severity, 0);
});

test('the default document type is inert (no false positive on general short text)', () => {
  const r = detectEnglishShortFormTells('built it for exactly that — kept the meaning.', {
    documentType: 'default',
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
    documentType: 'social',
  });
  assert.strictEqual(r.eligible, false);
  assert.strictEqual(r.emDash.severity, 0);
});

test('size limits gate the branch (chars and sentence count)', () => {
  const longText = 'word — '.repeat(60); // > 200 non-whitespace chars
  const tooLong = detectEnglishShortFormTells(longText, { documentType: 'social' });
  assert.ok(tooLong.nonWhitespaceChars > DEFAULT_SHORT_FORM_LIMITS.maxNonWhitespaceChars);
  assert.strictEqual(tooLong.eligible, false);
  assert.strictEqual(tooLong.emDash.severity, 0);

  const manySentences = detectEnglishShortFormTells(
    'One — a. Two — b. Three — c. Four — d. Five — e.',
    { documentType: 'social' }
  );
  assert.ok(manySentences.sentenceCount > DEFAULT_SHORT_FORM_LIMITS.maxProseSentences);
  assert.strictEqual(manySentences.eligible, false);
  assert.strictEqual(manySentences.emDash.severity, 0);
});

test('quoted dialogue and code dashes are excluded from the count', () => {
  const quoted = detectEnglishShortFormTells('she said "wait — stop" and left.', {
    documentType: 'social',
  });
  assert.strictEqual(quoted.emDash.count, 0);
  assert.strictEqual(quoted.emDash.severity, 0);

  const inlineCode = detectEnglishShortFormTells('run `a — b` right now.', { documentType: 'social' });
  assert.strictEqual(inlineCode.emDash.count, 0);

  const fenced = detectEnglishShortFormTells('see:\n```\nx — y\n```\ndone.', { documentType: 'social' });
  assert.strictEqual(fenced.emDash.count, 0);
});

test('detector never throws on empty or nullish input', () => {
  for (const input of ['', null, undefined]) {
    const r = detectEnglishShortFormTells(input, { documentType: 'social' });
    assert.strictEqual(r.emDash.count, 0);
    assert.strictEqual(r.emDash.severity, 0);
    assert.strictEqual(r.emDash.perSentence, 0);
  }
});

// ---------- 2026 cadence combination signal (#879, parent #878) ----------
//
// Audit/score-visible only: the issue requires an EN 25-hot/25-cold fixture set
// before any fire condition is tightened or promoted into rewrite, so these
// assert the emitted signal, never a rewrite behavior change.

// Four sentences: the existing eligibility window is maxProseSentences = 4, so a
// cadence stack has to fit inside it rather than the window being widened.
const CADENCE_STACK = [
  'I notice the tells.',
  'Short punchy sentences.',
  'Constant set groups.',
  'Those dashes — unnecessary little asides.',
].join(' ');

const LONE_DASH = 'The migration shipped on Tuesday — finally, after three weekends of work.';

const RANGE_DASH = 'Revenue grew across 2020—2024 and the team doubled in that window.';

const LITERARY_DASH = 'She paused. "I never said that — you did," he answered, and the room went quiet.';

test('cadence combination fires on a short stack with set groups and an empty aside', () => {
  const result = detectEnglishShortFormTells(CADENCE_STACK, { documentType: 'social' });
  assert.equal(result.cadence.detected, true);
  assert.ok(result.cadence.signals.length >= 2, 'combination needs 2+ co-occurring signals, got ' + JSON.stringify(result.cadence.signals));
});

test('the combination signal outranks a single em dash', () => {
  const combo = detectEnglishShortFormTells(CADENCE_STACK, { documentType: 'social' });
  const single = detectEnglishShortFormTells(LONE_DASH, { documentType: 'social' });
  assert.equal(single.emDash.severity, 1, 'a lone dash stays a weak signal');
  assert.equal(single.cadence.detected, false, 'one dash alone is not a cadence tell');
  assert.ok(combo.cadence.severity > single.emDash.severity,
    `combination (${combo.cadence.severity}) must outrank a lone dash (${single.emDash.severity})`);
});

test('numeric range dashes stay cold', () => {
  const result = detectEnglishShortFormTells(RANGE_DASH, { documentType: 'social' });
  assert.equal(result.emDash.count, 0, 'a 2020—2024 range is not a prose aside');
  assert.equal(result.cadence.detected, false);
});

test('literary dashes in quoted speech stay cold', () => {
  const result = detectEnglishShortFormTells(LITERARY_DASH, { documentType: 'social' });
  assert.equal(result.emDash.count, 0);
  assert.equal(result.cadence.detected, false);
});

test('short-form phrases fire on their own', () => {
  for (const text of ['Ship the thing that matters.', "You don't have a strategy. You have a vibe."]) {
    const result = detectEnglishShortFormTells(text, { documentType: 'social' });
    assert.equal(result.cadence.detected, true, text);
  }
});

test('cadence stays inert outside short-form document types', () => {
  const result = detectEnglishShortFormTells(CADENCE_STACK, { documentType: 'blog' });
  assert.equal(result.eligible, false);
  assert.equal(result.cadence.detected, false, 'ineligible input must not emit a cadence tell');
});

test('ordinary varied prose does not fire', () => {
  const text = 'We moved the bindings into version control in April, which took the better part of a week, and the smoke check has caught two bad configs since then.';
  const result = detectEnglishShortFormTells(text, { documentType: 'social' });
  assert.equal(result.cadence.detected, false);
});
