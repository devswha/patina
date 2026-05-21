#!/usr/bin/env node
// Offline detector-comparison protocol for the suspect-zone benchmark.
//
// Default mode compares Patina's deterministic in-tree analyzer against the
// checked-in fixture labels. Pass --input <manual-results.json> to merge scores
// copied manually from third-party tools. The script never scrapes websites,
// never sends text to external services, and never reads secrets.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const RESULTS_PATH = resolve(REPO_ROOT, 'tests/quality/results.json');
const REPORT_DIR = resolve(REPO_ROOT, 'docs/benchmarks');
const JSON_PATH = resolve(REPORT_DIR, 'detector-comparison.json');
const MARKDOWN_PATH = resolve(REPORT_DIR, 'detector-comparison.md');

const args = parseArgs(process.argv.slice(2));

function parseArgs(argv) {
  const out = { runBenchmark: true, input: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--no-run') out.runBenchmark = false;
    else if (arg === '--input') out.input = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function runBenchmark() {
  const result = spawnSync(process.execPath, ['tests/quality/benchmark.mjs', '--quiet'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);
}

function readBenchmarkResults() {
  const results = JSON.parse(readFileSync(RESULTS_PATH, 'utf8'));
  if (results?.schemaVersion !== 3 || !Array.isArray(results?.fixtures)) {
    throw new Error(`${relative(REPO_ROOT, RESULTS_PATH)} is not a benchmark schema v3 result`);
  }
  return results;
}

function normalizeLabel(row) {
  if (typeof row.predicted_hot === 'boolean') return row.predicted_hot;
  if (typeof row.label === 'string') {
    const label = row.label.toLowerCase();
    if (['hot', 'ai', 'ai-like', 'suspect', 'generated'].includes(label)) return true;
    if (['cold', 'human', 'natural', 'not-ai', 'clean'].includes(label)) return false;
  }
  throw new Error(`Manual result for ${row.fixture_id}/${row.detector} needs predicted_hot boolean or label hot|cold`);
}

function readManualInput(path) {
  if (!path) return null;
  const abs = resolve(REPO_ROOT, path);
  if (!existsSync(abs)) throw new Error(`Manual detector input not found: ${path}`);
  const manual = JSON.parse(readFileSync(abs, 'utf8'));
  if (manual?.schemaVersion !== 1) throw new Error(`${path}: expected schemaVersion=1`);
  if (!Array.isArray(manual.detectors)) throw new Error(`${path}: detectors must be an array`);
  if (!Array.isArray(manual.results)) throw new Error(`${path}: results must be an array`);
  return { path: abs, ...manual };
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

function summarize(m, fixtureCount) {
  const precision = m.tp + m.fp ? m.tp / (m.tp + m.fp) : 0;
  const recall = m.tp + m.fn ? m.tp / (m.tp + m.fn) : 0;
  const accuracy = m.total ? (m.tp + m.tn) / m.total : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    ...m,
    fixtureCount,
    coverage: fixtureCount ? round(m.total / fixtureCount) : 0,
    accuracy: round(accuracy),
    precision: round(precision),
    recall: round(recall),
    f1: round(f1),
  };
}

function round(n, digits = 3) {
  return Math.round(n * 10 ** digits) / 10 ** digits;
}

function pct(n) {
  return `${((n ?? 0) * 100).toFixed(1)}%`;
}

function cell(value) {
  return String(value ?? '—').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim() || '—';
}

function bool(value) {
  return value ? 'hot' : 'cold';
}

function builtInDetector(results) {
  return {
    detectors: [
      {
        id: 'patina-deterministic',
        name: 'Patina deterministic suspect-zone analyzer',
        kind: 'in-tree',
        mode: 'offline',
        threshold: 'burstiness low OR MATTR low OR lexicon density > threshold OR koDiagnostics hot',
      },
    ],
    rows: results.fixtures.map((fixture) => ({
      fixture_id: fixture.fixture_id,
      detector: 'patina-deterministic',
      predicted_hot: fixture.predicted_hot,
      score: fixture.predicted_hot ? 1 : 0,
      source: 'tests/quality/benchmark.mjs',
    })),
  };
}

function mergeRows(results, manual) {
  const fixtureById = Object.fromEntries(results.fixtures.map((f) => [f.fixture_id, f]));
  const builtIn = builtInDetector(results);
  const detectors = [...builtIn.detectors];
  const rows = [...builtIn.rows];
  if (manual) {
    const detectorIds = new Set(detectors.map((d) => d.id));
    for (const detector of manual.detectors) {
      if (!detector?.id) throw new Error('Manual detector missing id');
      if (!detectorIds.has(detector.id)) {
        detectors.push({ ...detector, kind: detector.kind || 'manual-third-party', mode: 'manual-offline' });
        detectorIds.add(detector.id);
      }
    }
    for (const row of manual.results) {
      if (!fixtureById[row.fixture_id]) throw new Error(`Unknown fixture_id in manual input: ${row.fixture_id}`);
      rows.push({
        ...row,
        predicted_hot: normalizeLabel(row),
        source: manual.runId || relative(REPO_ROOT, manual.path),
      });
    }
  }
  return { detectors, rows };
}

function computeSummaries(results, detectors, rows) {
  const fixtureById = Object.fromEntries(results.fixtures.map((f) => [f.fixture_id, f]));
  const byDetector = {};
  for (const detector of detectors) byDetector[detector.id] = emptyMetrics();
  const expandedRows = [];
  for (const row of rows) {
    const fixture = fixtureById[row.fixture_id];
    if (!fixture) continue;
    const expected = fixture.expected_hot;
    const predicted = Boolean(row.predicted_hot);
    byDetector[row.detector] ||= emptyMetrics();
    updateMetrics(byDetector[row.detector], predicted, expected);
    expandedRows.push({
      fixture_id: row.fixture_id,
      lang: fixture.lang,
      class: fixture.class,
      detector: row.detector,
      expected_hot: expected,
      predicted_hot: predicted,
      correct: predicted === expected,
      score: typeof row.score === 'number' ? row.score : null,
      source: row.source || null,
      notes: row.notes || null,
    });
  }
  return {
    summaries: Object.fromEntries(
      Object.entries(byDetector).map(([id, metrics]) => [id, summarize(metrics, results.fixtureCount)])
    ),
    rows: expandedRows,
  };
}

function detectorRows(detectors, summaries) {
  return detectors.map((d) => {
    const s = summaries[d.id] || summarize(emptyMetrics(), 0);
    return `| ${cell(d.id)} | ${cell(d.name)} | ${cell(d.kind)} | ${s.total}/${s.fixtureCount} | ${pct(s.coverage)} | ${pct(s.accuracy)} | ${pct(s.precision)} | ${pct(s.recall)} | ${s.tp} | ${s.fp} | ${s.fn} | ${s.tn} |`;
  });
}

function fixtureRows(rows) {
  return rows.map((r) => `| ${cell(r.fixture_id)} | ${cell(r.lang)} | ${cell(r.class)} | ${cell(r.detector)} | ${bool(r.expected_hot)} | ${bool(r.predicted_hot)} | ${r.correct ? '✓' : '✗'} | ${cell(r.score)} | ${cell(r.source)} |`);
}

function renderMarkdown(report) {
  return `# Detector Comparison Protocol

This report is generated offline from the checked-in suspect-zone fixtures. It is a comparison protocol, not a vendor ranking claim.

## Current run

- Generated at: ${report.generatedAt}
- Fixture source: \`tests/fixtures/suspect-zones/**\`
- Fixture count: ${report.fixtureCount}
- Manual third-party input: ${report.manualInput ? `\`${report.manualInput}\`` : 'none'}
- Reproduce built-in comparison: \`npm run benchmark:compare\`
- Merge manual scores: \`node scripts/detector-comparison.mjs --input tests/quality/detectors.manual.example.json\`

## Summary

| detector | name | kind | covered | coverage | accuracy | precision | recall | TP | FP | FN | TN |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
${detectorRows(report.detectors, report.summaries).join('\n')}

## Fixture-level rows

| fixture | lang | class | detector | expected | predicted | ok | score | source |
|---|---|---|---|---|---|---:|---:|---|
${fixtureRows(report.rows).join('\n')}

## Manual third-party protocol

1. Use only redistributable fixture text from \`tests/fixtures/suspect-zones/**\`.
2. Paste text into a third-party detector manually, respecting that service's terms.
3. Record only fixture id, detector id, date/version, score, and hot/cold label. Do not check private text into the repo.
4. Run this script with \`--input <json>\`. The script does not scrape sites or call external APIs.
5. Treat results as time-stamped evidence, not a universal claim about authorship detection.
`;
}

function main() {
  if (args.runBenchmark) runBenchmark();
  const results = readBenchmarkResults();
  const manual = readManualInput(args.input);
  const { detectors, rows } = mergeRows(results, manual);
  const computed = computeSummaries(results, detectors, rows);
  const report = {
    reportVersion: 1,
    generatedAt: new Date().toISOString(),
    fixtureCount: results.fixtureCount,
    benchmarkGeneratedAt: results.generatedAt,
    note: 'Offline comparison protocol. Built-in Patina row uses deterministic suspect-zone analyzer; third-party rows are manual opt-in only.',
    manualInput: manual ? relative(REPO_ROOT, manual.path) : null,
    detectors,
    summaries: computed.summaries,
    rows: computed.rows,
  };
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(JSON_PATH, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(MARKDOWN_PATH, renderMarkdown(report));
  console.log(`Wrote ${relative(REPO_ROOT, MARKDOWN_PATH)}`);
  console.log(`Wrote ${relative(REPO_ROOT, JSON_PATH)}`);
}

main();
