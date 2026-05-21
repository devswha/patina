#!/usr/bin/env node
// Private KatFish calibration runner for the Korean diagnostic layer.
//
// The KatFish repository currently has no detected license metadata, so this
// script reads raw KatFish JSONL only from a local/private directory and writes
// aggregate metrics only. Do not commit the downloaded dataset rows.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzeText } from '../src/features/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

export const DEFAULT_KATFISH_DIR = 'artifacts/rebaseline-2025/private/katfish';
export const DEFAULT_HUMAN_CONTROLS =
  'artifacts/rebaseline-2025/private/web-human-controls.generated.private.jsonl';
export const DEFAULT_REPORT_DIR = 'docs/benchmarks';
export const DEFAULT_REPORT_BASENAME = 'katfish-ko-latest';
export const KATFISH_FILES = ['essay.jsonl', 'abstract.jsonl', 'poetry.jsonl'];

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    katfishDir: DEFAULT_KATFISH_DIR,
    humanControls: DEFAULT_HUMAN_CONTROLS,
    reportDir: DEFAULT_REPORT_DIR,
    basename: DEFAULT_REPORT_BASENAME,
    write: false,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--katfish-dir') args.katfishDir = argv[++i];
    else if (arg === '--human-controls') args.humanControls = argv[++i];
    else if (arg === '--report-dir') args.reportDir = argv[++i];
    else if (arg === '--basename') args.basename = argv[++i];
    else if (arg === '--write') args.write = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

export function loadKatfishRows(katfishDir = DEFAULT_KATFISH_DIR) {
  const base = resolveRepoPath(katfishDir);
  const rows = [];
  const errors = [];

  for (const fileName of KATFISH_FILES) {
    const genre = fileName.replace(/\.jsonl$/u, '');
    const path = resolve(base, fileName);
    if (!existsSync(path)) {
      errors.push(`missing KatFish file: ${toRepoRelative(path)}`);
      continue;
    }

    const lines = readFileSync(path, 'utf8').split(/\r?\n/u);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index].trim();
      if (!line) continue;
      const lineNumber = index + 1;
      try {
        const raw = JSON.parse(line);
        rows.push(normalizeKatfishRow(raw, { genre, lineNumber, path }));
      } catch (error) {
        errors.push(`${toRepoRelative(path)}:${lineNumber}: ${error.message}`);
      }
    }
  }

  return { rows, errors, path: toRepoRelative(base) };
}

export function loadHumanControlRows(input = DEFAULT_HUMAN_CONTROLS) {
  const path = resolveRepoPath(input);
  const rows = [];
  const errors = [];
  if (!existsSync(path)) {
    return {
      rows,
      errors: [`human-control private input not found: ${toRepoRelative(path)}`],
      path: toRepoRelative(path),
    };
  }

  const lines = readFileSync(path, 'utf8').split(/\r?\n/u);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    const lineNumber = index + 1;
    try {
      const raw = JSON.parse(line);
      if (typeof raw.text !== 'string' || raw.text.trim() === '') {
        throw new Error('human-control row requires private text');
      }
      rows.push({
        id: raw.sample_id || `human-control-${lineNumber}`,
        register: raw.register || 'unknown',
        text: raw.text,
        expectedHot: false,
      });
    } catch (error) {
      errors.push(`${toRepoRelative(path)}:${lineNumber}: ${error.message}`);
    }
  }

  return { rows, errors, path: toRepoRelative(path) };
}

export function normalizeKatfishRow(raw, { genre, lineNumber, path } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('KatFish row must be a JSON object');
  }
  if (typeof raw.text !== 'string' || raw.text.trim() === '') {
    throw new Error('KatFish row requires text');
  }
  const label = Number(raw.label);
  if (label !== 0 && label !== 1) {
    throw new Error('KatFish label must be 0 (human) or 1 (generated)');
  }

  return {
    id: `${genre || 'katfish'}:${raw.index ?? lineNumber ?? '?'}`,
    genre: genre || 'unknown',
    model: String(raw.written_by || (label === 0 ? 'human' : 'unknown-model')),
    sourcePath: path ? toRepoRelative(path) : null,
    text: raw.text,
    expectedHot: label === 1,
  };
}

