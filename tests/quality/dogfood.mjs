#!/usr/bin/env node
// Deterministic dogfood guard for public docs.
//
// This deliberately avoids live LLM calls in CI. It uses patina's in-tree
// stylometry/lexicon analyzer and reports the percentage of prose paragraphs
// that trip a hot signal. The threshold is a regression guard, not an
// authorship verdict.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzeText } from '../../src/features/index.js';
import { loadLexicon } from '../../src/features/lexicon.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const THRESHOLD = 30;
const TARGETS = ['README.md', 'docs/FAQ.md', 'SKILL.md'];

function stripNonProse(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, '\n')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '\n')
    .replace(/^\|.*\|$/gm, '\n')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .trim();
}

function scoreFile(file) {
  const raw = readFileSync(resolve(REPO_ROOT, file), 'utf8');
  const text = stripNonProse(raw);
  const result = analyzeText(text, {
    lang: 'en',
    repoRoot: REPO_ROOT,
    lexicon: loadLexicon('en', REPO_ROOT),
  });
  const paragraphCount = result.paragraphs.length;
  const hotCount = result.paragraphs.filter((p) => p.hot).length;
  const score = paragraphCount ? (hotCount / paragraphCount) * 100 : 0;
  return { file, paragraphCount, hotCount, score };
}

const rows = TARGETS.map(scoreFile);
console.log('# Dogfood docs score');
console.log('| file | paragraphs | hot | score | threshold |');
console.log('|---|---:|---:|---:|---:|');
for (const r of rows) {
  console.log(`| ${r.file} | ${r.paragraphCount} | ${r.hotCount} | ${r.score.toFixed(1)} | ${THRESHOLD} |`);
}

const failures = rows.filter((r) => r.score > THRESHOLD);
if (failures.length) {
  console.error(`\nDogfood score exceeded ${THRESHOLD}: ${failures.map((f) => `${f.file}=${f.score.toFixed(1)}`).join(', ')}`);
  process.exitCode = 1;
}
