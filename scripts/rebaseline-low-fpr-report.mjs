#!/usr/bin/env node
// Manifest-based low-FPR (TPR@1%/5%FPR) report (Wave 0.3) — the B4 measure-only
// deliverable. Reads a scored rebaseline manifest JSONL and reports, per
// overall / language / language x register group, the strict operating point at
// each target FPR. REPORT-ONLY: it never changes a detector threshold and never
// mutates src/features. Reuses the B1 lowFprMetric core from ranking-metrics.
//
// Status values per group/target:
//   supported                      - a meaningful TPR@FPR operating point exists
//   no_negatives                   - no negative rows (cannot bound FPR)
//   no_positives                   - no positive rows (TPR undefined)
//   insufficient_negatives_for_1pct- negatives>0 but floor(target*negatives)==0
//   no_calibration_signal_yet      - perfect separation (TPR 1 at 0 FP): nothing to calibrate

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { lowFprSummaries, DEFAULT_LOW_FPR_TARGETS } from '../tests/quality/ranking-metrics.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const REPORT_DIR = resolve(REPO_ROOT, 'docs/benchmarks');
const SCHEMA_VERSION = 1;
const DEFAULT_BASENAME = 'rebaseline-low-fpr-latest';
const DEFAULT_SCORE_FIELD = 'patina_score';
// Exact sentence the report must print on a perfectly-separating group.
export const NO_SIGNAL_SENTENCE = 'no calibration signal yet — corpus not hard enough';

export function parseArgs(argv = process.argv.slice(2)) {
  const opts = { input: null, basename: DEFAULT_BASENAME, scoreField: DEFAULT_SCORE_FIELD, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--input') opts.input = takeValue(argv, (i += 1), '--input');
    else if (arg === '--basename') opts.basename = takeValue(argv, (i += 1), '--basename');
    else if (arg === '--score-field') opts.scoreField = takeValue(argv, (i += 1), '--score-field');
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!opts.input) throw new Error('--input <scored-manifest.jsonl> is required');
  return opts;
}

function takeValue(argv, index, flag) {
  const value = argv[index];
  if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

function loadRows(input) {
  return readFileSync(resolve(REPO_ROOT, input), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`line ${index + 1}: invalid JSON (${error.message})`);
      }
    });
}

// Layer the plan's extended status onto the B1 lowFprMetric result.
function withStatus(metric) {
  if (!metric.supported) return { ...metric, status: metric.reason };
  if (metric.target_fpr <= 0.01 && metric.max_false_positives === 0) {
    return { ...metric, status: 'insufficient_negatives_for_1pct' };
  }
  if (metric.tpr === 1 && metric.actual_fpr === 0) {
    return { ...metric, status: 'no_calibration_signal_yet' };
  }
  return { ...metric, status: 'supported' };
}

function summarizeGroup(rows, scoreField, targets) {
  const records = rows.map((row) => ({ score: Number(row[scoreField]), expected: Boolean(row.expected_hot) }));
  return lowFprSummaries(records, targets).map((metric) => withStatus({ ...metric, n: metric.positives + metric.negatives }));
}

// Pure: build the full report object from manifest rows.
export function buildLowFprReport(rows, { scoreField = DEFAULT_SCORE_FIELD, targets = DEFAULT_LOW_FPR_TARGETS, input = null } = {}) {
  const byLanguage = new Map();
  const byLanguageRegister = new Map();
  for (const row of rows) {
    const lang = row.language ?? 'unspecified';
    const register = row.register ?? 'unspecified';
    if (!byLanguage.has(lang)) byLanguage.set(lang, []);
    byLanguage.get(lang).push(row);
    const key = `${lang} × ${register}`;
    if (!byLanguageRegister.has(key)) byLanguageRegister.set(key, []);
    byLanguageRegister.get(key).push(row);
  }
  const sortedObject = (map) =>
    Object.fromEntries([...map.keys()].sort().map((key) => [key, summarizeGroup(map.get(key), scoreField, targets)]));

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    nodeVersion: process.version,
    note: 'Report-only manifest TPR@FPR operating points. Not a detector-threshold change and not a CI gate.',
    input,
    scoreField,
    targets,
    rowCount: rows.length,
    overall: summarizeGroup(rows, scoreField, targets),
    perLanguage: sortedObject(byLanguage),
    perLanguageRegister: sortedObject(byLanguageRegister),
  };
}

