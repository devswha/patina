import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { resolvePersonaForRun } from '../../src/cli/run.js';
import { PatinaCliError } from '../../src/errors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

test('implicit preserve is not applied outside Korean rewrite', () => {
  assert.equal(resolvePersonaForRun({ parsed: {}, config: {}, mode: 'score', lang: 'ko', repoRoot: REPO_ROOT }), null);
  assert.equal(resolvePersonaForRun({ parsed: {}, config: {}, mode: 'rewrite', lang: 'en', repoRoot: REPO_ROOT }), null);
  assert.equal(resolvePersonaForRun({ parsed: { preview: true }, config: {}, mode: 'rewrite', lang: 'ko', repoRoot: REPO_ROOT }), null);
});

test('config persona with non-Korean language is explicit and rejected', () => {
  assert.throws(
    () => resolvePersonaForRun({ parsed: { lang: 'en' }, config: { persona: 'blog-essay' }, mode: 'rewrite', lang: 'en', repoRoot: REPO_ROOT }),
    (err) => err instanceof PatinaCliError && err.exitCode === 2,
  );
});

test('Korean rewrite resolves no-flag persona to preserve', () => {
  const persona = resolvePersonaForRun({ parsed: {}, config: {}, mode: 'rewrite', lang: 'ko', repoRoot: REPO_ROOT });
  assert.equal(persona.id, 'preserve');
  assert.equal(persona.lang, 'ko');
});
