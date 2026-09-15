import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import {
  percentile,
  mean,
  summarizeDurations,
  resolveFixtureText,
  aggregateBuckets,
  buildPerfReport,
  loadPerfFixtures,
  PERF_SCHEMA_VERSION,
  hashInput,
  measureCliColdStart,
  measureProcessMemory,
  measureNpmTarball,
} from '../../tests/quality/perf.mjs';
import { perfReportOptions, renderMarkdown } from '../../scripts/perf-report.mjs';

test('percentile uses nearest-rank (ceil) and clamps', () => {
  const s = [1, 2, 3, 4, 5];
  assert.equal(percentile(s, 0.5), 3); // ceil(2.5)=3 -> index 2
  assert.equal(percentile(s, 0.95), 5); // ceil(4.75)=5 -> index 4
  assert.equal(percentile(s, 0.99), 5);
  assert.equal(percentile(s, 0), 1); // clamps to rank 1
  assert.equal(percentile([], 0.5), null);
});

test('mean is arithmetic mean, null on empty', () => {
  assert.equal(mean([2, 4, 6]), 4);
  assert.equal(mean([]), null);
});

test('summarizeDurations pins p50/p95/p99/mean and textsPerSec=1000/meanMs', () => {
  const s = summarizeDurations([5, 1, 3, 2, 4]); // mean 3
  assert.equal(s.status, 'measured');
  assert.equal(s.p50Ms, 3);
  assert.equal(s.p95Ms, 5);
  assert.equal(s.p99Ms, 5);
  assert.equal(s.meanMs, 3);
  assert.equal(s.textsPerSec, Math.round((1000 / 3) * 1000) / 1000);
});

test('invalid analyzer durations become null metrics and do not aggregate', () => {
  for (const invalid of [[0, 1], [-1, 1], [Number.NaN, 1], [Number.POSITIVE_INFINITY, 1]]) {
    const summary = summarizeDurations(invalid);
    assert.equal(summary.status, 'error');
    assert.equal(summary.meanMs, null);
    assert.equal(summary.p95Ms, null);
  }
  const fixtures = [
    { id: 'bad', lang: 'en', sizeBucket: 'short', text: 'bad' },
    { id: 'good', lang: 'en', sizeBucket: 'short', text: 'good' },
  ];
  const clock = [0, 0, 10, 11];
  const report = buildPerfReport({
    fixtures,
    warmupPasses: 0,
    passes: 1,
    run: () => {},
    timingNow: () => clock.shift(),
    measureCliColdStart: false,
    now: () => 'FIXED_TS',
  });
  assert.equal(report.fixtures.find((fixture) => fixture.id === 'bad').status, 'error');
  assert.equal(report.fixtures.find((fixture) => fixture.id === 'bad').meanMs, null);
  assert.deepEqual(report.buckets.map((bucket) => bucket.fixtureCount), [1]);

  const positiveOnly = aggregateBuckets([
    { sizeBucket: 'short', status: 'measured', meanMs: 0 },
    { sizeBucket: 'short', status: 'measured', meanMs: -1 },
    { sizeBucket: 'short', status: 'measured', meanMs: Number.NaN },
    { sizeBucket: 'short', status: 'measured', meanMs: 2 },
  ]);
  assert.deepEqual(positiveOnly.map((bucket) => bucket.fixtureCount), [1]);
  assert.equal(positiveOnly[0].meanMs, 2);

  const huge = summarizeDurations([Number.MAX_VALUE, Number.MAX_VALUE]);
  assert.equal(huge.status, 'measured');
  assert.equal(huge.meanMs, Number.MAX_VALUE);
  for (const field of ['p50Ms', 'p95Ms', 'p99Ms', 'meanMs', 'textsPerSec']) {
    assert.equal(Number.isFinite(huge[field]), true, `huge ${field} must remain finite`);
    assert.ok(huge[field] > 0, `huge ${field} must remain positive`);
  }

  const tiny = summarizeDurations([0.0001]);
  assert.equal(tiny.status, 'measured');
  assert.equal(tiny.p50Ms, 0.0001);
  assert.equal(tiny.meanMs, 0.0001);
  assert.equal(tiny.textsPerSec, 10_000_000);

  const underflow = summarizeDurations([Number.MIN_VALUE]);
  assert.equal(underflow.status, 'error');
  assert.equal(underflow.meanMs, null);
  assert.equal(underflow.textsPerSec, null);
});

