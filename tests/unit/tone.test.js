import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { resolveTone } from '../../src/config.js';
import { toneToBackboneProfile } from '../../src/loader.js';
import { formatOutput } from '../../src/output.js';

// --- resolveTone ---

test('resolveTone: CLI tone wins over config tone', () => {
  const r = resolveTone({ cliTone: 'casual', configTone: 'academic', lang: 'ko' });
  assert.equal(r.tone, 'casual');
  assert.equal(r.tone_source, 'user');
});

test('resolveTone: config tone used when CLI tone absent', () => {
  const r = resolveTone({ cliTone: undefined, configTone: 'professional', lang: 'en' });
  assert.equal(r.tone, 'professional');
  assert.equal(r.tone_source, 'user');
});

test('resolveTone: no tone → profile_only', () => {
  const r = resolveTone({ cliTone: undefined, configTone: undefined, lang: 'ko' });
  assert.equal(r.tone, null);
  assert.equal(r.tone_source, 'profile_only');
});

test('resolveTone: empty string configTone → profile_only', () => {
  const r = resolveTone({ cliTone: undefined, configTone: '', lang: 'ko' });
  assert.equal(r.tone, null);
  assert.equal(r.tone_source, 'profile_only');
});

test('resolveTone: auto → tone_source auto', () => {
  const r = resolveTone({ cliTone: 'auto', configTone: undefined, lang: 'ko' });
  assert.equal(r.tone, 'auto');
  assert.equal(r.tone_source, 'auto');
});

test('resolveTone: zh + named tone → unsupported_language_fallback', () => {
  const r = resolveTone({ cliTone: 'casual', configTone: undefined, lang: 'zh' });
  assert.equal(r.tone, null);
  assert.equal(r.tone_source, 'unsupported_language_fallback');
  assert.ok(r.warning);
});

test('resolveTone: ja + auto → unsupported_language_fallback', () => {
  const r = resolveTone({ cliTone: 'auto', configTone: undefined, lang: 'ja' });
  assert.equal(r.tone, null);
  assert.equal(r.tone_source, 'unsupported_language_fallback');
  assert.ok(r.warning.includes('auto-detection'));
});

test('resolveTone: invalid cliTone throws', () => {
  assert.throws(
    () => resolveTone({ cliTone: 'bogus', lang: 'ko' }),
    /Unknown tone 'bogus'/
  );
});

test('resolveTone: invalid configTone throws', () => {
  assert.throws(
    () => resolveTone({ cliTone: undefined, configTone: 'nope', lang: 'ko' }),
    /Invalid tone 'nope' in config/
  );
});

test('resolveTone: all 6 named tones accepted', () => {
  for (const t of ['casual', 'professional', 'academic', 'narrative', 'marketing', 'instructional']) {
    const r = resolveTone({ cliTone: t, lang: 'en' });
    assert.equal(r.tone, t);
    assert.equal(r.tone_source, 'user');
    assert.equal(r.tone_confidence, 'high');
  }
});

// --- toneToBackboneProfile ---

test('toneToBackboneProfile: maps known tones to backbone profiles', () => {
  assert.equal(toneToBackboneProfile('casual'), 'blog');
  assert.equal(toneToBackboneProfile('professional'), 'email');
  assert.equal(toneToBackboneProfile('academic'), 'academic');
  assert.equal(toneToBackboneProfile('narrative'), 'narrative');
  assert.equal(toneToBackboneProfile('marketing'), 'marketing');
  assert.equal(toneToBackboneProfile('instructional'), 'instructional');
});

test('toneToBackboneProfile: unknown tone returns null', () => {
  assert.equal(toneToBackboneProfile('auto'), null);
  assert.equal(toneToBackboneProfile('unknown'), null);
});

// --- formatOutput tone footer ---

test('formatOutput: appends YAML tone footer', () => {
  const tone = { tone: 'casual', tone_source: 'user', tone_evidence: ['user-specified'], tone_confidence: 'high' };
  const out = formatOutput('Hello world', 'rewrite', {}, { tone });
  assert.ok(out.includes('tone: casual'));
  assert.ok(out.includes('tone_source: user'));
  assert.ok(out.includes('tone_confidence: high'));
});

