#!/usr/bin/env node
// Report-only deterministic performance harness for the offline analyzer.
//
// Measures p50/p95/p99/mean latency of analyzeText() on fixed in-repo fixtures
// and emits a JSON report. This is NOT a CI gate: it never fails on slowness and
// applies no latency threshold. Timing uses node:perf_hooks (monotonic), with a
// warmup pass excluded from measurement. No network, no LLM, no randomness.
//
// Usage: node tests/quality/perf.mjs [--quiet]

import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzeText } from '../../src/features/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const FIXTURES_PATH = resolve(__dirname, 'perf-fixtures.jsonl');

export const PERF_SCHEMA_VERSION = 1;
export const DEFAULT_WARMUP_PASSES = 1;
export const DEFAULT_PASSES = 7; // measured passes per fixture (5..11)

// Resolve a fixture's text: either a literal `text` or a deterministic
// `textRepeat: { unit, times }` so synthetic worst cases stay small in the file.
export function resolveFixtureText(fixture) {
  if (typeof fixture.text === 'string') return fixture.text;
  if (fixture.textRepeat && typeof fixture.textRepeat.unit === 'string') {
    return fixture.textRepeat.unit.repeat(fixture.textRepeat.times);
  }
  throw new Error(`perf fixture ${fixture.id} has neither text nor textRepeat`);
}

export function loadPerfFixtures(path = FIXTURES_PATH) {
  const raw = readFileSync(path, 'utf8');
  const fixtures = raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  // Deterministic order by id so the report and its diffs are stable.
  fixtures.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return fixtures;
}

// Nearest-rank percentile over an ascending-sorted array: rank = ceil(p*n),
// clamped to [1, n], 1-indexed.
export function percentile(sortedAsc, p) {
  const n = sortedAsc.length;
  if (n === 0) return null;
  const rank = Math.max(1, Math.min(n, Math.ceil(p * n)));
  return sortedAsc[rank - 1];
}

export function mean(values) {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function round(value) {
  return value == null ? null : Math.round(value * 1000) / 1000;
}

// Pure summary of a measured-duration array (warmup already excluded).
export function summarizeDurations(durations) {
  const sorted = [...durations].sort((a, b) => a - b);
  const meanMs = mean(durations);
  return {
    p50Ms: round(percentile(sorted, 0.5)),
    p95Ms: round(percentile(sorted, 0.95)),
    p99Ms: round(percentile(sorted, 0.99)),
    meanMs: round(meanMs),
    textsPerSec: round(meanMs ? 1000 / meanMs : null),
  };
}

function countParagraphs(text) {
  return String(text)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean).length;
}

// Measure one fixture. `run` is injectable for tests; defaults to analyzeText.
export function measureFixture(fixture, { warmupPasses = DEFAULT_WARMUP_PASSES, passes = DEFAULT_PASSES, run, now = () => performance.now() } = {}) {
  const text = resolveFixtureText(fixture);
  const work = run || (() => analyzeText(text, { lang: fixture.lang, repoRoot: REPO_ROOT }));
  for (let i = 0; i < warmupPasses; i++) work();
  const durations = [];
  for (let i = 0; i < passes; i++) {
    const t0 = now();
    work();
    durations.push(now() - t0);
  }
  return {
    id: fixture.id,
    lang: fixture.lang,
    sizeBucket: fixture.sizeBucket,
    inputChars: text.length,
    inputParagraphs: countParagraphs(text),
    passes,
    warmupPasses,
    ...summarizeDurations(durations),
  };
}

// Bucket aggregate: percentiles taken over per-fixture meanMs samples;
// bucket meanMs = arithmetic mean of fixture meanMs; textsPerSec = 1000/meanMs.
export function aggregateBuckets(measured) {
  const byBucket = new Map();
  for (const m of measured) {
    if (!byBucket.has(m.sizeBucket)) byBucket.set(m.sizeBucket, []);
    byBucket.get(m.sizeBucket).push(m);
  }
  return [...byBucket.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([sizeBucket, items]) => {
      const means = items.map((i) => i.meanMs).sort((a, b) => a - b);
      const bucketMean = mean(means);
      return {
        sizeBucket,
        fixtureCount: items.length,
        p50Ms: round(percentile(means, 0.5)),
        p95Ms: round(percentile(means, 0.95)),
        p99Ms: round(percentile(means, 0.99)),
        meanMs: round(bucketMean),
        textsPerSec: round(bucketMean ? 1000 / bucketMean : null),
      };
    });
}

export function buildPerfReport({ fixtures, warmupPasses = DEFAULT_WARMUP_PASSES, passes = DEFAULT_PASSES, run, now = () => new Date().toISOString() } = {}) {
  // Always emit fixtures in a deterministic id order, whether loaded from the
  // file or injected by a caller/test.
  const list = (fixtures || loadPerfFixtures())
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const measured = list.map((f) => measureFixture(f, { warmupPasses, passes, run }));
  return {
    schemaVersion: PERF_SCHEMA_VERSION,
    generatedAt: now(),
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    warmupPasses,
    passes,
    fixtureCount: measured.length,
    fixtures: measured,
    buckets: aggregateBuckets(measured),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = buildPerfReport();
  if (!process.argv.includes('--quiet')) {
    console.error(`# perf harness — ${report.fixtureCount} fixtures, ${report.passes} passes (report-only; not a CI gate)`);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