export function evaluateCalibration({ katfishRows = [], humanControlRows = [], repoRoot = REPO_ROOT } = {}) {
  const modes = [
    { id: 'burstiness_mattr_only', label: 'Burstiness+MATTR only' },
    { id: 'patina_without_ko_diagnostics', label: 'Patina without KO diagnostics' },
    { id: 'patina_current', label: 'Patina current' },
  ];

  const katfish = scoreRows(katfishRows, { repoRoot });
  const humanControls = scoreRows(humanControlRows, { repoRoot });
  const katfishMetrics = Object.fromEntries(
    modes.map((mode) => [mode.id, summarizeConfusion(katfish, mode.id)])
  );
  const humanControlMetrics = Object.fromEntries(
    modes.map((mode) => [mode.id, summarizeConfusion(humanControls, mode.id)])
  );

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    inputs: {
      katfishRows: katfishRows.length,
      humanControlRows: humanControlRows.length,
    },
    modes,
    katfish: {
      counts: countsBy(katfishRows, ['genre', 'model', 'expectedHot']),
      metrics: katfishMetrics,
      byGenre: summarizeGroups(katfish, 'genre', modes),
      byModel: summarizeGroups(katfish, 'model', modes),
    },
    humanControls: {
      counts: countsBy(humanControlRows, ['register']),
      metrics: humanControlMetrics,
      byRegister: summarizeGroups(humanControls, 'register', modes),
    },
    deltas: {
      currentVsBurstinessMattr: delta(katfishMetrics.patina_current, katfishMetrics.burstiness_mattr_only),
      currentVsNoKoDiagnostics: delta(
        katfishMetrics.patina_current,
        katfishMetrics.patina_without_ko_diagnostics
      ),
      humanFpCurrentVsNoKoDiagnostics: deltaFp(
        humanControlMetrics.patina_current,
        humanControlMetrics.patina_without_ko_diagnostics
      ),
    },
  };
}

export function renderMarkdownReport(summary, context = {}) {
  const lines = [
    '# KatFish Korean Calibration',
    '',
    '| field | value |',
    '|---|---:|',
    `| Generated at | ${summary.generatedAt} |`,
    `| KatFish input | \`${context.katfishPath || DEFAULT_KATFISH_DIR}\` |`,
    `| Human-control input | \`${context.humanControlsPath || DEFAULT_HUMAN_CONTROLS}\` |`,
    `| KatFish rows | ${summary.inputs.katfishRows} |`,
    `| Public-web human-control rows | ${summary.inputs.humanControlRows} |`,
    '| Raw text committed | 0 |',
    '',
    'This report is aggregate-only. KatFish rows and public-web extracts stay in ignored private files because the external dataset and source pages have not been relicensed into this repository.',
    '',
    '## Headline',
    '',
    '| metric | value |',
    '|---|---:|',
    `| KatFish catch rate, Patina without KO diagnostics | ${pct(summary.katfish.metrics.patina_without_ko_diagnostics.recall)} |`,
    `| KatFish catch rate, Patina current | ${pct(summary.katfish.metrics.patina_current.recall)} |`,
    `| Delta | ${pp(summary.deltas.currentVsNoKoDiagnostics.recall)} |`,
    `| Public-web human-control FP delta | ${pp(summary.deltas.humanFpCurrentVsNoKoDiagnostics.fpr)} (${summary.deltas.humanFpCurrentVsNoKoDiagnostics.fp} rows) |`,
    '',
    '## KatFish metrics',
    '',
    metricsTable(summary.katfish.metrics),
    '',
    '## Public-web Korean human controls',
    '',
    metricsTable(summary.humanControls.metrics),
    '',
    '## KatFish by genre',
    '',
    groupTable(summary.katfish.byGenre, 'genre'),
    '',
    '## Public-web controls by register',
    '',
    groupTable(summary.humanControls.byRegister, 'register'),
    '',
    '## Interpretation',
    '',
    '- The KO diagnostics layer is evaluated against `patina_without_ko_diagnostics`, so the delta isolates the spacing/comma/suffix proxy path from existing lexicon behavior.',
    '- The human-control non-regression gate uses the 250-row hash-only public-web Korean control set from #157.',
    '- KatFish human rows are reported in the KatFish table as an OOD caveat; do not turn this binary catch-rate report into an authorship or public AUROC claim.',
  ];

  return lines.join('\n') + '\n';
}