test('formatOutput: no tone → no footer', () => {
  const out = formatOutput('Hello world', 'rewrite', {});
  assert.equal(out, 'Hello world');
});

test('formatOutput: colorizes labeled diff output on TTY', () => {
  const out = formatOutput(
    'Pattern: 1. Generic polish\nRemoved: old phrasing\nAdded: sharper phrasing',
    'diff',
    {},
    { env: {}, stdout: { isTTY: true } }
  );

  assert.ok(out.includes('\x1b[1mPattern: 1. Generic polish\x1b[0m'));
  assert.ok(out.includes('\x1b[31mRemoved: old phrasing\x1b[0m'));
  assert.ok(out.includes('\x1b[32mAdded: sharper phrasing\x1b[0m'));
});

test('formatOutput: disables diff colors for NO_COLOR, --no-color, and non-TTY', () => {
  const raw = 'Pattern: 1. Generic polish\nRemoved: old phrasing\nAdded: sharper phrasing';

  assert.equal(formatOutput(raw, 'diff', {}, { env: { NO_COLOR: '1' }, stdout: { isTTY: true } }), raw);
  assert.equal(formatOutput(raw, 'diff', { noColor: true }, { env: {}, stdout: { isTTY: true } }), raw);
  assert.equal(formatOutput(raw, 'diff', {}, { env: {}, stdout: { isTTY: false } }), raw);
});

test('formatOutput: does not colorize non-diff modes', () => {
  const raw = 'Pattern: 1. Generic polish\nRemoved: old phrasing\nAdded: sharper phrasing';
  const out = formatOutput(raw, 'audit', {}, { env: {}, stdout: { isTTY: true } });
  assert.equal(out, raw);
});

test('formatOutput: does not duplicate complete footer', () => {
  const existing = 'Body text\n---\ntone: casual\ntone_source: user\ntone_evidence: []\ntone_confidence: high\n---';
  const tone = { tone: 'casual', tone_source: 'user', tone_evidence: [], tone_confidence: 'high' };
  const out = formatOutput(existing, 'rewrite', {}, { tone });
  const count = (out.match(/tone_source:/g) || []).length;
  assert.equal(count, 1);
});

test('formatOutput: detects tone footer inside fenced output', () => {
  const existing = 'Body text\n```yaml\n---\ntone: casual\ntone_source: user\ntone_evidence: []\ntone_confidence: high\n---\n```';
  const tone = { tone: 'casual', tone_source: 'user', tone_evidence: [], tone_confidence: 'high' };
  const out = formatOutput(existing, 'rewrite', {}, { tone });
  const count = (out.match(/tone_source:/g) || []).length;
  assert.equal(count, 1);
});

test('formatOutput: detects tone footer inside blockquote output', () => {
  const existing = 'Body text\n> ---\n> tone: casual\n> tone_source: user\n> tone_evidence: []\n> tone_confidence: high\n> ---';
  const tone = { tone: 'casual', tone_source: 'user', tone_evidence: [], tone_confidence: 'high' };
  const out = formatOutput(existing, 'rewrite', {}, { tone });
  const count = (out.match(/tone_source:/g) || []).length;
  assert.equal(count, 1);
});

test('formatOutput: appends footer when partial footer present (missing keys)', () => {
  const partial = 'Body text\n---\ntone: casual\n---';
  const tone = { tone: 'casual', tone_source: 'user', tone_evidence: [], tone_confidence: 'high' };
  const out = formatOutput(partial, 'rewrite', {}, { tone });
  const count = (out.match(/tone_source:/g) || []).length;
  assert.equal(count, 1);
});

test('formatOutput: null tone emits null values', () => {
  const tone = { tone: null, tone_source: 'profile_only', tone_evidence: [], tone_confidence: null };
  const out = formatOutput('Text', 'rewrite', {}, { tone });
  assert.ok(out.includes('tone: null'));
  assert.ok(out.includes('tone_confidence: null'));
});

