#!/usr/bin/env node
// Score local/private rebaseline rows with the deterministic analyzer.
//
// The input may contain raw text. The output is always public-safe metadata:
// text is stripped, text_hash is preserved/computed, and only score/outcome
// fields are added.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzeText } from '../src/features/index.js';
import { hashText, validateRecord } from './rebaseline-summary.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

export const DEFAULT_SCORE_INPUT = 'artifacts/rebaseline-2025/private/generations.private.jsonl';
export const DEFAULT_SCORE_OUTPUT = 'artifacts/rebaseline-2025/manifest.scored.public.jsonl';

const POSITIVE_CLASSES = new Set(['ai-like', 'lightly-edited-ai', 'heavily-edited-ai']);

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    input: DEFAULT_SCORE_INPUT,
    output: DEFAULT_SCORE_OUTPUT,
    scoredAt: null,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input') args.input = argv[++i];
    else if (arg === '--output') args.output = argv[++i];
    else if (arg === '--scored-at') args.scoredAt = argv[++i];
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

export function loadScoreRows(inputPath = DEFAULT_SCORE_INPUT) {
  const abs = resolveRepoPath(inputPath);
  const result = {
    path: abs,
    relativePath: toRepoRelative(abs),
    rows: [],
    errors: [],
  };

  if (!existsSync(abs)) {
    result.errors.push(`score input not found: ${result.relativePath}`);
    return result;
  }

  const lines = readFileSync(abs, 'utf8').split(/\r?\n/u);
  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const line = lines[index].trim();
    if (!line) continue;

    try {
      result.rows.push({ lineNumber, value: JSON.parse(line) });
    } catch (error) {
      result.errors.push(`line ${lineNumber}: invalid JSON (${error.message})`);
    }
  }

  return result;
}

export function scoreRows(rows, options = {}) {
  const publicRecords = [];
  const errors = [];
  const warnings = [];

  for (const row of rows) {
    const lineNumber = row.lineNumber ?? '?';
    const raw = row.value;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(`line ${lineNumber}: record must be a JSON object`);
      continue;
    }

    const label = raw.sample_id ? `line ${lineNumber} (${raw.sample_id})` : `line ${lineNumber}`;
    if (typeof raw.text !== 'string' || raw.text.length === 0) {
      errors.push(`${label}: scoring requires local text`);
      continue;
    }

    const record = { ...raw };
    const observedHash = hashText(record.text);
    if (record.text_hash && record.text_hash !== observedHash) {
      errors.push(`${label}: text_hash mismatch: expected ${observedHash}`);
      continue;
    }
    record.text_hash = observedHash;

    const analysis = analyzeText(record.text, {
      lang: record.language || 'en',
      repoRoot: options.repoRoot || REPO_ROOT,
    });

    const publicRecord = { ...record };
    delete publicRecord.text;

    const checked = validateRecord(publicRecord);
    warnings.push(...checked.warnings.map((message) => `${label}: ${message}`));
    if (checked.errors.length) {
      errors.push(...checked.errors.map((message) => `${label}: ${message}`));
      continue;
    }

    const scoredRecord = {
      ...checked.record,
      expected_hot: POSITIVE_CLASSES.has(checked.record.class),
      predicted_hot: Boolean(analysis.hot),
      patina_score: scoreFromAnalysis(analysis),
      score_review: scoreReview(analysis, options),
    };

    const finalCheck = validateRecord(scoredRecord);
    warnings.push(...finalCheck.warnings.map((message) => `${label}: ${message}`));
    if (finalCheck.errors.length) {
      errors.push(...finalCheck.errors.map((message) => `${label}: ${message}`));
      continue;
    }

    publicRecords.push(finalCheck.record);
  }

  return { publicRecords, errors, warnings };
}

export function processScore(options = {}) {
  const loaded = loadScoreRows(options.input || DEFAULT_SCORE_INPUT);
  if (loaded.errors.length) {
    return {
      input: loaded.relativePath,
      publicRecords: [],
      errors: loaded.errors,
      warnings: [],
    };
  }

  return {
    input: loaded.relativePath,
    ...scoreRows(loaded.rows, options),
  };
}

