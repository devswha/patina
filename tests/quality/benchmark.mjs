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
import { summarizeSignalStrength } from '../../src/features/signal-strength.js';
import { summarizeRanking } from './ranking-metrics.mjs';
import { summarizeSlices, lengthBucket } from './slice-metrics.mjs';
import { resolveSliceFields } from './slice-metadata.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const FIXTURES_ROOT = resolve(REPO_ROOT, 'tests/fixtures/suspect-zones');
const RESULTS_PATH = resolve(__dirname, 'results.json');
const EXPECTED_RANGES_PATH = resolve(FIXTURES_ROOT, 'expected-ranges.json');
const FIXTURE_SCHEMA_VERSION = 1;

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

function loadExpectedRanges() {
  const raw = readFileSync(EXPECTED_RANGES_PATH, 'utf8');
  const ranges = JSON.parse(raw);
  if (ranges?.schemaVersion !== 1 || !ranges?.metrics || typeof ranges.metrics !== 'object') {
    throw new Error(`${EXPECTED_RANGES_PATH}: expected schemaVersion=1 and metrics object`);
  }
  return ranges.metrics;
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
    n: m.total,
    ci_low: round(wilsonInterval(m.tp + m.tn, m.total).low),
    ci_high: round(wilsonInterval(m.tp + m.tn, m.total).high),
    confidence_method: 'Wilson score interval, 95%',
  };
}

function rankingRecords(fixtures) {
  return fixtures.map((fixture) => ({
    score: fixture.signal_score,
    expected: fixture.expected_hot,
  }));
}

function summarizeRankingByLanguage(fixtures) {
  const byLanguage = {};
  for (const fixture of fixtures) {
    byLanguage[fixture.lang] ||= [];
    byLanguage[fixture.lang].push({
      score: fixture.signal_score,
      expected: fixture.expected_hot,
    });
  }
  return Object.fromEntries(
    Object.entries(byLanguage)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([lang, records]) => [lang, summarizeRanking(records)])
  );
}

function round(n, digits = 3) {
  return Math.round(n * 10 ** digits) / 10 ** digits;
}

function wilsonInterval(successes, n, z = 1.959963984540054) {
  if (!n) return { low: 0, high: 0 };
  const phat = successes / n;
  const denom = 1 + (z ** 2) / n;
  const center = (phat + (z ** 2) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((phat * (1 - phat) + (z ** 2) / (4 * n)) / n)) / denom;
  return {
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin),
  };
}

function detectorHot(result) {
  return {
    burstiness: result.paragraphs.some((p) => p.burstiness?.band === 'low'),
    koDiagnostics: result.paragraphs.some((p) => p.koDiagnostics?.hot),
    mattr: result.paragraphs.some((p) => p.mattr?.band === 'low'),
    lexicon: result.paragraphs.some((p) => p.lexicon?.hot),
    endingMonotony: result.paragraphs.some((p) => p.endingMonotonyHot),
    candor: result.paragraphs.some((p) => p.candorHot),
    thematicBreak: result.paragraphs.some((p) => p.thematicBreakHot),
  };
}

function emptyDetectorMetrics() {
  return Object.fromEntries(
    Object.keys(detectorHot({ paragraphs: [] })).map((name) => [name, emptyMetrics()])
  );
}