test('formatOutput: text format omits YAML footer', () => {
  const tone = { tone: null, tone_source: 'profile_only', tone_evidence: [], tone_confidence: null };
  const out = formatOutput('Text', 'rewrite', { format: 'text' }, { tone });
  assert.equal(out, 'Text\n\nTone: profile-only (profile_only)');
});

test('formatOutput: json format exposes score contract fields', () => {
  const tone = { tone: null, tone_source: 'profile_only', tone_evidence: [], tone_confidence: null };
  const out = formatOutput({
    raw: '{ "overall": 18, "categories": { "style": { "score": 9 } } }',
    overall: 21,
    llmScore: { overall: 18 },
    deterministicScore: { overall: 21, bands: { burstiness: { low: 1 } } },
  }, 'score', {
    format: 'json',
    gate: 30,
  }, { tone });
  const parsed = JSON.parse(out);
  assert.equal(parsed.overall, 21);
  assert.equal(parsed.categories[0].name, 'style');
  assert.deepEqual(parsed.gateResult, { threshold: 30, overall: 21, passed: true, exitCode: 0 });
  assert.equal(parsed.scores.llm.overall, 18);
  assert.equal(parsed.scores.deterministic.overall, 21);
  assert.equal(parsed.tone.tone_source, 'profile_only');
});

// --- stripSelfAudit (v3.11) ---

test('stripSelfAudit: extracts [BODY] block and drops [SELF_AUDIT]', () => {
  const raw = '[BODY]\nHello world\n[/BODY]\n\n[SELF_AUDIT]\n- residual signal: foo\n[/SELF_AUDIT]';
  const out = formatOutput(raw, 'rewrite', {});
  assert.equal(out, 'Hello world');
});

test('stripSelfAudit: keeps YAML footer that follows [/BODY]', () => {
  const raw = '[BODY]\nHello world\n[/BODY]\n\n[SELF_AUDIT]\nstuff\n[/SELF_AUDIT]\n\n---\ntone: null\ntone_source: profile_only\ntone_evidence: []\ntone_confidence: null\n---';
  const out = formatOutput(raw, 'rewrite', {});
  assert.ok(out.startsWith('Hello world'));
  assert.ok(out.includes('tone_source: profile_only'));
  assert.ok(!out.includes('residual'));
});

test('stripSelfAudit: passes through unchanged when no tags emitted', () => {
  const raw = 'Plain rewrite text without tags.';
  const out = formatOutput(raw, 'rewrite', {});
  assert.equal(out, 'Plain rewrite text without tags.');
});

test('stripSelfAudit: missing [BODY] strips audit and warns', () => {
  const raw = 'Clean text\n\n[SELF_AUDIT]\ninternal notes\n[/SELF_AUDIT]';
  const originalError = console.error;
  const logs = [];
  console.error = (msg) => logs.push(String(msg));
  try {
    const out = formatOutput(raw, 'rewrite', {});
    assert.equal(out, 'Clean text');
  } finally {
    console.error = originalError;
  }
  assert.equal(logs.length, 1);
  assert.match(logs[0], /omitted \[BODY\] tags/);
  assert.match(logs[0], /--prompt-mode strict/);
});

test('stripSelfAudit: only applied to rewrite/ouroboros modes', () => {
  const raw = '[BODY]\nclean\n[/BODY]\n[SELF_AUDIT]\nleak\n[/SELF_AUDIT]';
  const audit = formatOutput(raw, 'audit', {});
  // Audit mode should not strip — tags should round-trip as-is.
  assert.ok(audit.includes('[BODY]'));
  assert.ok(audit.includes('[SELF_AUDIT]'));
});

// --- resolvePromptMode (v3.11 Phase 3.3) ---

import { resolveConfiguredPromptMode, resolvePromptMode } from '../../src/cli.js';
import { validateScoreWeights } from '../../src/output.js';

