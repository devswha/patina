import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeText as nodeAnalyze } from '../../src/features/index.js';
import { analyzeText as browserAnalyze } from '../../src/features/analyzer.js';
import { loadLexicon } from '../../src/features/lexicon.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('browser data-only analysis matches the Node path on every public fixture', () => {
  for (const lang of ['en', 'ko', 'zh', 'ja']) {
    const loaded = loadLexicon(lang, root);
    const { path: _path, ...data } = loaded;
    const lexicon = JSON.parse(JSON.stringify(data));
    for (const kind of ['ai', 'natural']) {
      const directory = resolve(root, 'tests/fixtures/suspect-zones', lang, kind);
      for (const file of readdirSync(directory).filter((file) => file.endsWith('.md'))) {
        const text = readFileSync(resolve(directory, file), 'utf8').replace(/^---\s*\n[\s\S]*?\n---\s*\n/, '').trim();
        assert.deepEqual(browserAnalyze(text, { lang, lexicon }), nodeAnalyze(text, { lang, repoRoot: root }), file);
      }
    }
  }
});

test('the browser entry graph has no Node modules, environment reads or network APIs', () => {
  const seen = new Set();
  function visit(path) {
    if (seen.has(path)) return; seen.add(path);
    const source = readFileSync(path, 'utf8');
    assert.doesNotMatch(source, /\b(?:process\.(?:env|cwd)|fetch\s*\(|XMLHttpRequest|WebSocket)\b/, path);
    for (const match of source.matchAll(/(?:import|export)\s[\s\S]*?\bfrom\s*['"]([^'"]+)['"]/g)) {
      assert.ok(match[1].startsWith('.'), `Non-local dependency ${match[1]}`);
      visit(resolve(dirname(path), match[1]));
    }
  }
  visit(resolve(root, 'src/prose-core.js')); assert.ok(seen.size > 5);
});
