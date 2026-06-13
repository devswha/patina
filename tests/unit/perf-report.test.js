import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  percentile,
  mean,
  summarizeDurations,
  resolveFixtureText,
  aggregateBuckets,
  buildPerfReport,
  loadPerfFixtures,
  PERF_SCHEMA_VERSION,
} from '../../tests/quality/perf.mjs';
import { renderMarkdown } from '../../scripts/perf-report.mjs';

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
  assert.equal(s.p50Ms, 3);
  assert.equal(s.p95Ms, 5);
  assert.equal(s.p99Ms, 5);
  assert.equal(s.meanMs, 3);
  assert.equal(s.textsPerSec, Math.round((1000 / 3) * 1000) / 1000);
});

test('resolveFixtureText supports literal and deterministic textRepeat', () => {
  assert.equal(resolveFixtureText({ id: 'a', text: 'hi' }), 'hi');
  assert.equal(resolveFixtureText({ id: 'b', textRepeat: { unit: 'ab', times: 3 } }), 'ababab');
  assert.throws(() => resolveFixtureText({ id: 'c' }), /neither text nor textRepeat/);
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
  const report = buildPerfReport({
    fixtures,
    warmupPasses: 1,
    passes: 5,
    run: () => { n += 1; }, // injected workload: no analyzer, deterministic shape
    now: () => 'FIXED_TS',
  });
  // Top-level schema fields.
  for (const k of ['schemaVersion', 'generatedAt', 'nodeVersion', 'platform', 'arch', 'warmupPasses', 'passes', 'fixtureCount', 'fixtures', 'buckets']) {
    assert.ok(k in report, `missing top-level field ${k}`);
  }
  assert.equal(report.schemaVersion, PERF_SCHEMA_VERSION);
  assert.equal(report.generatedAt, 'FIXED_TS');
  assert.equal(report.fixtureCount, 2);
  // No latency-gate / pass-fail field exists anywhere in the report.
  for (const k of ['gate', 'failed', 'pass', 'threshold', 'regression']) {
    assert.equal(k in report, false, `report-only must not expose ${k}`);
  }
  // Per-fixture required fields + stable order by id.
  assert.deepEqual(report.fixtures.map((f) => f.id), ['f-a', 'f-b']);
  for (const f of report.fixtures) {
    for (const k of ['id', 'lang', 'sizeBucket', 'inputChars', 'inputParagraphs', 'passes', 'warmupPasses', 'p50Ms', 'p95Ms', 'p99Ms', 'meanMs', 'textsPerSec']) {
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