test('resolvePromptMode: strict passes through unchanged', () => {
  assert.equal(resolvePromptMode('strict', { backend: 'codex-cli' }), 'strict');
  assert.equal(resolvePromptMode('strict', { backend: 'gemini' }), 'strict');
});

test('resolvePromptMode: minimal passes through unchanged', () => {
  assert.equal(resolvePromptMode('minimal', { backend: 'codex-cli' }), 'minimal');
});

test('resolvePromptMode: auto + gemini backend → minimal', () => {
  assert.equal(resolvePromptMode('auto', { backend: 'gemini' }), 'minimal');
  assert.equal(resolvePromptMode('auto', { backend: '', model: 'gemini-3-flash-preview' }), 'minimal');
});

test('resolvePromptMode: auto + claude model → strict', () => {
  assert.equal(resolvePromptMode('auto', { backend: '', model: 'claude-sonnet-4-6' }), 'strict');
});

test('resolvePromptMode: auto + codex-cli → strict (default)', () => {
  assert.equal(resolvePromptMode('auto', { backend: 'codex-cli' }), 'strict');
});

test('resolvePromptMode: auto + unknown → strict (conservative)', () => {
  assert.equal(resolvePromptMode('auto', { backend: 'openai-http', model: 'gpt-5.5' }), 'strict');
  assert.equal(resolvePromptMode('auto', {}), 'strict');
});

test('resolveConfiguredPromptMode: MAX defaults to minimal unless overridden', () => {
  assert.equal(resolveConfiguredPromptMode({ isMaxMode: true }), 'minimal');
  assert.equal(resolveConfiguredPromptMode({ isMaxMode: false }), 'strict');
  assert.equal(resolveConfiguredPromptMode({ configPromptMode: 'strict', isMaxMode: true }), 'strict');
  assert.equal(resolveConfiguredPromptMode({ cliPromptMode: 'auto', configPromptMode: 'strict', isMaxMode: true }), 'auto');
});

// --- validateScoreWeights (v3.11 Phase 1.3) ---

test('validateScoreWeights: matches → no warnings', () => {
  const output = `| Category | Weight | Detected | Raw | Weighted |
|----------|--------|----------|-----|----------|
| content | 0.18 | none | 0.0 | 0.0 |
| language | 0.18 | none | 0.0 | 0.0 |`;
  const warnings = validateScoreWeights(output, { content: 0.18, language: 0.18 });
  assert.deepEqual(warnings, []);
});

test('validateScoreWeights: mismatch → warning lists expected vs actual', () => {
  const output = `| content | 0.13 | none | 0.0 | 0.0 |`;
  const warnings = validateScoreWeights(output, { content: 0.18 });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /expected 0\.18.*0\.13/);
});

test('validateScoreWeights: unexpected category → hallucination warning', () => {
  const output = `| content | 0.18 | none | 0.0 | 0.0 |
| discord | 0.20 | none | 0.0 | 0.0 |`;
  const warnings = validateScoreWeights(output, { content: 0.18 });
  const hallucination = warnings.find((w) => w.includes('discord') && w.includes('hallucination'));
  assert.ok(hallucination, 'should flag discord as hallucinated');
});

test('validateScoreWeights: missing category → warning', () => {
  const warnings = validateScoreWeights('| content | 0.18 |', { content: 0.18, language: 0.18 });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /language.*missing/);
});

test('validateScoreWeights: localized ko category labels map to config keys', () => {
  const output = `| 카테고리 | 가중치 |
|---|---:|
| 내용 | 0.18 |
| 언어 | 0.18 |
| 문체 | 0.18 |
| 커뮤니케이션 | 0.13 |
| 채움 | 0.08 |
| 구조 | 0.15 |
| 바이럴 훅 | 0.10 |`;
  const warnings = validateScoreWeights(output, {
    content: 0.18,
    language: 0.18,
    style: 0.18,
    communication: 0.13,
    filler: 0.08,
    structure: 0.15,
    'viral-hook': 0.10,
  });
  assert.deepEqual(warnings, []);
});

