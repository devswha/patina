import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { resolveRegister } from '../../src/config.js';
import { cleanRewriteOutput, formatOutput } from '../../src/output.js';

// --- resolveRegister ---

test('resolveRegister: CLI register wins over config register', () => {
  const result = resolveRegister({ cliRegister: 'casual', configRegister: 'professional' });
  assert.deepEqual(result, {
    register: 'casual',
    register_source: 'command',
    register_evidence: ['user-specified'],
    register_confidence: 'high',
  });
});

test('resolveRegister: config register is used when CLI register is absent', () => {
  const result = resolveRegister({ configRegister: 'professional' });
  assert.equal(result.register, 'professional');
  assert.equal(result.register_source, 'config');
});

test('resolveRegister: omission and an empty config preserve the source register', () => {
  assert.equal(resolveRegister({}), null);
  assert.equal(resolveRegister({ configRegister: '' }), null);
});

test('resolveRegister: casual and professional work for every supported language', () => {
  for (const register of ['casual', 'professional']) {
    for (const lang of ['ko', 'en', 'zh', 'ja']) {
      assert.equal(resolveRegister({ cliRegister: register, lang }).register, register);
    }
  }
});

test('resolveRegister: auto, genre values, and unknown values fail closed', () => {
  for (const register of ['auto', 'academic', 'narrative', 'marketing', 'bogus']) {
    assert.throws(
      () => resolveRegister({ cliRegister: register }),
      new RegExp(`unknown register '${register}'`),
    );
  }
  assert.throws(
    () => resolveRegister({ configRegister: 'nope' }),
    /invalid register 'nope' in config/,
  );
});

test('formatOutput: rewrite keeps register metadata out of default stdout', () => {
  const register = {
    register: 'casual',
    register_source: 'command',
    register_evidence: ['user-specified'],
    register_confidence: 'high',
  };
  assert.equal(formatOutput('Hello world', 'rewrite', {}, { register }), 'Hello world');
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

test('formatOutput: does not embed ANSI in --diff --format json on a TTY (#449)', () => {
  const raw = 'Pattern: 1. Generic polish\nRemoved: old phrasing\nAdded: sharper phrasing';
  const out = formatOutput(raw, 'diff', { format: 'json' }, { env: {}, stdout: { isTTY: true } });
  // The JSON payload's `output` field must carry the plain diff, no escape codes.
  assert.equal(out.includes('\x1b['), false);
  assert.equal(JSON.parse(out).output, raw);
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

test('formatOutput: only rewrite mode strips [BODY]; other modes pass text through (#523)', () => {
  const report = [
    '## Report',
    '',
    'A tutorial: wrap output in [BODY] your prose [/BODY] tags so patina parses it.',
  ].join('\n');

  const out = formatOutput(report, 'audit', {});
  assert.ok(out.includes('## Report'));
  assert.ok(out.includes('A tutorial: wrap output in [BODY] your prose [/BODY] tags'));
});

test('formatOutput: rewrite strips register metadata blocks', () => {
  const registerFooter = 'Body text\n---\nregister: casual\nregister_source: command\nregister_evidence: []\nregister_confidence: high\n---';
  assert.equal(formatOutput(registerFooter, 'rewrite', {}), 'Body text');
});

test('formatOutput: rewrite strips blockquoted register metadata', () => {
  const quoted = 'Body text\n> ---\n> register: professional\n> register_source: command\n> register_evidence: ["user-specified"]\n> register_confidence: high\n> ---';
  assert.equal(formatOutput(quoted, 'rewrite', {}), 'Body text');
});

test('formatOutput: JSON exposes register metadata outside rewritten prose', () => {
  const register = {
    register: 'professional',
    register_source: 'config',
    register_evidence: ['user-specified'],
    register_confidence: 'high',
  };
  const output = JSON.parse(formatOutput('[BODY]Hello world[/BODY]', 'rewrite', { format: 'json' }, { register }));
  assert.equal(output.output, 'Hello world');
  assert.deepEqual(output.register, register);
  assert.equal(output.output.includes('register:'), false);
});

test('formatOutput: JSON score contract retains score fields and register metadata', () => {
  const register = {
    register: 'casual',
    register_source: 'command',
    register_evidence: ['user-specified'],
    register_confidence: 'high',
  };
  const out = formatOutput({
    raw: '{ "overall": 18, "categories": { "style": { "score": 9 } } }',
    overall: 21,
    llmScore: { overall: 18 },
    deterministicScore: { overall: 21, bands: { burstiness: { low: 1 } } },
  }, 'score', {
    format: 'json',
    gate: 30,
  }, { register });
  const parsed = JSON.parse(out);
  assert.equal(parsed.overall, 21);
  assert.equal(parsed.categories[0].name, 'style');
  assert.deepEqual(parsed.gateResult, { threshold: 30, overall: 21, passed: true, exitCode: 0 });
  assert.equal(parsed.scores.llm.overall, 18);
  assert.equal(parsed.scores.deterministic.overall, 21);
  assert.equal(parsed.register.register_source, 'command');
});

// --- stripSelfAudit ---

test('cleanRewriteOutput strips self-audit blocks and the register footer', () => {
  const raw = [
    '[BODY]',
    'Human result.',
    '[/BODY]',
    '',
    '[SELF_AUDIT]',
    '- note',
    '[/SELF_AUDIT]',
    '',
    '---',
    'register: professional',
    'register_source: command',
    'register_evidence: ["user-specified"]',
    'register_confidence: high',
    '---',
  ].join('\n');
  assert.strictEqual(cleanRewriteOutput(raw), 'Human result.');
});

test('stripSelfAudit: extracts [BODY] block and drops [SELF_AUDIT]', () => {
  const raw = '[BODY]\nHello world\n[/BODY]\n\n[SELF_AUDIT]\n- residual signal: foo\n[/SELF_AUDIT]';
  const out = formatOutput(raw, 'rewrite', {});
  assert.equal(out, 'Hello world');
});

test('stripSelfAudit: removes nested SELF_AUDIT blocks inside BODY', () => {
  const raw = '[BODY]\nHello\n[SELF_AUDIT]\ninternal\n[/SELF_AUDIT]\nworld\n[/BODY]';
  const out = formatOutput(raw, 'rewrite', {});
  assert.equal(out, 'Hello\n\nworld');
});

test('stripSelfAudit: removes a register footer that follows [/BODY]', () => {
  const raw = '[BODY]\nHello world\n[/BODY]\n\n[SELF_AUDIT]\nstuff\n[/SELF_AUDIT]\n\n---\nregister: professional\nregister_source: command\nregister_evidence: []\nregister_confidence: high\n---';
  const out = formatOutput(raw, 'rewrite', {});
  assert.equal(out, 'Hello world');
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
  assert.match(logs[0], /Try a different backend/);
});

test('stripSelfAudit: only applied to raw rewrite output', () => {
  const raw = '[BODY]\nclean\n[/BODY]\n[SELF_AUDIT]\nleak\n[/SELF_AUDIT]';
  const audit = formatOutput(raw, 'audit', {});
  // Audit mode should not strip — tags should round-trip as-is.
  assert.ok(audit.includes('[BODY]'));
  assert.ok(audit.includes('[SELF_AUDIT]'));
});

// --- validateScoreWeights ---
import { validateScoreWeights } from '../../src/output.js';

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


// --- isShortText ---

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
