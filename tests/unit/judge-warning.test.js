import test from 'node:test';
import assert from 'node:assert';

import {
  inferJudgeFamily,
  maybeWarnJudgeOverlap,
  normalizeModelFamily,
  shouldWarnJudgeOverlap,
} from '../../src/judge-warning.js';

test('normalizeModelFamily maps common model and vendor names', () => {
  assert.strictEqual(normalizeModelFamily('gpt-4o'), 'openai');
  assert.strictEqual(normalizeModelFamily('codex-mini'), 'openai');
  assert.strictEqual(normalizeModelFamily('Claude Opus'), 'claude');
  assert.strictEqual(normalizeModelFamily('google/gemini-pro'), 'gemini');
  assert.strictEqual(normalizeModelFamily('Meta-Llama-3.1'), 'llama');
  assert.strictEqual(normalizeModelFamily('unknown-model'), null);
});

test('inferJudgeFamily trusts explicit local CLI backends before model ids', () => {
  assert.strictEqual(inferJudgeFamily({ backendName: 'codex-cli', model: 'claude-4' }), 'openai');
  assert.strictEqual(inferJudgeFamily({ backendName: 'claude-cli' }), 'claude');
  assert.strictEqual(inferJudgeFamily({ backendName: 'gemini-cli' }), 'gemini');
  assert.strictEqual(inferJudgeFamily({ backendName: 'openai-http', model: 'gemini-1.5-flash' }), 'gemini');
});

test('shouldWarnJudgeOverlap only warns when both families match', () => {
  assert.deepStrictEqual(
    shouldWarnJudgeOverlap({ suspectedGenerator: 'gpt', backendName: 'openai-http', model: 'gpt-4o' }),
    { warn: true, generatorFamily: 'openai', judgeFamily: 'openai' }
  );
  assert.deepStrictEqual(
    shouldWarnJudgeOverlap({ suspectedGenerator: 'claude', backendName: 'openai-http', model: 'gpt-4o' }),
    { warn: false, generatorFamily: 'claude', judgeFamily: 'openai' }
  );
  assert.deepStrictEqual(
    shouldWarnJudgeOverlap({ suspectedGenerator: 'unknown', backendName: 'openai-http', model: 'gpt-4o' }),
    { warn: false, generatorFamily: null, judgeFamily: 'openai' }
  );
});

test('maybeWarnJudgeOverlap emits structured stderr warning fields', () => {
  const warnings = [];
  const result = maybeWarnJudgeOverlap({
    suspectedGenerator: 'gemini',
    backendName: 'gemini-cli',
    model: 'gemini-2.5-pro',
    providerName: 'gemini',
    logger: { warn: (event, fields) => warnings.push({ event, ...fields }) },
  });

  assert.strictEqual(result.warn, true);
  assert.strictEqual(warnings.length, 1);
  assert.strictEqual(warnings[0].event, 'score.judge_overlap_warning');
  assert.strictEqual(warnings[0].generator_family, 'gemini');
  assert.match(warnings[0].message, /not an independent judge/);
});
