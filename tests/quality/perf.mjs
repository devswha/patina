#!/usr/bin/env node
// Report-only deterministic performance harness for the offline analyzer.
//
// Measures p50/p95/p99/mean latency of analyzeText() on fixed in-repo fixtures
// and emits a JSON report. This is NOT a CI gate: it never fails on slowness and
// applies no latency threshold. Timing uses node:perf_hooks (monotonic), with a
// warmup pass excluded from measurement. No network, no LLM, no randomness.
//
// Usage: node tests/quality/perf.mjs [--quiet] [--costmetrics]

import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzeText } from '../../src/features/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const FIXTURES_PATH = resolve(__dirname, 'perf-fixtures.jsonl');

export const PERF_SCHEMA_VERSION = 2;
export const DEFAULT_WARMUP_PASSES = 1;
export const DEFAULT_PASSES = 7; // measured passes per fixture (5..11)
export const DEFAULT_CLI_PASSES = 3;
export const ANALYZER_TIMING_MODE = 'warm-in-process';
export const CLI_TIMING_MODE = 'cold-process';
export const PROCESS_MEMORY_DEFINITION =
  'RSS bytes from process.memoryUsage().rss, sampled before and after this report; this is resident memory, not heap usage or a peak sample.';

const CLI_ENTRYPOINT = 'bin/patina.js';
const CLI_ARGS = ['--version'];

function errorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 240);
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function positiveBytes(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function hashInput(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex');
}

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
  const scale = Math.max(...values.map((value) => Math.abs(value)));
  if (!Number.isFinite(scale) || scale === 0) {
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  return scale * (values.reduce((sum, value) => sum + (value / scale), 0) / values.length);
}

function round(value) {
  if (value == null || !Number.isFinite(value)) return value;
  const scaled = value * 1000;
  if (!Number.isFinite(scaled)) return value;
  const rounded = Math.round(scaled) / 1000;
  return rounded === 0 && value !== 0 ? value : rounded;
}

function invalidSummary(error) {
  return {
    status: 'error',
    error,
    p50Ms: null,
    p95Ms: null,
    p99Ms: null,
    meanMs: null,
    textsPerSec: null,
  };
}

// Pure summary of a measured-duration array (warmup already excluded).
export function summarizeDurations(durations) {
  if (!Array.isArray(durations) || durations.length === 0) {
    return {
      status: 'unknown',
      error: 'no measured durations',
      p50Ms: null,
      p95Ms: null,
      p99Ms: null,
      meanMs: null,
      textsPerSec: null,
    };
  }
  const invalidIndex = durations.findIndex((duration) => (
    typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0
  ));
  if (invalidIndex !== -1) {
    return {
      status: 'error',
      error: `invalid measured duration at pass ${invalidIndex + 1}; expected a finite value greater than zero`,
      p50Ms: null,
      p95Ms: null,
      p99Ms: null,
      meanMs: null,
      textsPerSec: null,
    };
  }
  const sorted = [...durations].sort((a, b) => a - b);
  const meanMs = mean(durations);
  const summary = {
    p50Ms: round(percentile(sorted, 0.5)),
    p95Ms: round(percentile(sorted, 0.95)),
    p99Ms: round(percentile(sorted, 0.99)),
    meanMs: round(meanMs),
    textsPerSec: round(meanMs ? 1000 / meanMs : null),
  };
  if (Object.values(summary).some((value) => !Number.isFinite(value) || value <= 0)) {
    return invalidSummary('derived analyzer timing metric is not finite and positive');
  }
  return { status: 'measured', ...summary };
}

function countParagraphs(text) {
  return String(text)
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean).length;
}

