import test from 'node:test';
import assert from 'node:assert';

import { parseArgs, validateRegisterRequest } from '../../src/cli/args.js';
import { buildPrompt, buildTerminologyConstraint } from '../../src/prompt-builder.js';

const BASE = {
  config: { language: 'en', documentType: 'default' },
  patterns: [],
  documentType: null,
  voice: null,
  scoring: null,
  text: 'Sample body text for prompt construction.',
};

test('parseArgs treats the retired --restyle and --jargon options as unknown', () => {
  assert.throws(() => parseArgs(['--restyle', 'voice', 'draft.md']), /unknown option --restyle/);
  assert.throws(() => parseArgs(['--jargon', 'remove', 'draft.md']), /unknown option --jargon/);
  assert.throws(() => parseArgs(['--jargon=keep', 'draft.md']), /unknown option --jargon=keep/);
});

test('--register takes exactly one value', () => {
  assert.equal(parseArgs(['--register', 'casual']).register, 'casual');
  assert.equal(parseArgs(['--register', 'professional', 'draft.md']).register, 'professional');
  assert.throws(() => parseArgs(['--register', 'shouty']), /unknown register shouty/);
  // Comma lists were a --preview compare feature; the preview surface is gone.
  assert.throws(() => parseArgs(['--register', 'casual,professional']), /--register takes one value/);
  assert.throws(() => parseArgs(['--register', ' ']), /--register expects a value/);
});

test('validateRegisterRequest rejects non-rewrite modes only when a register is set', () => {
  validateRegisterRequest({ score: true });
  validateRegisterRequest({ register: 'casual' });
  assert.throws(() => validateRegisterRequest({ register: 'casual', score: true }), /--register cannot be combined with --score/);
  assert.throws(() => validateRegisterRequest({ register: 'professional', audit: true }), /--register cannot be combined with --audit/);
  assert.throws(() => validateRegisterRequest({ register: 'casual', diff: true }), /--register cannot be combined with --diff/);
});

test('rewrite prompts carry the fixed terminology constraint and no user directive', () => {
  const strict = buildPrompt({ ...BASE, mode: 'rewrite' });
  assert.ok(strict.includes('## Terminology constraint'));
  assert.ok(strict.includes('Copy Latin-letter tech terms'));
  assert.ok(strict.includes('classification'));
  assert.ok(strict.includes('Do not synonym-swap'));
  assert.ok(!strict.includes('Transformation Directive'));
  assert.ok(!strict.includes('--jargon'));

  // The constraint comes after the rewrite instructions and before the input.
  const at = strict.indexOf('## Terminology constraint');
  assert.ok(at > strict.indexOf('## Instructions'));
  assert.ok(at < strict.indexOf('## Input Text'));

  const minimal = buildPrompt({ ...BASE, mode: 'rewrite', promptMode: 'minimal' });
  assert.ok(minimal.includes('## Terminology constraint'));
  assert.ok(!minimal.includes('--jargon'));

  const ko = buildPrompt({
    ...BASE,
    config: { language: 'ko', documentType: 'default' },
    mode: 'rewrite',
    promptMode: 'minimal',
  });
  assert.ok(ko.includes('## 용어 유지'));
  assert.ok(ko.includes('라틴 문자'));
  assert.ok(!ko.includes('--jargon'));
});

test('non-rewrite strict prompts never carry the terminology constraint', () => {
  for (const mode of ['score', 'audit', 'diff']) {
    const prompt = buildPrompt({ ...BASE, mode });
    assert.ok(!prompt.includes('Terminology constraint'), `${mode} prompt must not carry the constraint`);
  }
});

test('rewrite prompt forbids invented lessons and heading-only essay fill', () => {
  const prompt = buildPrompt({ ...BASE, mode: 'rewrite' });
  assert.ok(prompt.includes('Do not invent why, evaluation, or a lesson'));
  assert.ok(prompt.includes('Keep heading-section shape'));
  assert.ok(prompt.includes('introduction–body–lesson'));
  assert.ok(!prompt.includes('NOT PROMOTED'));
  assert.ok(!prompt.includes('koDiagnosis'));

  const career = buildPrompt({
    ...BASE,
    config: { language: 'en', documentType: 'project-writeup' },
    mode: 'rewrite',
  });
  assert.ok(career.includes('problem→crisis→lesson'));
});

test('terminology constraint strings are explicit in both languages', () => {
  const en = buildTerminologyConstraint({ korean: false });
  const ko = buildTerminologyConstraint({ korean: true });
  assert.ok(en.includes('chest X-ray'));
  assert.ok(en.includes('CXR'));
  assert.ok(ko.includes('라틴 문자'));
  assert.ok(ko.includes('분류/분할/손실'));
  assert.ok(!en.includes('THIS DIRECTIVE WINS'));
  assert.ok(!en.includes('--jargon'));
  assert.ok(!ko.includes('--jargon'));
});
