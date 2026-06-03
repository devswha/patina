import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mulberry32,
  mean,
  percentile,
  bootstrapCI,
  catchRateDeltaCI,
  fpRateDeltaCI,
  mcnemar,
  chiSquare1dfPValue,
} from '../../scripts/lib/paired-stats.mjs';
import {
  parseArgs,
  loadPairs,
  applyEngine,
  mockHostedEngine,
  summarize,
} from '../../scripts/ko-hosted-compare.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, '../quality/ko-hosted-paired.example.jsonl');

function closeTo(actual, expected, eps = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= eps, `expected ${actual} ≈ ${expected}`);
}

// A fixed paired set: 5 hot (3 recovered by hosted), 5 cold (1 baseline FP fixed).
const FIXED_PAIRS = [
  { id: 'a', gold: true, baselineHot: true, hostedHot: true },
  { id: 'b', gold: true, baselineHot: false, hostedHot: true },
  { id: 'c', gold: true, baselineHot: false, hostedHot: true },
  { id: 'd', gold: true, baselineHot: false, hostedHot: true },
  { id: 'e', gold: true, baselineHot: true, hostedHot: true },
  { id: 'f', gold: false, baselineHot: false, hostedHot: false },
  { id: 'g', gold: false, baselineHot: true, hostedHot: false },
  { id: 'h', gold: false, baselineHot: false, hostedHot: false },
  { id: 'i', gold: false, baselineHot: false, hostedHot: false },
  { id: 'j', gold: false, baselineHot: false, hostedHot: false },
];

describe('paired-stats: deterministic primitives (regression guard)', () => {
  it('mean and percentile are exact', () => {
    closeTo(mean([1, 0, 1, 0, 1]), 0.6);
    assert.strictEqual(mean([]), 0);
    assert.strictEqual(percentile([0, 1, 2, 3, 4], 0.5), 2);
    assert.strictEqual(percentile([0, 1, 2, 3, 4], 0.25), 1);
  });

  it('mulberry32(1) emits a locked, reproducible stream', () => {
    const rng = mulberry32(1);
    closeTo(rng(), 0.627073940588, 1e-9);
    closeTo(rng(), 0.002735721180, 1e-9);
    closeTo(rng(), 0.527447039960, 1e-9);
  });

  it('chiSquare1dfPValue matches a known reference', () => {
    closeTo(chiSquare1dfPValue(25 / 6), 0.041227, 1e-5);
    assert.strictEqual(chiSquare1dfPValue(0), 1);
    assert.strictEqual(chiSquare1dfPValue(-3), 1);
  });

  it('bootstrapCI is identical across calls with the same seed', () => {
    const a = bootstrapCI([0, 0, 1, 1, 1], mean, { seed: 7, iterations: 500 });
    const b = bootstrapCI([0, 0, 1, 1, 1], mean, { seed: 7, iterations: 500 });
    assert.strictEqual(a.lower, b.lower);
    assert.strictEqual(a.upper, b.upper);
  });
});

describe('paired-stats: catch / FP deltas with paired bootstrap CI', () => {
  it('locks the catch-rate delta CI on a fixed paired set', () => {
    const result = catchRateDeltaCI(FIXED_PAIRS, { seed: 1, iterations: 2000 });
    closeTo(result.baselineRate, 0.4);
    closeTo(result.hostedRate, 1);
    closeTo(result.delta, 0.6);
    closeTo(result.ci.lower, 0.2);
    closeTo(result.ci.upper, 1);
    assert.strictEqual(result.ci.excludesZero, true);
    assert.strictEqual(result.n, 5);
  });

  it('locks the FP-rate delta CI on a fixed paired set (non-regression)', () => {
    const result = fpRateDeltaCI(FIXED_PAIRS, { seed: 1, iterations: 2000 });
    closeTo(result.baselineRate, 0.2);
    closeTo(result.hostedRate, 0);
    closeTo(result.delta, -0.2);
    closeTo(result.ci.lower, -0.6);
    closeTo(result.ci.upper, 0);
    assert.strictEqual(result.regressed, false);
    assert.strictEqual(result.n, 5);
  });

  it('a null (identical) comparison yields a zero delta whose CI contains zero', () => {
    const identical = FIXED_PAIRS.map((p) => ({ ...p, hostedHot: p.baselineHot }));
    const catchDelta = catchRateDeltaCI(identical, { seed: 1, iterations: 500 });
    closeTo(catchDelta.delta, 0);
    assert.strictEqual(catchDelta.ci.excludesZero, false);
    const fpDelta = fpRateDeltaCI(identical, { seed: 1, iterations: 500 });
    closeTo(fpDelta.delta, 0);
    assert.strictEqual(fpDelta.regressed, false);
  });

  it('flags a genuine FP regression when hosted adds false positives', () => {
    const worse = [
      { id: 'n1', gold: false, baselineHot: false, hostedHot: true },
      { id: 'n2', gold: false, baselineHot: false, hostedHot: true },
      { id: 'n3', gold: false, baselineHot: false, hostedHot: true },
      { id: 'n4', gold: false, baselineHot: false, hostedHot: true },
    ];
    const fpDelta = fpRateDeltaCI(worse, { seed: 1, iterations: 1000 });
    closeTo(fpDelta.delta, 1);
    assert.strictEqual(fpDelta.regressed, true);
  });
});