// Measure one fixture. `run` is injectable for tests; defaults to analyzeText.
export function measureFixture(fixture, {
  warmupPasses = DEFAULT_WARMUP_PASSES,
  passes = DEFAULT_PASSES,
  run,
  now = () => performance.now(),
  repoRoot = REPO_ROOT,
} = {}) {
  let text = null;
  try {
    text = resolveFixtureText(fixture);
  } catch (error) {
    return {
      id: fixture?.id,
      lang: fixture?.lang,
      sizeBucket: fixture?.sizeBucket,
      inputChars: null,
      inputBytes: null,
      inputSha256: null,
      inputParagraphs: null,
      timingMode: ANALYZER_TIMING_MODE,
      passes,
      warmupPasses,
      status: 'error',
      error: errorMessage(error),
      p50Ms: null,
      p95Ms: null,
      p99Ms: null,
      meanMs: null,
      textsPerSec: null,
    };
  }
  const work = run || (() => analyzeText(text, { lang: fixture.lang, repoRoot }));
  try {
    for (let i = 0; i < warmupPasses; i++) work();
  } catch (error) {
    return {
      id: fixture.id,
      lang: fixture.lang,
      sizeBucket: fixture.sizeBucket,
      inputChars: text.length,
      inputBytes: Buffer.byteLength(text, 'utf8'),
      inputSha256: hashInput(text),
      inputParagraphs: countParagraphs(text),
      timingMode: ANALYZER_TIMING_MODE,
      passes,
      warmupPasses,
      status: 'error',
      error: errorMessage(error),
      completedPasses: 0,
      p50Ms: null,
      p95Ms: null,
      p99Ms: null,
      meanMs: null,
      textsPerSec: null,
    };
  }
  const durations = [];
  for (let i = 0; i < passes; i++) {
    try {
      const t0 = now();
      work();
      durations.push(now() - t0);
    } catch (error) {
      return {
        id: fixture.id,
        lang: fixture.lang,
        sizeBucket: fixture.sizeBucket,
        inputChars: text.length,
        inputBytes: Buffer.byteLength(text, 'utf8'),
        inputSha256: hashInput(text),
        inputParagraphs: countParagraphs(text),
        timingMode: ANALYZER_TIMING_MODE,
        passes,
        warmupPasses,
        status: 'error',
        error: errorMessage(error),
        completedPasses: durations.length,
        p50Ms: null,
        p95Ms: null,
        p99Ms: null,
        meanMs: null,
        textsPerSec: null,
      };
    }
  }
  return {
    id: fixture.id,
    lang: fixture.lang,
    sizeBucket: fixture.sizeBucket,
    inputChars: text.length,
    inputBytes: Buffer.byteLength(text, 'utf8'),
    inputSha256: hashInput(text),
    inputParagraphs: countParagraphs(text),
    timingMode: ANALYZER_TIMING_MODE,
    passes,
    warmupPasses,
    completedPasses: durations.length,
    ...summarizeDurations(durations),
  };
}

function cliCommand({ processInfo = process, repoRoot = REPO_ROOT, command } = {}) {
  if (command && typeof command === 'object') {
    const executable = typeof command.executable === 'string' && command.executable
      ? command.executable
      : processInfo.execPath || process.execPath;
    const args = Array.isArray(command.args) ? command.args.slice() : [resolve(repoRoot, CLI_ENTRYPOINT), ...CLI_ARGS];
    return { executable, args };
  }
  return {
    executable: processInfo.execPath || process.execPath,
    args: [resolve(repoRoot, CLI_ENTRYPOINT), ...CLI_ARGS],
  };
}

function unknownCliResult({ passes, command, status = 'not-requested', error = null, completedPasses = 0 } = {}) {
  return {
    status,
    timingMode: CLI_TIMING_MODE,
    command,
    passes,
    warmupPasses: 0,
    processPerPass: true,
    completedPasses,
    p50Ms: null,
    p95Ms: null,
    p99Ms: null,
    meanMs: null,
    textsPerSec: null,
    ...(error ? { error } : {}),
  };
}