test('resolveFixtureText supports literal and deterministic textRepeat', () => {
  assert.equal(resolveFixtureText({ id: 'a', text: 'hi' }), 'hi');
  assert.equal(resolveFixtureText({ id: 'b', textRepeat: { unit: 'ab', times: 3 } }), 'ababab');
  assert.throws(() => resolveFixtureText({ id: 'c' }), /neither text nor textRepeat/);
});

test('input hashes are SHA-256 over the resolved UTF-8 fixture text', () => {
  const text = '한글 and emoji ✓';
  const fixture = { id: 'hash', lang: 'ko', sizeBucket: 'short', text };
  let now = 0;
  const measured = buildPerfReport({
    fixtures: [fixture],
    warmupPasses: 0,
    passes: 1,
    run: () => {},
    timingNow: () => (now += 1),
    measureCliColdStart: false,
    now: () => 'FIXED_TS',
  }).fixtures[0];
  assert.equal(measured.inputSha256, hashInput(text));
  assert.match(measured.inputSha256, /^[0-9a-f]{64}$/);
  assert.equal(measured.inputBytes, Buffer.byteLength(text, 'utf8'));
});

test('aggregateBuckets groups by sizeBucket with documented math', () => {
  const measured = [
    { sizeBucket: 'short', meanMs: 2 },
    { sizeBucket: 'short', meanMs: 4 },
    { sizeBucket: 'long', meanMs: 10 },
  ];
  const buckets = aggregateBuckets(measured);
  assert.deepEqual(buckets.map((b) => b.sizeBucket), ['long', 'short']);
  const short = buckets.find((b) => b.sizeBucket === 'short');
  assert.equal(short.fixtureCount, 2);
  assert.equal(short.meanMs, 3); // mean(2,4)
  assert.equal(short.textsPerSec, Math.round((1000 / 3) * 1000) / 1000);
});

test('buildPerfReport emits the full schema and is report-only (no gate fields)', () => {
  const fixtures = [
    { id: 'f-b', lang: 'en', sizeBucket: 'short', text: 'two words here' },
    { id: 'f-a', lang: 'ko', sizeBucket: 'short', text: '한 문장' },
  ];
  let n = 0;
  let timing = 0;
  let memoryCalls = 0;
  const injectedProcess = {
    version: 'v-test',
    platform: 'test-platform',
    arch: 'test-arch',
    execPath: '/test/node',
    memoryUsage: () => ({ rss: Buffer.byteLength('rss sample') + (++memoryCalls * 10) }),
  };
  const report = buildPerfReport({
    fixtures,
    warmupPasses: 1,
    passes: 5,
    run: () => { n += 1; }, // injected workload: no analyzer, deterministic shape
    timingNow: () => (timing += 1),
    processInfo: injectedProcess,
    measureCliColdStart: false,
    now: () => 'FIXED_TS',
  });
  // Top-level schema fields.
  for (const k of ['schemaVersion', 'generatedAt', 'nodeVersion', 'platform', 'arch', 'warmupPasses', 'passes', 'fixtureCount', 'fixtures', 'buckets']) {
    assert.ok(k in report, `missing top-level field ${k}`);
  }
  assert.equal(report.schemaVersion, PERF_SCHEMA_VERSION);
  assert.equal(report.generatedAt, 'FIXED_TS');
  assert.equal(report.fixtureCount, 2);
  assert.equal(report.environment.nodeVersion, 'v-test');
  assert.equal(report.repeatConditions.analyzer.warmupExcluded, true);
  assert.equal(report.cliColdStart.status, 'not-requested');
  assert.equal(report.memory.status, 'measured');
  assert.ok(report.memory.rssAfterBytes > report.memory.rssBeforeBytes);
  assert.equal(report.costMetrics.calls, null);
  assert.equal(report.costMetrics.costUsd, null);
  // No latency-gate / pass-fail field exists anywhere in the report.
  for (const k of ['gate', 'failed', 'pass', 'threshold', 'regression']) {
    assert.equal(k in report, false, `report-only must not expose ${k}`);
  }
  // Per-fixture required fields + stable order by id.
  assert.deepEqual(report.fixtures.map((f) => f.id), ['f-a', 'f-b']);
  for (const f of report.fixtures) {
    for (const k of ['id', 'lang', 'sizeBucket', 'inputChars', 'inputBytes', 'inputSha256', 'inputParagraphs', 'timingMode', 'passes', 'warmupPasses', 'p50Ms', 'p95Ms', 'p99Ms', 'meanMs', 'textsPerSec']) {
      assert.ok(k in f, `fixture missing ${k}`);
    }
    assert.equal(f.passes, 5);
    assert.equal(f.warmupPasses, 1);
  }
  // warmup is excluded: run called (warmup + passes) per fixture.
  assert.equal(n, fixtures.length * (1 + 5));
  // Markdown renders without throwing and states report-only.
  const md = renderMarkdown(report);
  assert.match(md, /report-only/i);
  assert.match(md, /not a release gate/i);
  assert.match(md, /CLI coldstart/);
  assert.match(md, /Cost metrics/);
});

