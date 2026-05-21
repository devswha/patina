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

import { scoreText } from '../../scripts/prose-score.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const THRESHOLD = 30;
const TARGETS = [
  { file: 'README.md', lang: 'en' },
  { file: 'README_KR.md', lang: 'ko' },
  { file: 'README_ZH.md', lang: 'zh' },
  { file: 'README_JA.md', lang: 'ja' },
  { file: 'docs/FAQ.md', lang: 'en' },
  { file: 'docs/social/signs-of-ai-writing.md', lang: 'en' },
  { file: 'docs/social/signs-of-ai-writing_KR.md', lang: 'ko' },
  { file: 'SKILL.md', lang: 'ko' },
];

function scoreFile({ file, lang }) {
  const raw = readFileSync(resolve(REPO_ROOT, file), 'utf8');
  return scoreText(raw, { file, lang, gate: THRESHOLD, repoRoot: REPO_ROOT });
}

const rows = TARGETS.map(scoreFile);
console.log('# Dogfood docs score');
console.log('| file | lang | paragraphs | hot | score | signal | pattern hits | threshold |');
console.log('|---|---|---:|---:|---:|---:|---:|---:|');
for (const r of rows) {
  console.log(`| ${r.file} | ${r.lang} | ${r.paragraphCount} | ${r.hotCount} | ${r.score.toFixed(1)} | ${r.signalScore.toFixed(1)} | ${r.patternHits} | ${THRESHOLD} |`);
}

const failures = rows.filter((r) => r.score > THRESHOLD);
if (failures.length) {
  console.error(`\nDogfood score exceeded ${THRESHOLD}: ${failures.map((f) => `${f.file}=${f.score.toFixed(1)}`).join(', ')}`);
  process.exitCode = 1;
}
