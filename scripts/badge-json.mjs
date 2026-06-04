#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scoreFiles, summarizeRows } from './prose-score.mjs';

export function badgeBand(maxScore = 0) {
  const score = Number(maxScore);
  if (!Number.isFinite(score)) return { text: 'human-ish', color: 'brightgreen' };
  if (score <= 30) return { text: 'human-ish', color: 'brightgreen' };
  if (score <= 50) return { text: 'mixed', color: 'yellow' };
  return { text: 'ai-like', color: 'red' };
}

export function formatBadgeScore(maxScore = 0) {
  const score = Number(maxScore);
  return `${Math.round(Number.isFinite(score) ? score : 0)}%`;
}

export function toShieldsEndpoint(summary, { label = 'patina' } = {}) {
  const maxScore = summary?.maxScore ?? 0;
  const band = badgeBand(maxScore);
  return {
    schemaVersion: 1,
    label,
    message: `${formatBadgeScore(maxScore)} · ${band.text}`,
    color: band.color,
  };
}

export function parseArgs(argv) {
  const opts = {
    files: [],
    gate: 30,
    lang: 'auto',
    maxFiles: 50,
    label: 'patina',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--score-threshold') opts.gate = Number(argv[++i]);
    else if (arg === '--lang') opts.lang = argv[++i] || 'auto';
    else if (arg === '--max-files') opts.maxFiles = Number(argv[++i]);
    else if (arg === '--label') opts.label = argv[++i] || 'patina';
    else if (arg.startsWith('-')) throw new Error(`unknown option ${arg}`);
    else opts.files.push(arg);
  }

  if (opts.files.length === 0) opts.files.push('README.md');
  if (!Number.isFinite(opts.gate) || opts.gate < 0 || opts.gate > 100) {
    throw new Error(`--score-threshold expects a number from 0 to 100, got ${opts.gate}`);
  }
  if (!Number.isInteger(opts.maxFiles) || opts.maxFiles < 1) {
    throw new Error(`--max-files expects a positive integer, got ${opts.maxFiles}`);
  }
  return opts;
}

export function buildBadge(files, opts = {}) {
  const rows = scoreFiles(files, opts);
  return toShieldsEndpoint(summarizeRows(rows), opts);
}

export function run(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  const badge = buildBadge(opts.files, opts);
  process.stdout.write(`${JSON.stringify(badge)}\n`);
}

const directPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (directPath === fileURLToPath(import.meta.url)) {
  try {
    run();
  } catch (error) {
    console.error(`patina-badge: ${error.message}`);
    process.exitCode = 2;
  }
}
