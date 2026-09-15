#!/usr/bin/env node
// Render the report-only performance report from tests/quality/perf.mjs.
//
// This is the ONLY writer of docs/benchmarks/perf-latest.{md,json}. The report
// is informational (latency p50/p95/p99 of the offline analyzer); it is NOT a
// release gate and applies no latency threshold. Timing numbers are
// machine-dependent, so the checked-in artifact is a snapshot, not a CI-drift
// target. Pass --costmetrics only when an npm pack byte count is wanted.
//
// Usage: node scripts/perf-report.mjs [--costmetrics]

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPerfReport } from '../tests/quality/perf.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const REPORT_DIR = resolve(REPO_ROOT, 'docs/benchmarks');
const JSON_PATH = resolve(REPORT_DIR, 'perf-latest.json');
const MARKDOWN_PATH = resolve(REPORT_DIR, 'perf-latest.md');

function fmt(value) {
  return value == null ? 'n/a' : Number(value).toFixed(3);
}

function fmtBytes(value) {
  return value == null ? 'n/a' : `${Number(value)} B`;
}

export function perfReportOptions(argv = process.argv.slice(2)) {
  return {
    measureCliColdStart: true,
    costMetrics: argv.includes('--costmetrics'),
  };
}

export function renderMarkdown(report) {
  const lines = [];
  lines.push('# Performance report (report-only)');
  lines.push('');
  lines.push('Latency of the deterministic offline analyzer (`analyzeText`) over fixed fixtures.');
  lines.push('**Report-only — not a release gate and not a latency threshold.** Timing is');
  lines.push('machine-dependent; treat this as a local snapshot, not a CI-drift target.');
  lines.push('');
  lines.push(`- Generated at: ${report.generatedAt}`);
  lines.push(`- Node: ${report.nodeVersion} · ${report.platform}/${report.arch}`);
  lines.push(`- Passes: ${report.passes} measured (+${report.warmupPasses} warmup) per fixture`);
  lines.push(`- Fixtures: ${report.fixtureCount}`);
  lines.push(`- Analyzer timing: ${report.repeatConditions?.analyzer?.timingMode || 'warm-in-process'}; warmup excluded`);
  const cli = report.cliColdStart || {};
  lines.push(`- CLI coldstart: ${cli.status || 'unknown'}; ${fmt(cli.meanMs)} ms mean over ${cli.passes ?? 'n/a'} fresh processes`);
  const memory = report.memory || {};
  lines.push(`- Process memory: ${memory.status || 'unknown'}; ${memory.definition || 'RSS definition unavailable'}; delta ${fmtBytes(memory.rssDeltaBytes)}`);
  const costs = report.costMetrics || {};
  lines.push(`- Cost metrics: ${costs.status || 'unknown'}; calls=${costs.calls == null ? 'unknown' : costs.calls}; costUsd=${costs.costUsd == null ? 'unknown' : costs.costUsd}; npm tarball=${fmtBytes(costs.tarballBytes)}`);
  lines.push(`- Full data: [perf-latest.json](./perf-latest.json)`);
  lines.push('');
  lines.push('## Per size bucket');
  lines.push('');
  lines.push('| bucket | fixtures | p50 ms | p95 ms | p99 ms | mean ms | texts/sec |');
  lines.push('|--------|---------:|-------:|-------:|-------:|--------:|----------:|');
  for (const b of report.buckets) {
    lines.push(`| ${b.sizeBucket} | ${b.fixtureCount} | ${fmt(b.p50Ms)} | ${fmt(b.p95Ms)} | ${fmt(b.p99Ms)} | ${fmt(b.meanMs)} | ${fmt(b.textsPerSec)} |`);
  }
  lines.push('');
  lines.push('## Per fixture');
  lines.push('');
  lines.push('| fixture | lang | bucket | chars | paras | input sha256 | p50 ms | p95 ms | p99 ms | mean ms | texts/sec |');
  lines.push('|---------|------|--------|------:|------:|--------------|-------:|-------:|-------:|--------:|----------:|');
  for (const f of report.fixtures) {
    lines.push(`| ${f.id} | ${f.lang} | ${f.sizeBucket} | ${f.inputChars} | ${f.inputParagraphs} | ${f.inputSha256 || 'n/a'} | ${fmt(f.p50Ms)} | ${fmt(f.p95Ms)} | ${fmt(f.p99Ms)} | ${fmt(f.meanMs)} | ${fmt(f.textsPerSec)} |`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function writePerfReport(report, { jsonPath = JSON_PATH, markdownPath = MARKDOWN_PATH } = {}) {
  mkdirSync(dirname(jsonPath), { recursive: true });
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(markdownPath, renderMarkdown(report), 'utf8');
  return { jsonPath, markdownPath };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = buildPerfReport(perfReportOptions());
  const { jsonPath, markdownPath } = writePerfReport(report);
  console.log(`Wrote ${relative(REPO_ROOT, markdownPath)}`);
  console.log(`Wrote ${relative(REPO_ROOT, jsonPath)}`);
}