// Measure a fresh CLI process for every pass. This intentionally does not share
// the in-process analyzer timings above: import/startup work belongs to this
// cold-process measurement, while fixture timings are warm analyzer work.
export function measureCliColdStart({
  passes = DEFAULT_CLI_PASSES,
  spawn = spawnSync,
  now = () => performance.now(),
  processInfo = process,
  repoRoot = REPO_ROOT,
  command,
} = {}) {
  const repeatPasses = positiveInteger(passes, 0);
  const cli = cliCommand({ processInfo, repoRoot, command });
  if (!repeatPasses) {
    return unknownCliResult({
      passes,
      command: cli,
      status: 'unknown',
      error: 'CLI passes must be a positive integer',
    });
  }
  if (typeof spawn !== 'function') {
    return unknownCliResult({
      passes: repeatPasses,
      command: cli,
      status: 'unknown',
      error: 'CLI process runner is unavailable',
    });
  }

  const durations = [];
  for (let pass = 0; pass < repeatPasses; pass++) {
    let started;
    try {
      started = now();
      const child = spawn(cli.executable, cli.args, {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: 'ignore',
      });
      const elapsed = now() - started;
      if (!Number.isFinite(elapsed) || elapsed <= 0) {
        return unknownCliResult({
          passes: repeatPasses,
          command: cli,
          status: 'error',
          completedPasses: durations.length,
          error: 'CLI clock produced an invalid duration',
        });
      }
      if (!child || typeof child !== 'object') {
        return unknownCliResult({
          passes: repeatPasses,
          command: cli,
          status: 'error',
          completedPasses: durations.length,
          error: 'CLI process runner returned no result',
        });
      }
      if (child.error) {
        return unknownCliResult({
          passes: repeatPasses,
          command: cli,
          status: 'error',
          completedPasses: durations.length,
          error: errorMessage(child.error),
        });
      }
      if ('status' in child && child.status !== 0) {
        return unknownCliResult({
          passes: repeatPasses,
          command: cli,
          status: 'error',
          completedPasses: durations.length,
          error: `CLI exited with status ${child.status}`,
        });
      }
      if (child.signal) {
        return unknownCliResult({
          passes: repeatPasses,
          command: cli,
          status: 'error',
          completedPasses: durations.length,
          error: `CLI terminated by ${child.signal}`,
        });
      }
      durations.push(elapsed);
    } catch (error) {
      return unknownCliResult({
        passes: repeatPasses,
        command: cli,
        status: 'error',
        completedPasses: durations.length,
        error: errorMessage(error),
      });
    }
  }

  return {
    status: 'measured',
    timingMode: CLI_TIMING_MODE,
    command: cli,
    passes: repeatPasses,
    warmupPasses: 0,
    processPerPass: true,
    completedPasses: durations.length,
    ...summarizeDurations(durations),
  };
}

function sampleRss(processInfo) {
  try {
    if (!processInfo || typeof processInfo.memoryUsage !== 'function') {
      return { status: 'unknown', rssBytes: null, error: 'process.memoryUsage is unavailable' };
    }
    const usage = processInfo.memoryUsage();
    const rssBytes = positiveBytes(usage?.rss);
    if (rssBytes == null) {
      return { status: 'unknown', rssBytes: null, error: 'process.memoryUsage().rss is unavailable' };
    }
    return { status: 'measured', rssBytes };
  } catch (error) {
    return { status: 'error', rssBytes: null, error: errorMessage(error) };
  }
}

export function measureProcessMemory({ processInfo = process } = {}) {
  const sample = sampleRss(processInfo);
  return {
    definition: PROCESS_MEMORY_DEFINITION,
    ...sample,
  };
}

function memoryReport(before, after) {
  const errors = [before.error, after.error].filter(Boolean);
  const measured = before.status === 'measured' && after.status === 'measured';
  return {
    status: measured ? 'measured' : errors.length ? 'error' : 'unknown',
    definition: PROCESS_MEMORY_DEFINITION,
    rssBeforeBytes: before.rssBytes,
    rssAfterBytes: after.rssBytes,
    rssDeltaBytes: measured ? after.rssBytes - before.rssBytes : null,
    ...(errors.length ? { errors } : {}),
  };
}

function packJson(stdout) {
  if (typeof stdout !== 'string' || !stdout.trim()) return null;
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  return Array.isArray(parsed) ? parsed[0] : parsed;
}