export function writeScoreOutput(result, options = {}) {
  if (result.errors.length) {
    throw new Error('refusing to write invalid rebaseline score output');
  }

  const output = options.output || DEFAULT_SCORE_OUTPUT;
  const outputPath = resolveRepoPath(output);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(
    outputPath,
    result.publicRecords.map((record) => JSON.stringify(record)).join('\n') + (result.publicRecords.length ? '\n' : '')
  );

  return { output: toRepoRelative(outputPath) };
}

export function renderScoreSummary(result, written = null) {
  const hot = result.publicRecords.filter((record) => record.predicted_hot).length;
  const lines = [
    '# Rebaseline Score Summary',
    '',
    `- Input: \`${result.input || 'not recorded'}\``,
    `- Public rows: ${result.publicRecords.length}`,
    `- Predicted hot rows: ${hot}`,
    `- Validation: **${result.errors.length ? 'FAIL' : 'PASS'}**`,
  ];

  if (written) lines.push(`- Public output: \`${written.output}\``);
  if (result.errors.length) lines.push('', '## Errors', ...result.errors.map((error) => `- ${escapeMarkdown(error)}`));
  if (result.warnings.length) lines.push('', '## Warnings', ...result.warnings.map((warning) => `- ${escapeMarkdown(warning)}`));

  return `${lines.join('\n')}\n`;
}

function scoreFromAnalysis(analysis) {
  const total = analysis.paragraphs.length;
  if (!total) return 0;
  const hot = analysis.paragraphs.filter((paragraph) => paragraph.hot).length;
  return Math.round((hot / total) * 1000) / 10;
}

function scoreReview(analysis, options = {}) {
  const review = {
    scorer: 'patina deterministic analyzer',
    paragraph_count: analysis.paragraphs.length,
    hot_paragraph_count: analysis.paragraphs.filter((paragraph) => paragraph.hot).length,
    trigger_counts: triggerCounts(analysis),
  };
  if (options.scoredAt) review.scored_at = options.scoredAt;
  if (analysis.skipReason) review.skip_reason = analysis.skipReason;
  return review;
}

function triggerCounts(analysis) {
  const counts = {
    burstiness_low: 0,
    mattr_low: 0,
    lexicon_hot: 0,
    ko_diagnostics_hot: 0,
    ko_ending_monotony: 0,
  };

  for (const paragraph of analysis.paragraphs) {
    if (paragraph.burstiness?.band === 'low') counts.burstiness_low++;
    if (paragraph.mattr?.band === 'low') counts.mattr_low++;
    if (paragraph.lexicon?.hot) counts.lexicon_hot++;
    if (paragraph.koDiagnostics?.hot) counts.ko_diagnostics_hot++;
    if (paragraph.endingMonotonyHot) counts.ko_ending_monotony++;
  }

  return counts;
}

function resolveRepoPath(path) {
  return resolve(REPO_ROOT, path);
}

function toRepoRelative(path) {
  return relative(REPO_ROOT, path) || path;
}

function escapeMarkdown(value) {
  return String(value ?? '').replace(/\|/gu, '\\|').replace(/\n/gu, ' ');
}

function printHelp() {
  console.log(`Usage: node scripts/rebaseline-score.mjs --input <private.jsonl> --output <public.jsonl> [--scored-at <date>] [--json]

Scores local/private rebaseline rows with the deterministic analyzer and writes
a public-safe JSONL manifest. The output never includes raw text.
Default input: ${DEFAULT_SCORE_INPUT}
Default output: ${DEFAULT_SCORE_OUTPUT}`);
}

function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    return;
  }

  const result = processScore(args);
  const written = result.errors.length === 0 ? writeScoreOutput(result, { output: args.output }) : null;

  if (args.json) {
    console.log(JSON.stringify({ ...result, written }, null, 2));
  } else {
    console.log(renderScoreSummary(result, written));
  }

  if (result.errors.length) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
