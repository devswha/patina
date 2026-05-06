#!/usr/bin/env node
// Quality benchmark for the deterministic stylometry layer.
//
// Iterates every fixture under tests/fixtures/suspect-zones/{lang}/{class}/*.md,
// runs the in-tree analyzer (no LLM), and compares the predicted hot/cold
// decision against the fixture's expected_hot label. Emits a per-language
// confusion matrix + accuracy and writes the full per-fixture log to
// tests/quality/results.json.
//
// Usage: node tests/quality/benchmark.mjs [--quiet]

import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { analyzeText } from '../../src/features/index.js';
import { loadLexicon } from '../../src/features/lexicon.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const FIXTURES_ROOT = resolve(REPO_ROOT, 'tests/fixtures/suspect-zones');
const RESULTS_PATH = resolve(__dirname, 'results.json');

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;

function parseFixture(path) {
  const raw = readFileSync(path, 'utf8');
  const m = raw.match(FRONTMATTER_RE);
  if (!m) throw new Error(`Missing frontmatter: ${path}`);
  return { meta: yaml.load(m[1]), body: m[2].trim(), path };
}

function listFixtures() {
  const out = [];
  for (const lang of readdirSync(FIXTURES_ROOT)) {
    const langDir = resolve(FIXTURES_ROOT, lang);
    if (!statSync(langDir).isDirectory()) continue;
    for (const cls of readdirSync(langDir)) {
      const clsDir = resolve(langDir, cls);
      if (!statSync(clsDir).isDirectory()) continue;
      for (const file of readdirSync(clsDir)) {
        if (!file.endsWith('.md')) continue;
        out.push(resolve(clsDir, file));
      }
    }
  }
  return out.sort();
}

function emptyMetrics() {
  return { tp: 0, fp: 0, fn: 0, tn: 0, total: 0 };
}

function updateMetrics(m, predicted, expected) {
  m.total++;
  if (predicted && expected) m.tp++;
  else if (predicted && !expected) m.fp++;
  else if (!predicted && expected) m.fn++;
  else m.tn++;
}

function summarize(m) {
  const accuracy = m.total ? (m.tp + m.tn) / m.total : 0;
  const precision = m.tp + m.fp ? m.tp / (m.tp + m.fp) : 0;
  const recall = m.tp + m.fn ? m.tp / (m.tp + m.fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    ...m,
    accuracy: round(accuracy),
    precision: round(precision),
    recall: round(recall),
    f1: round(f1),
  };
}

function round(n, digits = 3) {
  return Math.round(n * 10 ** digits) / 10 ** digits;
}

function main() {
  const quiet = process.argv.includes('--quiet');
  const fixtures = listFixtures();

  if (fixtures.length === 0) {
    console.error('No fixtures found under', FIXTURES_ROOT);
    process.exit(2);
  }

  const lexicons = {};
  const perLanguage = {};
  const fixtureLog = [];

  for (const path of fixtures) {
    const { meta, body } = parseFixture(path);
    const lang = meta.language;
    if (!lexicons[lang]) lexicons[lang] = loadLexicon(lang, REPO_ROOT);
    if (!perLanguage[lang]) perLanguage[lang] = emptyMetrics();

    const result = analyzeText(body, {
      lang,
      lexicon: lexicons[lang],
    });
    const predicted = result.hot;
    const expected = Boolean(meta.expected_hot);
    updateMetrics(perLanguage[lang], predicted, expected);

    const p = result.paragraphs[0] || {};
    fixtureLog.push({
      fixture_id: meta.fixture_id,
      lang,
      class: meta.class,
      expected_hot: expected,
      predicted_hot: predicted,
      correct: predicted === expected,
      cv: round(p.burstiness?.cv ?? 0),
      cv_band: p.burstiness?.band,
      mattr: round(p.mattr?.value ?? 0),
      mattr_band: p.mattr?.band,
      lexicon_density: round(p.lexicon?.density ?? 0),
      lexicon_hits: p.lexicon?.hits ?? [],
    });
  }

  const summary = {};
  let totalCorrect = 0;
  let totalCount = 0;
  for (const [lang, m] of Object.entries(perLanguage)) {
    summary[lang] = summarize(m);
    totalCorrect += m.tp + m.tn;
    totalCount += m.total;
  }
  const overallAccuracy = totalCount ? totalCorrect / totalCount : 0;

  const results = {
    generatedAt: new Date().toISOString(),
    fixtureCount: fixtureLog.length,
    overallAccuracy: round(overallAccuracy),
    perLanguage: summary,
    fixtures: fixtureLog,
  };

  writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2) + '\n');

  if (!quiet) {
    console.log(`# Quality benchmark — ${fixtureLog.length} fixtures`);
    console.log(`Overall accuracy: ${(overallAccuracy * 100).toFixed(1)}%`);
    console.log();
    console.log('| lang | n | accuracy | precision | recall | f1 | TP | FP | FN | TN |');
    console.log('|------|---|----------|-----------|--------|----|----|----|----|----|');
    for (const [lang, s] of Object.entries(summary)) {
      console.log(
        `| ${lang} | ${s.total} | ${(s.accuracy * 100).toFixed(1)}% | ${(s.precision * 100).toFixed(1)}% | ${(s.recall * 100).toFixed(1)}% | ${s.f1.toFixed(2)} | ${s.tp} | ${s.fp} | ${s.fn} | ${s.tn} |`
      );
    }
    console.log();
    const wrong = fixtureLog.filter((f) => !f.correct);
    if (wrong.length > 0) {
      console.log(`Misclassified (${wrong.length}):`);
      for (const f of wrong) {
        console.log(
          `  ${f.fixture_id} (${f.class}) → predicted=${f.predicted_hot}, expected=${f.expected_hot} | cv=${f.cv} ${f.cv_band}, mattr=${f.mattr} ${f.mattr_band}, lex=${f.lexicon_density}/1000`
        );
      }
    } else {
      console.log('All fixtures classified correctly.');
    }
    console.log(`\nFull log: ${RESULTS_PATH}`);
  }
}

main();