function packMeasurementFromResult(result, destination) {
  if (!result || typeof result !== 'object') {
    return { status: 'unknown', tarballBytes: null, error: 'npm pack returned no result' };
  }
  if (result.error) {
    return { status: 'error', tarballBytes: null, error: errorMessage(result.error) };
  }
  if ('status' in result && result.status !== 0) {
    return { status: 'error', tarballBytes: null, error: `npm pack exited with status ${result.status}` };
  }

  const metadata = packJson(result.stdout);
  const reportedBytes = positiveBytes(
    result.tarballBytes ?? result.npmTarballBytes ?? result.bytes ?? result.size ?? metadata?.size
  );
  const filename = metadata?.filename || result.filename;
  const candidatePath = result.tarballPath || result.path || (filename ? join(destination, filename) : null);
  const resolvedCandidate = candidatePath ? resolve(destination, candidatePath) : null;
  if (!resolvedCandidate || !existsSync(resolvedCandidate)) {
    return {
      status: 'unknown',
      tarballBytes: null,
      error: reportedBytes == null
        ? 'npm pack did not identify a produced tarball file'
        : 'npm pack reported metadata bytes without a produced tarball file',
    };
  }
  let destinationReal;
  let candidateReal;
  try {
    destinationReal = realpathSync(destination);
    candidateReal = realpathSync(resolvedCandidate);
  } catch (error) {
    return { status: 'error', tarballBytes: null, error: errorMessage(error) };
  }
  const candidateRelative = relative(destinationReal, candidateReal);
  if (
    candidateRelative === ''
    || candidateRelative === '..'
    || candidateRelative.startsWith(`..${sep}`)
    || isAbsolute(candidateRelative)
  ) {
    return {
      status: 'unknown',
      tarballBytes: null,
      error: 'npm pack tarball path is outside the fresh pack destination',
    };
  }
  let actualBytes = null;
  try {
    const stats = statSync(candidateReal);
    if (!stats.isFile() || stats.size <= 0) {
      return {
        status: 'unknown',
        tarballBytes: null,
        error: 'npm pack did not produce a positive-size tarball file',
      };
    }
    actualBytes = positiveBytes(stats.size);
  } catch (error) {
    return { status: 'error', tarballBytes: null, error: errorMessage(error) };
  }
  if (actualBytes != null && reportedBytes != null && actualBytes !== reportedBytes) {
    return {
      status: 'error',
      tarballBytes: null,
      error: `npm pack byte count mismatch (${actualBytes} actual, ${reportedBytes} reported)`,
    };
  }
  const tarballBytes = actualBytes ?? reportedBytes;
  if (tarballBytes == null) {
    return { status: 'unknown', tarballBytes: null, error: 'npm pack did not report a positive tarball byte count' };
  }
  return {
    status: 'measured',
    tarballBytes,
    npmTarballBytes: tarballBytes,
    ...(reportedBytes != null ? { reportedBytes } : {}),
  };
}