export function writeReport(summary, options = {}) {
  const reportDir = resolveRepoPath(options.reportDir || DEFAULT_REPORT_DIR);
  mkdirSync(reportDir, { recursive: true });
  const basename = options.basename || DEFAULT_REPORT_BASENAME;
  const mdPath = resolve(reportDir, `${basename}.md`);
  const jsonPath = resolve(reportDir, `${basename}.json`);
  writeFileSync(mdPath, renderMarkdownReport(summary, options), 'utf8');
  writeFileSync(jsonPath, JSON.stringify(summary, null, 2) + '\n', 'utf8');
  return { markdown: toRepoRelative(mdPath), json: toRepoRelative(jsonPath) };
}

function scoreRows(rows, { repoRoot }) {
  return rows.map((row) => {
    const current = analyzeText(row.text, { lang: 'ko', repoRoot });
    const noKoDiagnostics = analyzeText(row.text, {
      lang: 'ko',
      repoRoot,
      koDiagnosticsEnabled: false,
    });
    const burstinessMattrOnly = current.paragraphs.some(
      (paragraph) =>
        paragraph.burstiness?.band === 'low' ||
        paragraph.mattr?.band === 'low'
    );

    return {
      id: row.id,
      genre: row.genre,
      register: row.register,
      model: row.model,
      expectedHot: Boolean(row.expectedHot),
      predictions: {
        burstiness_mattr_only: burstinessMattrOnly,
        patina_without_ko_diagnostics: Boolean(noKoDiagnostics.hot),
        patina_current: Boolean(current.hot),
      },
    };
  });
}

function summarizeGroups(rows, key, modes) {
  const groups = [...new Set(rows.map((row) => row[key] || 'unknown'))].sort();
  return Object.fromEntries(
    groups.map((group) => [
      group,
      Object.fromEntries(
        modes.map((mode) => [
          mode.id,
          summarizeConfusion(rows.filter((row) => (row[key] || 'unknown') === group), mode.id),
        ])
      ),
    ])
  );
}

function summarizeConfusion(rows, mode) {
  const counts = { tp: 0, fp: 0, fn: 0, tn: 0, total: rows.length };
  for (const row of rows) {
    const predicted = Boolean(row.predictions?.[mode]);
    if (predicted && row.expectedHot) counts.tp++;
    else if (predicted && !row.expectedHot) counts.fp++;
    else if (!predicted && row.expectedHot) counts.fn++;
    else counts.tn++;
  }
  const precision = counts.tp + counts.fp ? counts.tp / (counts.tp + counts.fp) : 0;
  const recall = counts.tp + counts.fn ? counts.tp / (counts.tp + counts.fn) : 0;
  const fpr = counts.fp + counts.tn ? counts.fp / (counts.fp + counts.tn) : 0;
  const accuracy = counts.total ? (counts.tp + counts.tn) / counts.total : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return {
    ...counts,
    accuracy: round(accuracy),
    precision: round(precision),
    recall: round(recall),
    f1: round(f1),
    fpr: round(fpr),
  };
}

function delta(current, baseline) {
  return {
    accuracy: round(current.accuracy - baseline.accuracy),
    precision: round(current.precision - baseline.precision),
    recall: round(current.recall - baseline.recall),
    f1: round(current.f1 - baseline.f1),
    fpr: round(current.fpr - baseline.fpr),
    tp: current.tp - baseline.tp,
    fp: current.fp - baseline.fp,
    fn: current.fn - baseline.fn,
    tn: current.tn - baseline.tn,
  };
}

