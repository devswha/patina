// Regression tests for the #527 low-severity runtime fixes.
// H1/H2 covered the removed --preview snapshot pipeline and H11 the removed
// kimi-cli backend; H5 (floor max) is
// covered by the quality benchmark and is provably non-lowering; H3/H6/H7/H13
// are integration/spawn paths exercised elsewhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseFirstJson } from '../../src/output.js';
import { phraseToRegex } from '../../src/features/lexicon-core.js';
import { buildPrompt } from '../../src/prompt-builder.js';

// H10 — parseFirstJson finds the real object amid stray braces instead of a
// greedy first-{..last-} slice that JSON.parse rejects.
test('H10: parseFirstJson skips stray braces and parses the embedded object', () => {
  assert.deepEqual(parseFirstJson('result for {A}: {"overall": 7}'), { overall: 7 });
  assert.deepEqual(parseFirstJson('{"overall": 9} note: use {x} carefully'), { overall: 9 });
  assert.deepEqual(parseFirstJson('prefix {"a": 1} mid {x} end'), { a: 1 });
  assert.equal(parseFirstJson('no json here'), null);
});

// H12 — multi-wildcard custom-lexicon phrases no longer backtrack exponentially.
test('H12: phraseToRegex collapses consecutive wildcards and stays linear', () => {
  const re = phraseToRegex('~ ~ zzz');
  // Consecutive wildcards collapse to one bounded class — no adjacent
  // [\s\S]{0,40}\s+[\s\S]{0,40} that backtracks catastrophically.
  assert.equal((re.source.match(/\[\\s\\S\]\{0,40\}/g) || []).length, 1);
  const start = process.hrtime.bigint();
  re.test(' '.repeat(400)); // would hang (>6s) before the fix
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(ms < 200, `phraseToRegex match took ${ms.toFixed(0)}ms`);
  // Still matches its intent: a gap then the literal tail.
  assert.ok(phraseToRegex('~ zzz').test('anything here zzz'));
});

// H4 — minimal-mode rewrite carries an explicit Register directive.
test('H4: minimal prompt includes the explicit register directive', () => {
  const prompt = buildPrompt({
    config: { language: 'en', documentType: 'default' },
    patterns: [],
    documentType: null,
    voice: null,
    scoring: null,
    text: 'A short draft paragraph that needs a gentle humanizing rewrite pass.',
    mode: 'rewrite',
    promptMode: 'minimal',
    register: {
      register: 'professional',
      register_source: 'command',
      register_evidence: ['user-specified'],
      register_confidence: 'high',
    },
  });
  assert.match(prompt, /clear and professional/);
});