describe('paired-stats: McNemar', () => {
  it('locks b/c/statistic on a fixed paired set', () => {
    const mc = mcnemar(FIXED_PAIRS);
    assert.strictEqual(mc.b, 0);
    assert.strictEqual(mc.c, 4);
    assert.strictEqual(mc.n, 4);
    closeTo(mc.statistic, 2.25);
    closeTo(mc.pValue, 0.133614, 1e-5);
  });

  it('returns a neutral result with no discordant pairs', () => {
    const mc = mcnemar([{ id: 'x', gold: true, baselineHot: true, hostedHot: true }]);
    assert.strictEqual(mc.n, 0);
    assert.strictEqual(mc.statistic, 0);
    assert.strictEqual(mc.pValue, 1);
  });
});

describe('ko-hosted-compare harness', () => {
  it('parses the checked-in paired fixture into 24 rows', () => {
    const rows = loadPairs(FIXTURE);
    assert.strictEqual(rows.length, 24);
    assert.strictEqual(rows.filter((r) => r.gold).length, 12);
    assert.strictEqual(rows.filter((r) => !r.gold).length, 12);
  });

  it('summarizes the fixture with a significant catch gain and no FP regression', () => {
    const pairs = applyEngine(loadPairs(FIXTURE), 'fixture');
    const summary = summarize(pairs, { seed: 1, iterations: 2000 });
    closeTo(summary.catch.delta, 1 / 3, 1e-9);
    assert.strictEqual(summary.catchSignificant, true);
    assert.ok(summary.catch.ci.lower > 0);
    closeTo(summary.fp.delta, -1 / 6, 1e-9);
    assert.strictEqual(summary.fpRegressed, false);
    assert.strictEqual(summary.mcnemar.b, 0);
    assert.strictEqual(summary.mcnemar.c, 6);
    closeTo(summary.mcnemar.statistic, 25 / 6, 1e-9);
  });

  it('mock engine never introduces a false positive and is deterministic', () => {
    const rows = loadPairs(FIXTURE);
    const negatives = rows.filter((r) => !r.gold);
    for (const row of negatives) {
      assert.strictEqual(mockHostedEngine(row), row.baselineHot, 'mock must not add FP on cold rows');
    }
    const first = applyEngine(rows, 'mock');
    const second = applyEngine(rows, 'mock');
    assert.deepStrictEqual(first, second);
  });

  it('mock engine recovers baseline misses on hot rows (catch gain is non-negative)', () => {
    const pairs = applyEngine(loadPairs(FIXTURE), 'mock');
    const summary = summarize(pairs, { seed: 1, iterations: 1000 });
    assert.ok(summary.catch.delta >= 0);
    assert.strictEqual(summary.fpRegressed, false);
  });

  it('parseArgs validates the engine flag', () => {
    assert.strictEqual(parseArgs([]).engine, 'fixture');
    assert.strictEqual(parseArgs(['--engine', 'mock']).engine, 'mock');
    assert.throws(() => parseArgs(['--engine', 'real']), /must be "fixture" or "mock"/);
    assert.throws(() => parseArgs(['--bogus']), /Unknown argument/);
  });
});
