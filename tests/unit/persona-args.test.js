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

test('--persona rejects non-rewrite and preview surfaces', () => {
  for (const flag of ['--score', '--audit', '--diff', '--preview']) {
    assertPersonaInputError([flag, '--persona', 'preserve', 'draft.md']);
  }
});

test('removed --restyle / --ouroboros flags are rejected at parse time', () => {
  assertPersonaInputError(['--persona', 'preserve', '--restyle', 'voice', 'draft.md']);
  assertPersonaInputError(['--persona', 'preserve', '--ouroboros', 'draft.md']);
});

test('--persona rejects comma-list transform variants', () => {
  assertPersonaInputError(['--persona', 'preserve', '--jargon', 'keep,remove', 'draft.md']);
  assertPersonaInputError(['--persona', 'preserve', '--tone', 'casual,professional', 'draft.md']);
});

test('--persona rejects jargon rewrite policies', () => {
  assertPersonaInputError(['--persona', 'preserve', '--jargon', 'explain', 'draft.md']);
  assertPersonaInputError(['--persona', 'preserve', '--jargon', 'remove', 'draft.md']);
});

test('--persona now allows all supported languages (multilingual)', () => {
  for (const lang of ['ko', 'en', 'zh', 'ja']) {
    assertPersonaAllowed(['--lang', lang, '--persona', 'preserve', 'draft.md']);
  }
});

test('--persona allows single tone and profile', () => {
  assertPersonaAllowed(['--persona', 'preserve', '--tone', 'casual', 'draft.md']);
  assertPersonaAllowed(['--persona', 'preserve', '--profile', 'blog', 'draft.md']);
});
