import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { resolvePersonaForRun } from '../../src/cli/run.js';
import { PatinaCliError } from '../../src/errors.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

test('ko keeps implicit-preserve default; non-ko persona is opt-in', () => {
  // Non-rewrite mode and preview never resolve a persona.
  assert.equal(resolvePersonaForRun({ parsed: {}, config: {}, mode: 'score', lang: 'ko', repoRoot: REPO_ROOT }), null);
  assert.equal(resolvePersonaForRun({ parsed: { preview: true }, config: {}, mode: 'rewrite', lang: 'ko', repoRoot: REPO_ROOT }), null);
  // ko: a plain rewrite resolves preserve implicitly (back-compat).
  const ko = resolvePersonaForRun({ parsed: {}, config: {}, mode: 'rewrite', lang: 'ko', repoRoot: REPO_ROOT });
  assert.equal(ko.id, 'preserve');
  assert.equal(ko.lang, 'ko');
  // en/zh/ja: a plain rewrite stays persona-free unless explicitly requested.
  for (const lang of ['en', 'zh', 'ja']) {
    assert.equal(resolvePersonaForRun({ parsed: {}, config: {}, mode: 'rewrite', lang, repoRoot: REPO_ROOT }), null, `${lang} no-flag rewrite should be persona-free`);
  }
});

test('an explicit persona resolves in every supported language', () => {
  for (const lang of ['ko', 'en', 'zh', 'ja']) {
    const persona = resolvePersonaForRun({ parsed: { persona: 'preserve' }, config: {}, mode: 'rewrite', lang, repoRoot: REPO_ROOT });
    assert.equal(persona.id, 'preserve');
    assert.equal(persona.lang, lang);
  }
});

test('a persona id absent from a language library throws an input error', () => {
  // en ships preserve + en seeds (blog-essay/natural-en/technical-explainer); a
  // KO-only seed id (pragmatic-founder) must fail closed, not silently fall back.
  assert.throws(
    () => resolvePersonaForRun({ parsed: { persona: 'pragmatic-founder' }, config: {}, mode: 'rewrite', lang: 'en', repoRoot: REPO_ROOT }),
    (err) => err instanceof PatinaCliError && err.exitCode === 2,
  );
});
