#!/usr/bin/env node
import { formatMarkdownReport, scoreFiles, summarizeRows } from './prose-score.mjs';

function parseArgs(argv) {
  const out = { files: [], gate: 30, lang: 'auto', maxFiles: 200 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--gate' || arg === '--score-threshold') out.gate = Number(argv[++i]);
    else if (arg === '--lang') out.lang = argv[++i] || 'auto';
    else if (arg === '--max-files') out.maxFiles = Number(argv[++i]);
    else if (!arg.startsWith('-')) out.files.push(arg);
  }
  if (!Number.isFinite(out.gate) || out.gate < 0 || out.gate > 100) {
    throw new Error(`--gate expects a number from 0 to 100, got ${out.gate}`);
  }
  return out;
}

try {
  const opts = parseArgs(process.argv.slice(2));
  const rows = scoreFiles(opts.files, opts);
  const summary = summarizeRows(rows);
  console.log(formatMarkdownReport(rows, { gate: opts.gate, title: 'Patina pre-commit prose score' }));
  if (summary.failedCount > 0) {
    console.error(`\npatina-score: ${summary.failedCount}/${summary.fileCount} file(s) exceeded gate ${opts.gate}.`);
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`patina-score: ${error.message}`);
  process.exitCode = 2;
}