// Run npm pack only when the caller explicitly requests cost metrics. The
// temporary destination keeps a report run from leaving a tarball in the
// repository; pack failures remain an unknown report value, not a gate.
export function measureNpmTarball({
  repoRoot = REPO_ROOT,
  spawn = spawnSync,
  pack,
} = {}) {
  let destination = null;
  try {
    destination = mkdtempSync(join(tmpdir(), 'patina-perf-pack-'));
    const args = ['pack', '--json', '--ignore-scripts', '--pack-destination', destination];
    const result = typeof pack === 'function'
      ? pack({ cwd: repoRoot, destination, args })
      : spawn('npm', args, {
        cwd: repoRoot,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    return packMeasurementFromResult(result, destination);
  } catch (error) {
    return { status: 'error', tarballBytes: null, error: errorMessage(error) };
  } finally {
    if (destination) rmSync(destination, { recursive: true, force: true });
  }
}

function costMetrics({ enabled = false, repoRoot = REPO_ROOT, spawn, pack } = {}) {
  const base = {
    enabled,
    status: enabled ? 'unknown' : 'not-requested',
    calls: null,
    costUsd: null,
    unknownCalls: true,
    unknownCost: true,
    tarballBytes: null,
    npmTarballBytes: null,
  };
  if (!enabled) return base;
  const tarball = measureNpmTarball({ repoRoot, spawn, pack });
  return {
    ...base,
    status: tarball.status,
    tarballBytes: tarball.tarballBytes,
    npmTarballBytes: tarball.npmTarballBytes ?? tarball.tarballBytes,
    ...(tarball.error ? { error: tarball.error } : {}),
  };
}

// Bucket aggregate: percentiles taken over per-fixture meanMs samples;
// bucket meanMs = arithmetic mean of fixture meanMs; textsPerSec = 1000/meanMs.
export function aggregateBuckets(measured) {
  const byBucket = new Map();
  for (const m of measured) {
    if (
      !m
      || (m.status !== undefined && m.status !== 'measured')
      || !Number.isFinite(m.meanMs)
      || m.meanMs <= 0
      || !Number.isFinite(1000 / m.meanMs)
    ) {
      continue;
    }
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

export function buildPerfReport(options = {}) {
  const {
    fixtures,
    warmupPasses = DEFAULT_WARMUP_PASSES,
    passes = DEFAULT_PASSES,
    run,
    now = () => new Date().toISOString(),
    repoRoot = REPO_ROOT,
  } = options;
  const processInfo = options.processInfo ?? options.process ?? process;
  const timingNow = options.timingNow ?? options.clock ?? (() => performance.now());
  const cliNow = options.cliNow ?? timingNow;
  const cliPasses = options.cliPasses ?? DEFAULT_CLI_PASSES;
  const shouldMeasureCli = options.measureCliColdStart ?? options.measureCli ?? true;
  const cliSpawn = options.cliSpawn ?? options.spawn;
  const cliCommandOptions = options.cliCommand;
  const costMetricsEnabled = options.costMetrics === true
    || options.costmetrics === true
    || (options.costMetrics && options.costMetrics.enabled === true);
  const pack = options.pack ?? options.costMetrics?.pack;

  // Always emit fixtures in a deterministic id order, whether loaded from the
  // file or injected by a caller/test.
  const list = (fixtures || loadPerfFixtures(FIXTURES_PATH))
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const memoryBefore = sampleRss(processInfo);
  const measured = list.map((f) => measureFixture(f, {
    warmupPasses,
    passes,
    run,
    now: timingNow,
    repoRoot,
  }));
  const cliColdStart = shouldMeasureCli
    ? measureCliColdStart({
      passes: cliPasses,
      spawn: cliSpawn || spawnSync,
      now: cliNow,
      processInfo,
      repoRoot,
      command: cliCommandOptions,
    })
    : unknownCliResult({
      passes: cliPasses,
      command: cliCommand({ processInfo, repoRoot, command: cliCommandOptions }),
    });
  const memoryAfter = sampleRss(processInfo);

  const environment = {
    nodeVersion: processInfo.version || process.version,
    platform: processInfo.platform || process.platform,
    arch: processInfo.arch || process.arch,
    execPath: processInfo.execPath || process.execPath,
    cwd: repoRoot,
    analyzerClock: 'node:perf_hooks performance.now (monotonic wall time)',
    timestampClock: 'Date.toISOString supplied by caller',
  };

  return {
    schemaVersion: PERF_SCHEMA_VERSION,
    generatedAt: now(),
    nodeVersion: environment.nodeVersion,
    platform: environment.platform,
    arch: environment.arch,
    environment,
    warmupPasses,
    passes,
    repeatConditions: {
      fixtureOrder: 'ascending id',
      analyzer: {
        timingMode: ANALYZER_TIMING_MODE,
        warmupPasses,
        measuredPasses: passes,
        warmupExcluded: true,
      },
      cliColdStart: {
        timingMode: CLI_TIMING_MODE,
        warmupPasses: 0,
        measuredPasses: cliPasses,
        processPerPass: true,
      },
    },
    memory: memoryReport(memoryBefore, memoryAfter),
    cliColdStart,
    costMetrics: costMetrics({
      enabled: costMetricsEnabled,
      repoRoot,
      spawn: options.packSpawn ?? options.costMetrics?.spawn ?? options.spawn,
      pack,
    }),
    fixtureCount: measured.length,
    fixtures: measured,
    buckets: aggregateBuckets(measured),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = buildPerfReport({ costMetrics: process.argv.includes('--costmetrics') });
  if (!process.argv.includes('--quiet')) {
    console.error(`# perf harness — ${report.fixtureCount} fixtures, ${report.passes} passes (report-only; not a CI gate)`);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