function deltaFp(current, baseline) {
  return {
    fpr: round(current.fpr - baseline.fpr),
    fp: current.fp - baseline.fp,
  };
}

function countsBy(rows, fields) {
  const out = {};
  for (const field of fields) {
    out[field] = {};
    for (const row of rows) {
      const raw = row[field];
      const value = typeof raw === 'boolean' ? String(raw) : raw || 'unknown';
      out[field][value] = (out[field][value] || 0) + 1;
    }
  }
  return out;
}

function metricsTable(metrics) {
  const lines = [
    '| mode | n | accuracy | precision | recall / catch | F1 | FP rate | TP/FP/FN/TN |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const [mode, m] of Object.entries(metrics)) {
    lines.push(
      `| ${cell(mode)} | ${m.total} | ${pct(m.accuracy)} | ${pct(m.precision)} | ${pct(m.recall)} | ${m.f1.toFixed(3)} | ${pct(m.fpr)} | ${m.tp}/${m.fp}/${m.fn}/${m.tn} |`
    );
  }
  return lines.join('\n');
}

function groupTable(groups, label) {
  const lines = [
    `| ${label} | mode | n | recall / catch | FP rate | TP/FP/FN/TN |`,
    '|---|---|---:|---:|---:|---:|',
  ];
  for (const [group, metrics] of Object.entries(groups)) {
    for (const [mode, m] of Object.entries(metrics)) {
      lines.push(
        `| ${cell(group)} | ${cell(mode)} | ${m.total} | ${pct(m.recall)} | ${pct(m.fpr)} | ${m.tp}/${m.fp}/${m.fn}/${m.tn} |`
      );
    }
  }
  return lines.join('\n');
}

function pct(value) {
  return `${((value || 0) * 100).toFixed(1)}%`;
}

function pp(value) {
  const n = (value || 0) * 100;
  return `${n >= 0 ? '+' : ''}${n.toFixed(1)} pp`;
}

function cell(value) {
  return String(value ?? '—').replace(/\|/gu, '\\|').replace(/\s+/gu, ' ').trim() || '—';
}

function round(value, digits = 3) {
  return Math.round((value || 0) * 10 ** digits) / 10 ** digits;
}

function resolveRepoPath(path) {
  return resolve(REPO_ROOT, path || '.');
}

function toRepoRelative(path) {
  return relative(REPO_ROOT, path).replace(/\\/gu, '/') || '.';
}

function printHelp() {
  console.log(`Usage: node scripts/katfish-calibration.mjs [options]

Options:
  --katfish-dir <path>      Private directory containing essay/abstract/poetry JSONL
  --human-controls <path>   Private public-web human-control JSONL with text
  --write                   Write docs/benchmarks/<basename>.{md,json}
  --basename <name>         Report basename (default: ${DEFAULT_REPORT_BASENAME})
  --report-dir <path>       Report directory (default: ${DEFAULT_REPORT_DIR})
  --json                    Print JSON summary instead of Markdown
  -h, --help                Show this help
`);
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    return;
  }

  const katfish = loadKatfishRows(args.katfishDir);
  const humanControls = loadHumanControlRows(args.humanControls);
  const errors = [...katfish.errors, ...humanControls.errors];
  if (errors.length) {
    console.error(errors.map((error) => `- ${error}`).join('\n'));
    process.exitCode = 1;
    return;
  }

  const summary = evaluateCalibration({
    katfishRows: katfish.rows,
    humanControlRows: humanControls.rows,
  });

  let written = null;
  if (args.write) {
    written = writeReport(summary, {
      reportDir: args.reportDir,
      basename: args.basename,
      katfishPath: katfish.path,
      humanControlsPath: humanControls.path,
    });
  }

  if (args.json) {
    console.log(JSON.stringify({ ...summary, written }, null, 2));
  } else {
    console.log(renderMarkdownReport(summary, {
      katfishPath: katfish.path,
      humanControlsPath: humanControls.path,
    }));
    if (written) {
      console.log(`Wrote ${written.markdown}`);
      console.log(`Wrote ${written.json}`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
