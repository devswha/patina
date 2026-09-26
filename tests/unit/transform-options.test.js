import test from 'node:test';
import assert from 'node:assert';

import { parseArgs, validateTransformRequest } from '../../src/cli/args.js';
import { buildPrompt, buildTransformDirective } from '../../src/prompt-builder.js';

const BASE = {
  config: { language: 'en', documentType: 'default' },
  patterns: [],
  documentType: null,
  voice: null,
  scoring: null,
  text: 'Sample body text for prompt construction.',
};

test('parseArgs treats --restyle as an unknown option and still parses --jargon', () => {
  assert.throws(() => parseArgs(['--restyle', 'voice', 'draft.md']), /unknown option --restyle/);
  assert.throws(() => parseArgs(['--restyle', 'sentence']), /unknown option --restyle/);

  assert.equal(parseArgs(['--jargon', 'remove', 'draft.md']).jargon, 'remove');
  assert.equal(parseArgs(['--jargon', 'explain']).jargon, 'explain');
  assert.equal(parseArgs(['--jargon', 'keep']).jargon, 'keep');

  assert.throws(() => parseArgs(['--jargon', 'simplify']), /unknown jargon policy/);
  assert.throws(() => parseArgs(['--jargon']), /jargon/i);
});

test('validateTransformRequest rejects non-rewrite modes only when a transform is active', () => {
  // Defaults (or explicit defaults) pass with every mode.
  validateTransformRequest({ score: true });
  validateTransformRequest({ jargon: 'keep' });

  // Active transform + non-rewrite mode is an input error.
  assert.throws(() => validateTransformRequest({ jargon: 'remove', score: true }), /--jargon cannot be combined with --score/);
  assert.throws(() => validateTransformRequest({ jargon: 'explain', audit: true }), /--jargon cannot be combined with --audit/);
  assert.throws(() => validateTransformRequest({ jargon: 'remove', diff: true }), /--jargon cannot be combined with --diff/);

  // Plain rewrite is the supported surface.
  validateTransformRequest({ jargon: 'remove' });
  validateTransformRequest({ jargon: 'explain', register: 'casual' });
});

test('strict rewrite prompt carries keep as a constraint and explain/remove as opt-in directives', () => {
  const base = buildPrompt({ ...BASE, mode: 'rewrite' });
  assert.ok(base.includes('Terminology constraint (--jargon keep)'));
  assert.ok(base.includes('Copy Latin-letter tech terms'));
  assert.ok(base.includes('classification'));
  assert.ok(base.includes('Do not synonym-swap'));
  assert.ok(!base.includes('Transformation Directive'));

  const explicitDefaults = buildPrompt({ ...BASE, mode: 'rewrite', jargon: 'keep' });
  assert.strictEqual(explicitDefaults, base);

  const remove = buildPrompt({ ...BASE, mode: 'rewrite', jargon: 'remove' });
  assert.ok(remove.includes('Transformation Directive'));
  assert.ok(remove.includes('Remove jargon (--jargon remove)'));
  assert.ok(!remove.includes('Gloss technical terms'));

  const explain = buildPrompt({ ...BASE, mode: 'rewrite', jargon: 'explain' });
  assert.ok(explain.includes('Gloss technical terms (--jargon explain)'));
  assert.ok(explain.includes('Keep Latin-letter technical terms as-is'));
  assert.ok(explain.includes('first mention'));
  assert.ok(!explain.includes('--restyle'));

  // The directive must come after the conservative rewrite instructions it
  // overrides, and before the input text.
  const directiveAt = remove.indexOf('Transformation Directive');
  assert.ok(directiveAt > remove.indexOf('## Instructions'));
  assert.ok(directiveAt < remove.indexOf('## Input Text'));
});

test('non-rewrite strict prompts never carry the directive even if options leak through', () => {
  for (const mode of ['score', 'audit', 'diff']) {
    const prompt = buildPrompt({ ...BASE, mode, jargon: 'remove' });
    assert.ok(!prompt.includes('Transformation Directive'), `${mode} prompt must not carry the directive`);
  }
});

test('minimal rewrite prompt carries a localized directive', () => {
  const ko = buildPrompt({
    ...BASE,
    config: { language: 'ko', documentType: 'default' },
    mode: 'rewrite',
    promptMode: 'minimal',
    jargon: 'remove',
  });
  assert.ok(ko.includes('변환 지시 (사용자 요청)'));
  assert.ok(ko.includes('개발 용어 제거 (--jargon remove)'));

  const en = buildPrompt({ ...BASE, mode: 'rewrite', promptMode: 'minimal', jargon: 'explain' });
  assert.ok(en.includes('Transformation Directive (user-requested)'));
  assert.ok(en.includes('Gloss technical terms (--jargon explain)'));

  const minimalDefault = buildPrompt({ ...BASE, mode: 'rewrite', promptMode: 'minimal' });
  assert.ok(!minimalDefault.includes('Transformation Directive'));
  assert.ok(minimalDefault.includes('Terminology constraint (--jargon keep)'));
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

test('keep directive string is explicit and not an empty override', () => {
  const keepEn = buildTransformDirective({ jargon: 'keep', korean: false });
  const keepKo = buildTransformDirective({ jargon: 'keep', korean: true });
  assert.ok(keepEn.includes('chest X-ray'));
  assert.ok(keepEn.includes('CXR'));
  assert.ok(keepKo.includes('라틴 문자'));
  assert.ok(keepKo.includes('분류/분할/손실'));
  assert.ok(!keepEn.includes('THIS DIRECTIVE WINS'));
});

test('--jargon and --register take exactly one value', () => {
  assert.equal(parseArgs(['--register', 'casual']).register, 'casual');
  assert.equal(parseArgs(['--register', 'professional', 'draft.md']).register, 'professional');
  assert.throws(() => parseArgs(['--register', 'shouty']), /unknown register shouty/);
  // Comma lists were a --preview compare feature; the preview surface is gone.
  assert.throws(() => parseArgs(['--jargon', 'keep,remove']), /--jargon takes one value/);
  assert.throws(() => parseArgs(['--register', 'casual,professional']), /--register takes one value/);
  assert.throws(() => parseArgs(['--jargon', ' ']), /--jargon expects a value/);
});