function validateExpectedMetrics(path, expected = {}, observed = {}) {
  const failures = [];
  if (expected.cv_band && observed.cv_band !== expected.cv_band) {
    failures.push(`cv_band expected ${expected.cv_band}, got ${observed.cv_band}`);
  }
  if (expected.mattr_band && observed.mattr_band !== expected.mattr_band) {
    failures.push(`mattr_band expected ${expected.mattr_band}, got ${observed.mattr_band}`);
  }
  if (typeof expected.lexicon_density_min === 'number' && observed.lexicon_density < expected.lexicon_density_min) {
    failures.push(`lexicon_density expected >= ${expected.lexicon_density_min}, got ${observed.lexicon_density}`);
  }
  if (typeof expected.lexicon_density_max === 'number' && observed.lexicon_density > expected.lexicon_density_max) {
    failures.push(`lexicon_density expected <= ${expected.lexicon_density_max}, got ${observed.lexicon_density}`);
  }
  if (Array.isArray(expected.cv_range) && !inRange(observed.cv, expected.cv_range)) {
    failures.push(`cv expected ${formatRange(expected.cv_range)}, got ${observed.cv}`);
  }
  if (Array.isArray(expected.mattr_range) && !inRange(observed.mattr, expected.mattr_range)) {
    failures.push(`mattr expected ${formatRange(expected.mattr_range)}, got ${observed.mattr}`);
  }
  if (Array.isArray(expected.lexicon_density_range) && !inRange(observed.lexicon_density, expected.lexicon_density_range)) {
    failures.push(`lexicon_density expected ${formatRange(expected.lexicon_density_range)}, got ${observed.lexicon_density}`);
  }
  if (expected.detectors) {
    for (const [name, expectedHot] of Object.entries(expected.detectors)) {
      if (observed.detectors?.[name] !== expectedHot) {
        failures.push(`detector.${name} expected ${expectedHot}, got ${observed.detectors?.[name]}`);
      }
    }
  }
  if (typeof expected.predicted_hot === 'boolean' && observed.predicted_hot !== expected.predicted_hot) {
    failures.push(`predicted_hot expected ${expected.predicted_hot}, got ${observed.predicted_hot}`);
  }
  // Pins per-paragraph attribution (#391): a document-level OR could keep
  // predicted_hot true while leaving every paragraph cold, which this catches.
  if (typeof expected.hot_paragraphs === 'number' && observed.hot_paragraphs !== expected.hot_paragraphs) {
    failures.push(`hot_paragraphs expected ${expected.hot_paragraphs}, got ${observed.hot_paragraphs}`);
  }
  // A hot fixture must stay visible to the signal-score ranking leg.
  if (typeof expected.signal_score_min === 'number' && observed.signal_score < expected.signal_score_min) {
    failures.push(`signal_score expected >= ${expected.signal_score_min}, got ${observed.signal_score}`);
  }
  if (failures.length) {
    throw new Error(`${path}: expected_metrics regression failed: ${failures.join('; ')}`);
  }
}

function inRange(value, [min, max]) {
  return typeof value === 'number' && value >= min && value <= max;
}

function formatRange([min, max]) {
  return `[${min}, ${max}]`;
}

