import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadPatterns } from '../../src/loader.js';
import { buildPrompt, WATCH_WORD_LABEL_SOURCE } from '../../src/prompt-builder.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const LANGS = ['en', 'ko', 'zh', 'ja'];

function minimalRewritePrompt(lang) {
  return buildPrompt({
    config: { language: lang, documentType: 'default' },
    patterns: loadPatterns(REPO_ROOT, lang),
    documentType: null, voice: null, persona: null, register: null, scoring: null,
    promptMode: 'minimal', documentSignals: null, jargon: 'keep', rewriteHeadings: false,
    rhetoricPolicy: 'default', text: 'sample', mode: 'rewrite', includeSelfAudit: false,
  });
}

// #888: the zh and ja packs label their watch-word field in their own language and
// end it with a full-width colon. A KO/EN-only extractor silently produced nothing
// for them, so minimal mode shipped Chinese and Japanese rewrites with no pattern
// trigger vocabulary at all.
test('every language contributes watch words to the minimal rewrite prompt', () => {
  for (const lang of LANGS) {
    const packs = (minimalRewritePrompt(lang).match(/- \*\*[a-z]{2}-[a-z-]+\*\*:/g) ?? []).length;
    assert.ok(packs > 0, `${lang} contributed ${packs} packs of watch words to minimal mode`);
  }
});

// The label list is only correct while it covers what the packs actually use, so
// assert against the tree rather than against a remembered inventory.
test('no pattern pack uses a watch-word label the extractor cannot read', () => {
  const patternDir = resolve(REPO_ROOT, 'patterns');
  // Read the SHIPPED pattern rather than a copy: a duplicated list would drift
  // from production and this test would then be checking itself.
  const known = new RegExp(`^${WATCH_WORD_LABEL_SOURCE}`);
  // A bold label that opens a line and reads like a vocabulary field.
  const vocabLike = /^\*\*([^*]*(?:Watch words|주의 어휘|語彙|词汇|注意語|注意词)[^*]*)\*\*/;
  const unreadable = new Set();
  for (const file of readdirSync(patternDir).filter((f) => f.endsWith('.md'))) {
    for (const line of readFileSync(resolve(patternDir, file), 'utf8').split('\n')) {
      const m = line.match(vocabLike);
      if (m && !known.test(line)) unreadable.add(`${file}: ${m[0]}`);
    }
  }
  assert.deepEqual([...unreadable], [], 'these labels would be silently dropped from minimal mode');
});
