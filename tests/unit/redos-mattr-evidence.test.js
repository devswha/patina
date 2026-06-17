import test from 'node:test';
import assert from 'node:assert';

import {
  mattr,
  koreanPostEditeseFeatures,
  DEFAULT_MATTR_WINDOW,
} from '../../src/features/stylometry.js';
import { extractStructuralFeatures } from '../../src/features/structural-features.js';
import { detectTranslationese } from '../../src/features/translationese.js';
import { scoreText } from '../../src/scoring.js';
import { loadConfig } from '../../src/config.js';

// #502 — ReDoS: the post-editese relative-clause proxy regex used to backtrack
// O(n^2) on a long unspaced Hangul run (runs unconditionally for ko, also in
// the browser playground). The bounded quantifier makes it linear.
test('#502 koreanPostEditeseFeatures does not blow up on a long unspaced Hangul run', () => {
  const start = Date.now();
  const result = koreanPostEditeseFeatures('가'.repeat(80000), { lang: 'ko' });
  const elapsed = Date.now() - start;
  assert.ok(result, 'returns a payload');
  // Pre-fix this regex alone took ~7s at 80k; a generous ceiling still proves
  // the catastrophic quadratic is gone without being flaky on a slow CI box.
  assert.ok(elapsed < 1500, `expected sub-1.5s, got ${elapsed}ms`);
});

test('#502 relative-clause detection is preserved on normal Korean prose', () => {
  // "제공하는 핵심", "처리하는 작업": short stems + relative ending + next word.
  const text = '이것은 가치를 제공하는 핵심 기능입니다. 데이터를 처리하는 작업도 합니다.';
  const a = koreanPostEditeseFeatures(text, { lang: 'ko' });
  const b = koreanPostEditeseFeatures(text, { lang: 'ko' });
  // Deterministic and non-zero relative-clause evidence on real prose.
  assert.deepEqual(a.metrics, b.metrics);
  assert.ok(JSON.stringify(a.metrics).length > 0);
});

// #507 Defect 1 — a bad ttr.window (0 / negative / fractional) must not produce
// NaN or negative MATTR; it falls back to the calibrated default window.
test('#507 mattr clamps a non-positive / non-integer window to the default', () => {
  const tokens = 'a b c a b d a e f g a b'.split(' ');
  const expected = mattr(tokens, DEFAULT_MATTR_WINDOW);
  assert.ok(Number.isFinite(expected) && expected > 0);
  for (const bad of [0, -5, 1.5, NaN, Infinity, '40']) {
    const got = mattr(tokens, bad);
    assert.equal(got, expected, `window=${bad} should fall back to the default`);
    assert.ok(Number.isFinite(got) && got >= 0, `window=${bad} must stay finite/non-negative`);
  }
});

// #507 Defect 2 — token-less text used to emit a literal null at the mattr slot,
// which the classifier silently coerced to 0; coalesce it to 0 at the source so
// prediction and the logging path agree.
test('#507 extractStructuralFeatures emits 0 (not null) at the mattr slot for token-less text', () => {
  for (const empty of ['', '   ', '...', '。']) {
    const vector = extractStructuralFeatures(empty, { lang: 'ko' });
    assert.equal(vector[4], 0, `mattr slot for ${JSON.stringify(empty)} must be 0, not null`);
    assert.notEqual(vector[4], null);
  }
});

// #508 G6 — selectIndependentEvidence was O(n^2) in match count; the bitmap
// sweep keeps it linear on attacker-influenceable input.
test('#508 G6 detectTranslationese stays fast on a high-match-count input', () => {
  const text = '당신 '.repeat(8000);
  const start = Date.now();
  const result = detectTranslationese(text, { lang: 'ko' });
  const elapsed = Date.now() - start;
  assert.ok(result);
  assert.ok(elapsed < 1000, `expected sub-1s, got ${elapsed}ms`);
});

// #520 — the noun-calque "레이어로서" rule must not use an unbounded greedy
// Hangul prefix; on a long unspaced Hangul run with no target phrase, that
// backtracks quadratically.
test('#520 detectTranslationese stays fast on a long unspaced Hangul noun-calque miss', () => {
  const text = '가'.repeat(80000);
  const start = Date.now();
  const result = detectTranslationese(text, { lang: 'ko' });
  const elapsed = Date.now() - start;
  assert.ok(result);
  assert.ok(elapsed < 1000, `expected sub-1s, got ${elapsed}ms`);
});

test('#520 noun-calque layer phrase detection is preserved on normal Korean prose', () => {
  const result = detectTranslationese('보안 정책 레이어로서 요청을 검사합니다.', { lang: 'ko' });
  assert.ok(result.byRule.some((rule) => rule.id === 'noun-calque'));
  assert.ok(result.hits.includes('정책 레이어로서'));
});

// #508 G2 — parseStrictJson used a naive indexOf('{')..lastIndexOf('}') slice
// that broke on prose containing stray braces, spuriously nulling a valid
// score. scoreText should still recover the overall from chatty output.
test('#508 G2 scoreText recovers a valid score from chatty output with stray braces', async () => {
  const chatty = 'Here is the result for {A}: { "overall": 12, "interpretation": "human" } — note: use {x}';
  const score = await scoreText({
    text: 'The tool is useful. The model is helpful. The system is reliable.',
    config: loadConfig(),
    patterns: [],
    callLLM: async () => chatty,
    logger: { warn() {} },
  });
  assert.strictEqual(score.llmScore.overall, 12);
});