function main() {
  const quiet = process.argv.includes('--quiet');
  const fixtures = listFixtures();
  const expectedRanges = loadExpectedRanges();

  if (fixtures.length === 0) {
    console.error('No fixtures found under', FIXTURES_ROOT);
    process.exit(2);
  }

  const lexicons = {};
  const perLanguage = {};
  const byDetector = {};
  const fixtureLog = [];

  for (const path of fixtures) {
    const { meta, body } = parseFixture(path);
    const lang = meta.language;
    if (typeof meta.expected_hot !== 'boolean') {
      throw new Error(
        `${path}: \`expected_hot\` must be a literal boolean (got ${typeof meta.expected_hot}: ${JSON.stringify(meta.expected_hot)})`
      );
    }
    if (!lexicons[lang]) lexicons[lang] = loadLexicon(lang, REPO_ROOT);
    if (!perLanguage[lang]) perLanguage[lang] = emptyMetrics();
    if (!byDetector[lang]) byDetector[lang] = emptyDetectorMetrics();

    const result = analyzeText(body, {
      lang,
      lexicon: lexicons[lang],
    });
    const predicted = result.hot;
    const expected = meta.expected_hot;
    updateMetrics(perLanguage[lang], predicted, expected);
    const detectors = detectorHot(result);
    for (const [name, hot] of Object.entries(detectors)) {
      updateMetrics(byDetector[lang][name], hot, expected);
    }

    const p = result.paragraphs[0] || {};
    const observed = {
      cv: round(p.burstiness?.cv ?? 0),
      cv_band: p.burstiness?.band,
      mattr: round(p.mattr?.value ?? 0),
      mattr_band: p.mattr?.band,
      lexicon_density: round(p.lexicon?.density ?? 0),
      lexicon_hits: p.lexicon?.hits ?? [],
      ko_diagnostics_hot: Boolean(p.koDiagnostics?.hot),
      ko_diagnostics_reasons: p.koDiagnostics?.reasons ?? [],
      ko_diagnostics_strength: round(p.koDiagnostics?.strength ?? 0),
      signal_score: round(summarizeSignalStrength(result.paragraphs)),
      hot_paragraphs: result.paragraphs.filter((x) => x.hot).length,
    };
    const pinned = expectedRanges[meta.fixture_id];
    if (!pinned) {
      throw new Error(
        `${path}: missing benchmark regression range. Run node scripts/update-benchmark-ranges.mjs after reviewing the fixture.`
      );
    }
    observed.detectors = detectors;
    observed.predicted_hot = predicted;
    validateExpectedMetrics(path, pinned, observed);
    if (meta.expected_metrics) validateExpectedMetrics(path, meta.expected_metrics, observed);
    fixtureLog.push({
      fixture_id: meta.fixture_id,
      lang,
      class: meta.class,
      expected_hot: expected,
      predicted_hot: predicted,
      correct: predicted === expected,
      detectors,
      ...observed,
      expected_metrics: meta.expected_metrics ?? null,
      // Slice dimensions (B2, report-only). language/class/length_bucket are
      // always derivable; the rest default to `unspecified` until the corpus
      // carries that metadata.
      length_bucket: lengthBucket([...body].length),
      // generator/edited resolved via the tested B2 reconciliation mapper
      // (Wave 0.1): explicit B2-native fields win; model_family/edit_depth
      // aliases and class defaults fill the rest. register/domain pass through.
      ...resolveSliceFields(meta),
    });
  }

  const summary = {};
  let totalCorrect = 0;
  let totalCount = 0;
  for (const [lang, m] of Object.entries(perLanguage)) {
    summary[lang] = summarize(m);
    summary[lang].byDetector = Object.fromEntries(
      Object.entries(byDetector[lang]).map(([name, metrics]) => [name, summarize(metrics)])
    );
    totalCorrect += m.tp + m.tn;
    totalCount += m.total;
  }
  const overallAccuracy = totalCount ? totalCorrect / totalCount : 0;
  const overallCi = wilsonInterval(totalCorrect, totalCount);

  const results = {
    schemaVersion: 3,
    fixtureSchemaVersion: FIXTURE_SCHEMA_VERSION,
    nodeVersion: process.version,
    generatedAt: new Date().toISOString(),
    fixtureCount: fixtureLog.length,
    overallAccuracy: round(overallAccuracy),
    overall: {
      accuracy: round(overallAccuracy),
      n: totalCount,
      ci_low: round(overallCi.low),
      ci_high: round(overallCi.high),
      confidence_method: 'Wilson score interval, 95%',
    },
    perLanguage: summary,
    ranking: {
      note: 'Signal-score ranking over the checked-in fixture corpus; diagnostic only, not a public generalization claim.',
      score: 'signal_score from the strongest deterministic paragraph trigger, averaged per fixture',
      overall: summarizeRanking(rankingRecords(fixtureLog)),
      perLanguage: summarizeRankingByLanguage(fixtureLog),
    },
    slices: summarizeSlices(
      fixtureLog.map((f) => ({
        language: f.lang,
        class: f.class,
        lengthBucket: f.length_bucket,
        domain: f.domain,
        register: f.register,
        generator: f.generator,
        edited: f.edited,
        predicted_hot: f.predicted_hot,
        expected_hot: f.expected_hot,
      }))
    ),
    fixtures: fixtureLog,
  };

  writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2) + '\n');

  const wrong = fixtureLog.filter((f) => !f.correct);

  if (!quiet) {
    console.log(`# Quality benchmark — ${fixtureLog.length} fixtures`);
    console.log(`Overall accuracy: ${(overallAccuracy * 100).toFixed(1)}%`);
    console.log(`Signal ROC-AUC: ${results.ranking.overall.roc_auc.toFixed(3)} · PR-AUC: ${results.ranking.overall.pr_auc.toFixed(3)} · best-F1 threshold: ${results.ranking.overall.bestF1.threshold}`);
    console.log();
    console.log('| lang | n | accuracy | precision | recall | f1 | TP | FP | FN | TN |');
    console.log('|------|---|----------|-----------|--------|----|----|----|----|----|');
    for (const [lang, s] of Object.entries(summary)) {
      console.log(
        `| ${lang} | ${s.total} | ${(s.accuracy * 100).toFixed(1)}% | ${(s.precision * 100).toFixed(1)}% | ${(s.recall * 100).toFixed(1)}% | ${s.f1.toFixed(2)} | ${s.tp} | ${s.fp} | ${s.fn} | ${s.tn} |`
      );
    }
    console.log();
    console.log('| lang | detector | n | accuracy | precision | recall | f1 | TP | FP | FN | TN |');
    console.log('|------|----------|---|----------|-----------|--------|----|----|----|----|----|');
    for (const [lang, s] of Object.entries(summary)) {
      for (const [detector, d] of Object.entries(s.byDetector)) {
        console.log(
          `| ${lang} | ${detector} | ${d.total} | ${(d.accuracy * 100).toFixed(1)}% | ${(d.precision * 100).toFixed(1)}% | ${(d.recall * 100).toFixed(1)}% | ${d.f1.toFixed(2)} | ${d.tp} | ${d.fp} | ${d.fn} | ${d.tn} |`
        );
      }
    }
    console.log();
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

  // Non-zero exit on any misclassification so CI catches regressions even in --quiet mode.
  if (wrong.length > 0) process.exitCode = 1;
}

main();