function pct(value) {
  return value == null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function metricRow(scope, m) {
  return `| ${scope} | ${pct(m.target_fpr)} | ${m.n} | ${m.positives} | ${m.negatives} | ${m.max_false_positives} | ${pct(m.actual_fpr)} | ${m.tpr == null ? 'n/a' : pct(m.tpr)} | ${m.status} |`;
}

function groupTable(title, scopeLabel, groups) {
  const header = '| scope | target FPR | n | pos | neg | max FP | actual FPR | TPR | status |\n|---|---:|---:|---:|---:|---:|---:|---:|---|';
  const rows = [];
  for (const [scope, metrics] of Object.entries(groups)) {
    for (const m of metrics) rows.push(metricRow(scopeLabel ? `${scope}` : scope, m));
  }
  return `### ${title}\n\n${header}\n${rows.join('\n')}`;
}

function hasNoSignal(report) {
  const groups = [report.overall, ...Object.values(report.perLanguage), ...Object.values(report.perLanguageRegister)];
  return groups.some((metrics) => metrics.some((m) => m.status === 'no_calibration_signal_yet'));
}

export function renderMarkdown(report) {
  const overallRows = report.overall.map((m) => metricRow('overall', m)).join('\n');
  const stall = hasNoSignal(report)
    ? `\n> Perfect separation detected on at least one group: **${NO_SIGNAL_SENTENCE}**. Collect harder samples before any calibration; thresholds stay unchanged.\n`
    : '';
  return `# Rebaseline Low-FPR Report (measure-only)

Report-only TPR at fixed false-positive budgets, by language and language×register.
**Not a detector-threshold change and not a CI gate.** A \`no_calibration_signal_yet\`
status means the corpus is too easy to expose an FP/FN trade-off, which is a valid
honest outcome.

- Generated at: ${report.generatedAt}
- Node: ${report.nodeVersion}
- Input manifest: ${report.input ?? 'n/a'}
- Score field: \`${report.scoreField}\`
- Rows: ${report.rowCount}
- Targets: ${report.targets.map((t) => pct(t)).join(', ')}
- Reproduce: \`npm run benchmark:rebaseline:low-fpr -- --input <manifest> [--basename <name>]\`
${stall}
## Overall

| scope | target FPR | n | pos | neg | max FP | actual FPR | TPR | status |
|---|---:|---:|---:|---:|---:|---:|---:|---|
${overallRows}

## By language

${groupTable('language', false, report.perLanguage)}

## By language × register

${groupTable('language × register', false, report.perLanguageRegister)}
`;
}

export function writeReport(report, basename = DEFAULT_BASENAME) {
  const jsonPath = resolve(REPORT_DIR, `${basename}.json`);
  const mdPath = resolve(REPORT_DIR, `${basename}.md`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');
  writeFileSync(mdPath, renderMarkdown(report));
  return { jsonPath, mdPath };
}

function main() {
  const opts = parseArgs();
  const rows = loadRows(opts.input);
  const report = buildLowFprReport(rows, { scoreField: opts.scoreField, targets: DEFAULT_LOW_FPR_TARGETS, input: opts.input });
  const { jsonPath, mdPath } = writeReport(report, opts.basename);
  if (opts.json) {
    console.log(JSON.stringify({ jsonPath, mdPath, rowCount: report.rowCount }));
  } else {
    console.log(`Wrote ${jsonPath}`);
    console.log(`Wrote ${mdPath}`);
  }
}

const isDirectRun = process.argv[1]
  ? resolve(process.cwd(), process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (isDirectRun) main();
