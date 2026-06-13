#!/usr/bin/env node
// Adversarial detection-robustness report (B3).
//
// Applies deterministic adversarial transforms (tests/quality/adversarial-
// transforms.mjs) to every checked-in suspect-zone fixture, re-runs the
// deterministic analyzer, and measures how well its hot/cold decision survives.
// Adversarial variants INHERIT their source fixture's label. This is REPORT-
// ONLY and SEPARATE from the baseline benchmark: it never changes a detector
// threshold and never gates CI — a robustness rate below 100% is informative,
// not a regression.
//
// Usage: node scripts/robustness-report.mjs

import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { analyzeText } from '../src/features/index.js';
import { loadLexicon } from '../src/features/lexicon.js';
import { ADVERSARIAL_TRANSFORMS, summarizeRobustness } from '../tests/quality/adversarial-transforms.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const FIXTURES_ROOT = resolve(REPO_ROOT, 'tests/fixtures/suspect-zones');
const REPORT_DIR = resolve(REPO_ROOT, 'docs/benchmarks');
const JSON_PATH = resolve(REPORT_DIR, 'robustness-latest.json');
const MARKDOWN_PATH = resolve(REPORT_DIR, 'robustness-latest.md');
const SCHEMA_VERSION = 1;
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;

function listFixtures() {
  const out = [];
  for (const lang of readdirSync(FIXTURES_ROOT)) {
    const langDir = resolve(FIXTURES_ROOT, lang);
    if (!statSync(langDir).isDirectory()) continue;
    for (const cls of readdirSync(langDir)) {
      const clsDir = resolve(langDir, cls);
      if (!statSync(clsDir).isDirectory()) continue;
      for (const file of readdirSync(clsDir)) {
        if (file.endsWith('.md')) out.push(resolve(clsDir, file));
      }
    }
  }
  return out.sort();
}

function parseFixture(path) {
  const m = readFileSync(path, 'utf8').match(FRONTMATTER_RE);
  if (!m) throw new Error(`Missing frontmatter: ${path}`);
  return { meta: yaml.load(m[1]), body: m[2].trim() };
}

function buildRows() {
  const lexicons = {};
  const rows = [];
  for (const path of listFixtures()) {
    const { meta, body } = parseFixture(path);
    const lang = meta.language;
    if (!lexicons[lang]) lexicons[lang] = loadLexicon(lang, REPO_ROOT);
    const baselineHot = analyzeText(body, { lang, lexicon: lexicons[lang] }).hot;
    for (const transform of ADVERSARIAL_TRANSFORMS) {
      const transformedHot = analyzeText(transform.apply(body), { lang, lexicon: lexicons[lang] }).hot;
      rows.push({
        transform: transform.id,
        language: lang,
        expected_hot: meta.expected_hot,
        baseline_hot: baselineHot,
        transformed_hot: transformedHot,
      });
    }
  }
  return rows;
}

function buildReport(rows) {
  const languages = [...new Set(rows.map((r) => r.language))].sort();
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    nodeVersion: process.version,
    note: 'Report-only detection robustness under deterministic adversarial transforms. Adversarial variants inherit source labels. Not a CI gate and not a detector-threshold change.',
    transforms: ADVERSARIAL_TRANSFORMS.map((t) => ({ id: t.id, label: t.label })),
    fixtureCount: ADVERSARIAL_TRANSFORMS.length ? rows.length / ADVERSARIAL_TRANSFORMS.length : 0,
    overall: summarizeRobustness(rows),
    perLanguage: Object.fromEntries(
      languages.map((lang) => [lang, summarizeRobustness(rows.filter((r) => r.language === lang))])
    ),
  };
}

function pct(value) {
  return value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function transformRows(summary) {
  const out = [];
  for (const t of ADVERSARIAL_TRANSFORMS) {
    const m = summary[t.id];
    if (!m) continue;
    out.push(`| ${t.label} | ${m.positives} | ${pct(m.detectionRetainedRate)} | ${m.negatives} | ${pct(m.cleanRetainedRate)} | ${m.decisionChanged} |`);
  }
  return out.join('\n');
}

function renderMarkdown(report) {
  const langs = Object.keys(report.perLanguage).sort();
  const perLangBlocks = langs.map((lang) => [
    `### ${lang}`,
    '',
    '| transform | AI fixtures | detection retained | natural fixtures | clean retained | decisions changed |',
    '|---|---:|---:|---:|---:|---:|',
    transformRows(report.perLanguage[lang]),
  ].join('\n'));

  return `# Adversarial Robustness Report

Report-only measurement of how the deterministic analyzer's hot/cold decision
survives common evasion transforms. **Not a CI gate** and **not a detector-
threshold change** — a sub-100% rate is informative, not a regression.
Adversarial variants inherit their source fixture's label.

- Generated at: ${report.generatedAt}
- Node: ${report.nodeVersion}
- Base fixtures: ${report.fixtureCount}
- Transforms: ${report.transforms.map((t) => t.label).join(', ')}
- Reproduce: \`npm run benchmark:robustness\`
- Raw JSON: [robustness-latest.json](robustness-latest.json)

## Normalization expectations

The analyzer NFC-normalizes input. NFC does **not** strip zero-width characters
(U+200B) and does **not** fold homoglyphs (confusable Cyrillic/Greek code
points), so those transforms genuinely reach tokenization. Case folding is the
mildest tactic because the analyzer lowercases internally.

## Overall

\`detection retained\` = AI-labelled fixtures still flagged hot after the
transform; \`clean retained\` = natural-labelled fixtures still NOT flagged;
\`decisions changed\` = fixtures whose hot/cold decision flipped vs the
untransformed baseline.

| transform | AI fixtures | detection retained | natural fixtures | clean retained | decisions changed |
|---|---:|---:|---:|---:|---:|
${transformRows(report.overall)}

## Per language

${perLangBlocks.join('\n\n')}
`;
}

function main() {
  const rows = buildRows();
  const report = buildReport(rows);
  writeFileSync(JSON_PATH, JSON.stringify(report, null, 2) + '\n');
  writeFileSync(MARKDOWN_PATH, renderMarkdown(report));
  console.log(`Wrote ${JSON_PATH}`);
  console.log(`Wrote ${MARKDOWN_PATH}`);
}

const isDirectRun = process.argv[1]
  ? resolve(process.cwd(), process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (isDirectRun) main();

export { buildReport, renderMarkdown };