test('CLI coldstart uses fresh injected processes and reports plausible timings', () => {
  let clock = 0;
  let calls = 0;
  const result = measureCliColdStart({
    passes: 3,
    processInfo: { execPath: '/test/node' },
    spawn: (executable, args, options) => {
      calls += 1;
      assert.equal(executable, '/test/node');
      assert.equal(args.at(-1), '--version');
      assert.equal(options.cwd.endsWith('/'), false);
      return { status: 0 };
    },
    now: () => (clock += 7),
    repoRoot: '/test/repo',
  });
  assert.equal(calls, 3);
  assert.equal(result.status, 'measured');
  assert.equal(result.processPerPass, true);
  assert.equal(result.completedPasses, 3);
  assert.ok(result.meanMs > 0);
});

test('CLI coldstart errors remain unknown rather than zero', () => {
  const result = measureCliColdStart({
    passes: 2,
    spawn: () => ({ status: 1 }),
    now: (() => {
      let clock = 0;
      return () => (clock += 1);
    })(),
  });
  assert.equal(result.status, 'error');
  assert.equal(result.completedPasses, 0);
  assert.equal(result.meanMs, null);
  assert.notEqual(result.meanMs, 0);
});

test('memory and opt-in npm pack metrics preserve unknown failures', () => {
  const memory = measureProcessMemory({
    processInfo: { memoryUsage: () => ({ rss: Buffer.byteLength('memory') }) },
  });
  assert.equal(memory.status, 'measured');
  assert.ok(memory.rssBytes > 0);
  const packBytes = Buffer.byteLength('fixture tarball bytes');
  const packed = measureNpmTarball({
    repoRoot: '/test/repo',
    pack: ({ args, destination }) => {
      assert.deepEqual(args.slice(0, 3), ['pack', '--json', '--ignore-scripts']);
      const tarballPath = join(destination, 'fixture.tgz');
      writeFileSync(tarballPath, Buffer.alloc(packBytes, 0x61));
      return {
        status: 0,
        stdout: JSON.stringify([{ filename: 'fixture.tgz', size: packBytes }]),
      };
    },
  });
  assert.equal(packed.status, 'measured');
  assert.equal(packed.tarballBytes, packBytes);

  const external = measureNpmTarball({
    pack: () => ({ status: 0, tarballPath: process.execPath }),
  });
  assert.equal(external.status, 'unknown');
  assert.equal(external.tarballBytes, null);

  const traversal = measureNpmTarball({
    pack: ({ destination }) => ({
      status: 0,
      tarballPath: relative(destination, process.execPath),
    }),
  });
  assert.equal(traversal.status, 'unknown');
  assert.equal(traversal.tarballBytes, null);

  const metadataOnly = measureNpmTarball({
    pack: () => ({ status: 0, tarballBytes: packBytes }),
  });
  assert.equal(metadataOnly.status, 'unknown');
  assert.equal(metadataOnly.tarballBytes, null);

  const failed = measureNpmTarball({ pack: () => { throw new Error('pack unavailable'); } });
  assert.equal(failed.status, 'error');
  assert.equal(failed.tarballBytes, null);
  assert.notEqual(failed.tarballBytes, 0);
});

test('perf report options require explicit costmetrics opt-in', () => {
  assert.equal(perfReportOptions([]).costMetrics, false);
  assert.equal(perfReportOptions(['--quiet']).costMetrics, false);
  assert.equal(perfReportOptions(['--costmetrics']).costMetrics, true);
});

test('the repo perf fixtures load and cover the required buckets', () => {
  const fixtures = loadPerfFixtures();
  const buckets = new Set(fixtures.map((f) => f.sizeBucket));
  for (const b of ['short', 'medium', 'long', 'synthetic-mattr', 'synthetic-lexicon']) {
    assert.ok(buckets.has(b), `missing fixture bucket ${b}`);
  }
  // ids unique.
  assert.equal(new Set(fixtures.map((f) => f.id)).size, fixtures.length);
});