test('validateScoreWeights: localized zh/ja labels map to config keys', () => {
  const zh = `| 内容 | 0.18 |
| 语言 | 0.18 |
| 风格 | 0.18 |
| 沟通 | 0.13 |
| 填充 | 0.08 |
| 结构 | 0.15 |`;
  assert.deepEqual(validateScoreWeights(zh, {
    content: 0.18,
    language: 0.18,
    style: 0.18,
    communication: 0.13,
    filler: 0.08,
    structure: 0.15,
  }), []);

  const ja = `| 内容 | 0.18 |
| 言語 | 0.18 |
| 文体 | 0.18 |
| コミュニケーション | 0.13 |
| フィラー | 0.08 |
| 構造 | 0.15 |`;
  assert.deepEqual(validateScoreWeights(ja, {
    content: 0.18,
    language: 0.18,
    style: 0.18,
    communication: 0.13,
    filler: 0.08,
    structure: 0.15,
  }), []);
});

test('validateScoreWeights: empty config → no-op', () => {
  assert.deepEqual(validateScoreWeights('any output', {}), []);
  assert.deepEqual(validateScoreWeights('', { content: 0.18 }), []);
});

// --- variants (v3.11 Phase 3.1) ---

import { extractVariants } from '../../src/output.js';

test('extractVariants: parses [VARIANT n] blocks in order', () => {
  const raw = '[VARIANT 1]\nfirst\n[/VARIANT]\n\n[VARIANT 2]\nsecond\n[/VARIANT]';
  const out = extractVariants(raw);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { id: 1, text: 'first' });
  assert.deepEqual(out[1], { id: 2, text: 'second' });
});

test('extractVariants: returns empty when no tags', () => {
  assert.deepEqual(extractVariants('plain rewrite'), []);
  assert.deepEqual(extractVariants('[BODY]\nsingle\n[/BODY]'), []);
});

test('extractVariants: sorts by id even if emitted out of order', () => {
  const raw = '[VARIANT 3]\nthird\n[/VARIANT]\n[VARIANT 1]\nfirst\n[/VARIANT]\n[VARIANT 2]\nsecond\n[/VARIANT]';
  const out = extractVariants(raw);
  assert.deepEqual(out.map((v) => v.id), [1, 2, 3]);
});

test('formatOutput: renders variants as labeled headings', () => {
  const raw = '[VARIANT 1]\nfirst voice\n[/VARIANT]\n\n[VARIANT 2]\nsecond voice\n[/VARIANT]\n\n[SELF_AUDIT]\nstuff\n[/SELF_AUDIT]';
  const out = formatOutput(raw, 'rewrite', {});
  assert.match(out, /## Variant 1/);
  assert.match(out, /first voice/);
  assert.match(out, /## Variant 2/);
  assert.match(out, /second voice/);
  assert.ok(!out.includes('[VARIANT'));
  assert.ok(!out.includes('SELF_AUDIT'));
});

// --- isShortText (v3.11 Phase 3.2) ---

import { isShortText } from '../../src/prompt-builder.js';

test('isShortText: empty/short → true', () => {
  assert.equal(isShortText(''), true);
  assert.equal(isShortText('a'), true);
  assert.equal(isShortText('짧은 글입니다.'), true);
});

test('isShortText: ≤200 non-whitespace chars → true', () => {
  // 199 chars of 'a' + spaces — non-whitespace count ≤ 200
  assert.equal(isShortText('a'.repeat(199)), true);
  assert.equal(isShortText('a'.repeat(200)), true);
});

test('isShortText: >200 chars but ≤3 paragraphs → true', () => {
  const para = 'a'.repeat(80);
  const text = `${para}\n\n${para}\n\n${para}`; // 3 paragraphs, 240 chars
  assert.equal(isShortText(text), true);
});

test('isShortText: >200 chars AND ≥4 paragraphs → false', () => {
  const para = 'a'.repeat(80);
  const text = `${para}\n\n${para}\n\n${para}\n\n${para}`;
  assert.equal(isShortText(text), false);
});
