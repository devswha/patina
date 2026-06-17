// Regression tests for the #527 low-severity runtime fixes.
// H2 is covered by tests/unit/preview.test.js (base-tag stripping); H5 (floor
// max) is covered by the quality benchmark and is provably non-lowering; H3/H6/
// H7/H13 are integration/spawn paths exercised elsewhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseFirstJson } from '../../src/output.js';
import { phraseToRegex } from '../../src/features/lexicon-core.js';
import { prepareSnapshotHtml, extractProseBlocks } from '../../src/preview.js';
import { buildPrompt } from '../../src/prompt-builder.js';
import * as kimi from '../../src/backends/kimi-cli.js';

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

// H1 — out-of-range numeric HTML entities no longer crash entity decoding.
test('H1: out-of-range numeric entities do not throw in preview decoding', () => {
  assert.doesNotThrow(() =>
    prepareSnapshotHtml('<html><body><p>&#xFFFFFFFF; lorem ipsum dolor sit amet consectetur.</p></body></html>'));
  assert.doesNotThrow(() =>
    extractProseBlocks('<p>&#1114112; lorem ipsum dolor sit amet consectetur adipiscing.</p>'));
  // Valid numeric entities still decode (the guard must not break normal cases).
  const { blocks } = extractProseBlocks('<p>A&#66;C lorem ipsum dolor sit amet consectetur adipiscing elit.</p>');
  assert.ok(blocks.some((b) => (b.text || '').includes('ABC')));
});

// H4 — minimal-mode rewrite with --tone auto includes the detection instruction.
test('H4: minimal prompt with tone auto includes the auto-detection instruction', () => {
  const prompt = buildPrompt({
    config: { language: 'en' },
    patterns: [],
    profile: null,
    voice: null,
    scoring: null,
    text: 'A short draft paragraph that needs a gentle humanizing rewrite pass.',
    mode: 'rewrite',
    promptMode: 'minimal',
    tone: { tone: null, tone_source: 'auto', tone_evidence: [], tone_confidence: null },
  });
  assert.ok(/infer a single tone/i.test(prompt), 'minimal auto prompt must instruct tone detection');
});

// H11 — a whitespace-only env key no longer mis-advertises kimi as authenticated.
test('H11: kimi env-key auth rejects a whitespace-only key', () => {
  const saved = {
    KIMI_API_KEY: process.env.KIMI_API_KEY,
    MOONSHOT_API_KEY: process.env.MOONSHOT_API_KEY,
    KIMI_SHARE_DIR: process.env.KIMI_SHARE_DIR,
  };
  try {
    process.env.KIMI_SHARE_DIR = '/nonexistent-patina-kimi-test-dir';
    delete process.env.MOONSHOT_API_KEY;
    process.env.KIMI_API_KEY = '   \t ';
    assert.equal(kimi.isAuthenticated(), false);
    assert.ok(!kimi.authHint().startsWith('Authenticated'));
    process.env.KIMI_API_KEY = 'sk-real-key';
    assert.equal(kimi.isAuthenticated(), true);
    assert.ok(kimi.authHint().startsWith('Authenticated'));
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
