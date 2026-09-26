import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { parseArgs, validatePersonaRequest } from '../../src/cli/args.js';
import { PatinaCliError } from '../../src/errors.js';

function assertPersonaInputError(args) {
  assert.throws(
    () => validatePersonaRequest(parseArgs(args)),
    (err) => err instanceof PatinaCliError && err.exitCode === 2,
  );
}

function assertPersonaAllowed(args) {
  assert.doesNotThrow(() => validatePersonaRequest(parseArgs(args)));
}

test('--persona rejects non-rewrite surfaces', () => {
  for (const flag of ['--score', '--audit', '--diff']) {
    assertPersonaInputError([flag, '--persona', 'preserve', 'draft.md']);
  }
});

test('--persona rejects unsupported options at parse time', () => {
  assertPersonaInputError(['--persona', 'preserve', '--unsupported-option', 'draft.md']);
});

test('--persona composes with rewrite transformations', () => {
  assertPersonaAllowed(['--persona', 'natural-ko', '--jargon', 'keep', 'draft.md']);
  assertPersonaAllowed(['--persona', 'natural-ko', '--register', 'professional', 'draft.md']);
  assertPersonaAllowed(['--persona', 'natural-ko', '--jargon', 'explain', 'draft.md']);
  assertPersonaAllowed(['--persona', 'natural-ko', '--jargon', 'remove', 'draft.md']);
});

test('--persona now allows all supported languages (multilingual)', () => {
  for (const lang of ['ko', 'en', 'zh', 'ja']) {
    assertPersonaAllowed(['--lang', lang, '--persona', 'preserve', 'draft.md']);
  }
});

test('--persona allows a single register and Document Type', () => {
  assertPersonaAllowed(['--persona', 'preserve', '--register', 'casual', 'draft.md']);
  assertPersonaAllowed(['--persona', 'preserve', '--document-type', 'blog', 'draft.md']);
});
