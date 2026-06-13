#!/usr/bin/env node
// Generate a publishable benchmark report from the deterministic quality suite.
//
// Default behavior reruns tests/quality/benchmark.mjs first so docs/benchmarks/*
// reflects the current fixture set. Use --no-run to render from an existing
// tests/quality/results.json file.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const RESULTS_PATH = resolve(REPO_ROOT, 'tests/quality/results.json');
const REPORT_DIR = resolve(REPO_ROOT, 'docs/benchmarks');
const JSON_PATH = resolve(REPORT_DIR, 'latest.json');
const MARKDOWN_PATH = resolve(REPORT_DIR, 'latest.md');

const runBenchmarkFirst = !process.argv.includes('--no-run');
const benchmarkCommand = ['node', 'tests/quality/benchmark.mjs', '--quiet'];

function runBenchmark() {
  const result = spawnSync(process.execPath, ['tests/quality/benchmark.mjs', '--quiet'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function readResults() {
  try {
    const results = JSON.parse(readFileSync(RESULTS_PATH, 'utf8'));
    validateResultsSchema(results);
    return results;
  } catch (error) {
    throw new Error(
      `Cannot read ${relative(REPO_ROOT, RESULTS_PATH)}. Run npm run benchmark first. ${error.message}`
    );
  }
}

function validateResultsSchema(results) {
  const missing = [];
  if (results?.schemaVersion !== 3) missing.push('schemaVersion=3');
  if (typeof results?.fixtureSchemaVersion !== 'number') missing.push('fixtureSchemaVersion');
  if (typeof results?.nodeVersion !== 'string') missing.push('nodeVersion');
  if (typeof results?.overall?.ci_low !== 'number') missing.push('overall.ci_low');
  if (typeof results?.overall?.ci_high !== 'number') missing.push('overall.ci_high');
  if (typeof results?.overall?.n !== 'number') missing.push('overall.n');
  if (!isNumberOrNull(results?.ranking?.overall?.roc_auc)) missing.push('ranking.overall.roc_auc');
  if (!isNumberOrNull(results?.ranking?.overall?.pr_auc)) missing.push('ranking.overall.pr_auc');
  if (!results?.ranking?.overall?.bestF1) missing.push('ranking.overall.bestF1');
  if (!Array.isArray(results?.ranking?.overall?.low_fpr)) missing.push('ranking.overall.low_fpr');
  if (!results?.slices || typeof results.slices !== 'object') missing.push('slices');
  for (const [lang, summary] of Object.entries(results?.perLanguage || {})) {
    for (const detector of ['burstiness', 'koDiagnostics', 'mattr', 'lexicon']) {
      if (!summary.byDetector?.[detector]) missing.push(`perLanguage.${lang}.byDetector.${detector}`);
    }
  }
  if (missing.length) {
    throw new Error(`Benchmark results schema is stale or invalid; missing ${missing.join(', ')}. Re-run tests/quality/benchmark.mjs.`);
  }
}

function isNumberOrNull(value) {
  return value === null || typeof value === 'number';
}

function pct(value) {
  return `${((value ?? 0) * 100).toFixed(1)}%`;
}

function num(value, digits = 3) {
  return Number(value ?? 0).toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function optionalPct(value) {
  return value === null || value === undefined ? '—' : pct(value);
}

function optionalNum(value, digits = 3) {
  return value === null || value === undefined ? '—' : num(value, digits);
}

function bool(value) {
  return value ? 'hot' : 'cold';
}

function resultMark(value) {
  return value ? '✓' : '✗';
}

function cell(value) {
  return String(value ?? '—').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim() || '—';
}

function statusFromResults(results) {
  return (results.fixtures || []).some((f) => !f.correct) ? 1 : 0;
}

function languageRows(perLanguage = {}) {
  return Object.entries(perLanguage)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([lang, s]) =>
      `| ${lang} | ${s.total} | ${pct(s.accuracy)} | ${pct(s.ci_low)}–${pct(s.ci_high)} | ${pct(s.precision)} | ${pct(s.recall)} | ${num(s.f1, 2)} | ${s.tp} | ${s.fp} | ${s.fn} | ${s.tn} |`
    );
}

function detectorRows(perLanguage = {}) {
  const rows = [];
  for (const [lang, s] of Object.entries(perLanguage).sort(([a], [b]) => a.localeCompare(b))) {
    for (const [detector, d] of Object.entries(s.byDetector || {}).sort(([a], [b]) => a.localeCompare(b))) {
      rows.push(
        `| ${lang} | ${detector} | ${d.total} | ${pct(d.accuracy)} | ${pct(d.ci_low)}–${pct(d.ci_high)} | ${pct(d.precision)} | ${pct(d.recall)} | ${num(d.f1, 2)} | ${d.tp} | ${d.fp} | ${d.fn} | ${d.tn} |`
      );
    }
  }
  return rows;
}

function rankingRows(ranking = {}) {
  const rows = [];
  if (ranking.overall) rows.push(['overall', ranking.overall]);
  for (const [lang, summary] of Object.entries(ranking.perLanguage || {}).sort(([a], [b]) => a.localeCompare(b))) {
    rows.push([lang, summary]);
  }
  return rows.map(([scope, summary]) => {
    const best = summary.bestF1 || {};
    return `| ${cell(scope)} | ${summary.n} | ${summary.positives} | ${summary.negatives} | ${optionalNum(summary.roc_auc)} | ${optionalNum(summary.pr_auc)} | ${optionalNum(best.threshold)} | ${optionalPct(best.precision)} | ${optionalPct(best.recall)} | ${optionalNum(best.f1, 2)} | ${optionalPct(best.accuracy)} |`;
  });
}

function lowFprRows(ranking = {}) {
  const scopes = [];
  if (ranking.overall) scopes.push(['overall', ranking.overall]);
  for (const [lang, summary] of Object.entries(ranking.perLanguage || {}).sort(([a], [b]) => a.localeCompare(b))) {
    scopes.push([lang, summary]);
  }
  const rows = [];
  for (const [scope, summary] of scopes) {
    for (const m of summary.low_fpr || []) {
      const tpr = m.tpr == null ? `n/a (${m.reason || 'unsupported'})` : optionalPct(m.tpr);
      const actual = m.actual_fpr == null ? 'n/a' : optionalPct(m.actual_fpr);
      rows.push(`| ${cell(scope)} | ${optionalPct(m.target_fpr)} | ${m.negatives} | ${m.max_false_positives} | ${actual} | ${tpr} |`);
    }
  }
  return rows;
}

function classRows(fixtures = []) {
  const counts = new Map();
  for (const f of fixtures) {
    const key = `${f.lang}\0${f.class}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, count]) => {
      const [lang, klass] = key.split('\0');
      return `| ${cell(lang)} | ${cell(klass)} | ${count} |`;
    });
}

function sampleSizeSummary(fixtures = []) {
  return fixtures.reduce((acc, f) => {
    const lang = f.lang || 'unknown';
    const klass = f.class || 'unknown';
    acc[lang] ||= {};
    acc[lang][klass] = (acc[lang][klass] || 0) + 1;
    return acc;
  }, {});
}

function fixtureRows(fixtures = []) {
  return fixtures.map((f) => {
    const hits = cell((f.lexicon_hits || []).slice(0, 4).join(', '));
    const koDiag = f.ko_diagnostics_hot
      ? `hot: ${(f.ko_diagnostics_reasons || []).join(', ')}`
      : 'cold';
    return `| ${cell(f.fixture_id)} | ${cell(f.lang)} | ${cell(f.class)} | ${bool(f.expected_hot)} | ${bool(f.predicted_hot)} | ${resultMark(f.correct)} | ${num(f.signal_score)} | ${num(f.cv)} ${cell(f.cv_band)} | ${num(f.mattr)} ${cell(f.mattr_band)} | ${num(f.lexicon_density)} | ${cell(koDiag)} | ${hits} |`;
  });
}

function misclassificationSection(fixtures = []) {
  const wrong = fixtures.filter((f) => !f.correct);
  if (wrong.length === 0) return 'All fixtures classified correctly.';
  return [
    '| fixture | lang | class | expected | predicted | cv | mattr | lexicon density |',
    '|---|---|---|---|---|---:|---:|---:|',
    ...wrong.map(
      (f) =>
        `| ${f.fixture_id} | ${f.lang} | ${f.class} | ${bool(f.expected_hot)} | ${bool(f.predicted_hot)} | ${num(f.cv)} ${f.cv_band || ''} | ${num(f.mattr)} ${f.mattr_band || ''} | ${num(f.lexicon_density)} |`
    ),
  ].join('\n');
}

// Render the report-only slice tables (B2). One sub-table per metadata
// dimension; below-minimum slices show counts with an `insufficient data`
// state; absent dimensions collapse to a single `unspecified` value.
function sliceSection(slices = {}) {
  const order = ['language', 'class', 'lengthBucket', 'domain', 'register', 'generator', 'edited'];
  const dims = order.filter((d) => slices[d]);
  for (const d of Object.keys(slices)) if (!dims.includes(d)) dims.push(d);
  const blocks = [];
  for (const dim of dims) {
    const { minCount, values } = slices[dim];
    const rows = Object.entries(values).map(([value, m]) => {
      const state = m.supported ? 'ok' : (m.reason || 'unsupported');
      return `| ${cell(value)} | ${m.n} | ${optionalPct(m.accuracy)} | ${optionalPct(m.precision)} | ${optionalPct(m.recall)} | ${optionalNum(m.f1)} | ${state} |`;
    });
    blocks.push([
      `### ${cell(dim)} (min ${minCount})`,
      '',
      '| value | n | accuracy | precision | recall | f1 | state |',
      '|---|---:|---:|---:|---:|---:|---|',
      rows.join('\n') || '| _(none)_ | 0 | — | — | — | — | — |',
    ].join('\n'));
  }
  return blocks.join('\n\n');
}

function renderMarkdown(results, benchmarkStatus) {
  const generatedAt = results.generatedAt || new Date().toISOString();
  const languages = Object.keys(results.perLanguage || {}).sort();
  const languageCount = languages.length;
  const languageList = languages.join(', ');
  const status = benchmarkStatus === 0 ? 'passing' : 'failing';
  const overall = results.overall || {
    accuracy: results.overallAccuracy,
    ci_low: null,
    ci_high: null,
    n: results.fixtureCount,
    confidence_method: 'unavailable',
  };

  return `# Benchmark Report

This is the latest checked-in report for patina's deterministic suspect-zone benchmark.

> Scope: this benchmark measures whether patina's stylometry layer flags fixture paragraphs as AI-like editing hotspots. It does **not** prove whether a real document was written by a human or by AI.

## Current result

- Status: **${status}**
- Generated at: ${generatedAt}
- Node: ${results.nodeVersion}
- Fixture schema: v${results.fixtureSchemaVersion}
- Fixtures: ${results.fixtureCount}
- Languages: ${languageCount} (${languageList})
- Overall accuracy: **${pct(overall.accuracy)}** [${pct(overall.ci_low)}–${pct(overall.ci_high)}] (n=${overall.n}, ${overall.confidence_method})
- Source fixtures: \`tests/fixtures/suspect-zones/**\`
- Regression ranges: \`tests/fixtures/suspect-zones/expected-ranges.json\` (refresh with \`npm run benchmark:ranges\`)
- Reproduce: \`npm run benchmark:report\`
- Raw JSON: [latest.json](latest.json)
- Detector comparison protocol: [detector-comparison.md](detector-comparison.md)
- 2025+ re-baseline plan: [docs/research/2025-rebaseline-plan.md](../research/2025-rebaseline-plan.md)

## Language breakdown

| lang | fixtures | accuracy | 95% CI | precision | recall | f1 | TP | FP | FN | TN |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${languageRows(results.perLanguage).join('\n')}

## Detector breakdown

| lang | detector | fixtures | accuracy | 95% CI | precision | recall | f1 | TP | FP | FN | TN |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${detectorRows(results.perLanguage).join('\n')}

## Ranking diagnostics

Signal-score ranking shows whether the diagnostic \`signal_score\` separates hot
fixtures from natural fixtures before any threshold is chosen. It is computed
only on the checked-in fixture corpus and is not a broader model-era claim.

| scope | fixtures | positives | negatives | ROC-AUC | PR-AUC | best threshold | precision | recall | best F1 | accuracy |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${rankingRows(results.ranking).join('\n')}

## Low-FPR operating points

TPR at a fixed false-positive budget. Aggregate AUROC/accuracy can hide
deployment failure, so these report the strict operating point on the checked-in
fixture corpus. \`n/a\` marks a slice without enough negatives (or positives) to
support the target; \`max FP\` of 0 is a strict zero-false-positive point.

| scope | target FPR | negatives | max FP | actual FPR | TPR |
|---|---:|---:|---:|---:|---:|
${lowFprRows(results.ranking).join('\n')}

## Slice metrics

Report-only confusion metrics grouped by metadata dimension. \`language\`,
\`class\`, and \`lengthBucket\` are derived from current fixtures; \`domain\`,
\`register\`, \`generator\`, and \`edited\` collapse to \`unspecified\` until the
corpus carries that metadata. Slices below the per-dimension minimum count are
reported as \`insufficient data\` (counts only). No detector thresholds change.

${sliceSection(results.slices)}

## Sample sizes

| lang | class | fixtures |
|---|---|---:|
${classRows(results.fixtures).join('\n')}

## Misclassifications

${misclassificationSection(results.fixtures)}

## Fixture log

| fixture | lang | class | expected | predicted | ok | signal | CV band | MATTR band | lexicon/1k | KO diagnostic | sample lexicon hits |
|---|---|---|---|---|---:|---:|---:|---:|---:|---|---|
${fixtureRows(results.fixtures).join('\n')}

## How to read this

- **Hot** means at least one deterministic signal crossed the benchmark threshold: low burstiness CV, low MATTR, AI-lexicon density, or the conservative Korean diagnostic composite.
- **Cold** means the fixture did not cross those thresholds.
- **Signal** is the 0–100 diagnostic strength of the strongest deterministic trigger. It supports ranking diagnostics but does not replace the binary hot/cold regression gate.
- The report is meant for regression tracking and contributor discussion, not for authorship accusation.
- This deterministic corpus is intentionally small (${results.fixtureCount} fixtures across ${languageList}); do not treat 100% fixture accuracy as generalization to new models, genres, or edited AI text.
- Confidence intervals use Wilson score intervals for the checked-in fixture set; external threshold sweeps and 2025+ model rebaselines are separate research follow-ups tracked in [2025+ Re-baseline Plan](../research/2025-rebaseline-plan.md).
- Broader methodology notes live in [AI/Human Metrics Research](../research/ai-human-metrics.md) and [Quality Checks](../../tests/quality/README.md).
`;
}

function main() {
  let benchmarkStatus = 0;
  if (runBenchmarkFirst) benchmarkStatus = runBenchmark();

  const results = readResults();
  if (!runBenchmarkFirst) benchmarkStatus = statusFromResults(results);

  const report = {
    reportVersion: 3,
    benchmarkCommand: benchmarkCommand.join(' '),
    benchmarkStatus,
    note: 'Deterministic suspect-zone benchmark; not an authorship detector.',
    regressionRanges: 'tests/fixtures/suspect-zones/expected-ranges.json',
    ...results,
    sampleSizes: sampleSizeSummary(results.fixtures),
  };

  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(JSON_PATH, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(MARKDOWN_PATH, renderMarkdown(results, benchmarkStatus));

  console.log(`Wrote ${relative(REPO_ROOT, MARKDOWN_PATH)}`);
  console.log(`Wrote ${relative(REPO_ROOT, JSON_PATH)}`);

  if (benchmarkStatus !== 0) process.exitCode = benchmarkStatus;
}

const isDirectRun = process.argv[1]
  ? resolve(process.cwd(), process.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isDirectRun) main();

export { renderMarkdown, validateResultsSchema };
