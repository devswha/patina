#!/usr/bin/env node
// ko baseline-vs-hosted compare harness.
//
// Compares the open-baseline detector against the patina-hosted detector on a
// PAIRED, held-out set of Korean samples and reports:
//   - catch (true-positive) rate delta with a paired bootstrap CI
//   - false-positive rate delta with a paired bootstrap CI (non-regression gate)
//   - McNemar's test on paired correctness
//
// It runs fully offline. By default it reads paired predictions from a JSONL
// fixture; with `--engine mock` it derives hosted predictions from a documented
// deterministic MOCK engine so the whole pipeline (and its statistics) can be
// exercised in CI BEFORE the real cross-track hosted engine exists. Numbers
// from the mock engine are NOT a performance claim — only the real hosted
// engine's recorded predictions can back a statistical claim.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { catchRateDeltaCI, fpRateDeltaCI, mcnemar } from './lib/paired-stats.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DEFAULT_INPUT = resolve(REPO_ROOT, 'tests/quality/ko-hosted-paired.example.jsonl');
const REPORT_DIR = resolve(REPO_ROOT, 'docs/benchmarks');

/**
 * Parse CLI arguments for the harness.
 *
 * @param {string[]} argv Raw argv slice.
 * @returns {{input: string, engine: string, seed: number, iterations: number, alpha: number, write: boolean, quiet: boolean}} Parsed options.
 */
export function parseArgs(argv) {
  const out = {
    input: DEFAULT_INPUT,
    engine: 'fixture',
    seed: 1,
    iterations: 2000,
    alpha: 0.05,
    write: true,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input') out.input = resolve(REPO_ROOT, argv[++i]);
    else if (arg === '--engine') out.engine = argv[++i];
    else if (arg === '--seed') out.seed = Number(argv[++i]);
    else if (arg === '--iterations') out.iterations = Number(argv[++i]);
    else if (arg === '--alpha') out.alpha = Number(argv[++i]);
    else if (arg === '--no-write') out.write = false;
    else if (arg === '--quiet') out.quiet = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (out.engine !== 'fixture' && out.engine !== 'mock') {
    throw new Error(`--engine must be "fixture" or "mock", received: ${out.engine}`);
  }
  return out;
}

// FNV-1a string hash for deterministic per-row mock decisions.
function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Deterministic MOCK hosted engine. NON-EVIDENTIAL: it exists only to exercise
 * the harness before the real cross-track engine lands. It recovers a fixed,
 * id-deterministic subset of the baseline's misses on gold-hot rows and never
 * introduces a new false positive on gold-cold rows.
 *
 * @param {{id: string, gold: boolean, baselineHot: boolean}} row Paired row with baseline prediction.
 * @returns {boolean} Mock hosted prediction.
 */
export function mockHostedEngine(row) {
  if (row.gold === false) return row.baselineHot; // never add a false positive
  if (row.baselineHot) return true; // keep baseline's catches
  return hashString(String(row.id)) % 3 !== 0; // recover ~2/3 of baseline misses
}

/**
 * Load and validate paired rows from a JSONL file.
 *
 * @param {string} path Absolute path to the JSONL fixture.
 * @returns {Array<{id: string, lang: string, gold: boolean, baselineHot: boolean, hostedHot: (boolean|undefined)}>} Parsed rows.
 * @throws {Error} On missing file or malformed rows.
 */
export function loadPairs(path) {
  if (!existsSync(path)) throw new Error(`paired fixture not found: ${path}`);
  const lines = readFileSync(path, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.map((line, idx) => {
    let row;
    try {
      row = JSON.parse(line);
    } catch (err) {
      throw new Error(`line ${idx + 1}: invalid JSON (${err.message})`);
    }
    if (typeof row.gold !== 'boolean') throw new Error(`line ${idx + 1}: gold must be boolean`);
    if (typeof row.baselineHot !== 'boolean') throw new Error(`line ${idx + 1}: baselineHot must be boolean`);
    if (row.hostedHot !== undefined && typeof row.hostedHot !== 'boolean') {
      throw new Error(`line ${idx + 1}: hostedHot must be boolean when present`);
    }
    return {
      id: row.id ?? `row-${idx + 1}`,
      lang: row.lang ?? 'ko',
      gold: row.gold,
      baselineHot: row.baselineHot,
      hostedHot: row.hostedHot,
    };
  });
}

/**
 * Resolve each row's hosted prediction using the fixture column or the mock engine.
 *
 * @param {Array<object>} rows Loaded rows.
 * @param {string} engine 'fixture' (use recorded hostedHot, fall back to mock when absent) or 'mock' (always mock).
 * @returns {Array<{id: string, gold: boolean, baselineHot: boolean, hostedHot: boolean}>} Rows with a concrete hostedHot.
 */
export function applyEngine(rows, engine) {
  return rows.map((row) => {
    const hostedHot = engine === 'mock' || row.hostedHot === undefined ? mockHostedEngine(row) : row.hostedHot;
    return { id: row.id, lang: row.lang, gold: row.gold, baselineHot: row.baselineHot, hostedHot };
  });
}

/**
 * Compute the full paired comparison summary.
 *
 * @param {Array<{gold: boolean, baselineHot: boolean, hostedHot: boolean}>} pairs Resolved paired rows.
 * @param {object} [opts] Bootstrap options.
 * @param {number} [opts.seed=1] PRNG seed.
 * @param {number} [opts.iterations=2000] Bootstrap iterations.
 * @param {number} [opts.alpha=0.05] Significance level.
 * @returns {object} Summary with catch/fp deltas and McNemar.
 */
export function summarize(pairs, { seed = 1, iterations = 2000, alpha = 0.05 } = {}) {
  const opts = { seed, iterations, alpha };
  const catchDelta = catchRateDeltaCI(pairs, opts);
  const fpDelta = fpRateDeltaCI(pairs, opts);
  const mc = mcnemar(pairs);
  return {
    n: pairs.length,
    positives: pairs.filter((p) => p.gold === true).length,
    negatives: pairs.filter((p) => p.gold === false).length,
    catch: catchDelta,
    fp: fpDelta,
    mcnemar: mc,
    catchSignificant: catchDelta.ci.excludesZero && catchDelta.delta > 0,
    fpRegressed: fpDelta.regressed,
  };
}

function pct(n) {
  return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : '—';
}

function signedPct(n) {
  if (!Number.isFinite(n)) return '—';
  const s = `${(n * 100).toFixed(1)}%`;
  return n > 0 ? `+${s}` : s;
}

function renderMarkdown(report) {
  const { summary } = report;
  return `# ko Baseline vs Hosted — Paired Compare

Offline, paired comparison of the open-baseline detector against the
patina-hosted detector. Catch/FP deltas carry paired bootstrap CIs; McNemar
tests paired correctness. This is a measurement protocol, not a claim: only the
real cross-track hosted engine's recorded predictions can back a statistical
performance claim.

- Generated at: ${report.generatedAt}
- Input: \`${report.input}\`
- Engine: \`${report.engine}\`${report.engine === 'mock' ? ' (MOCK — non-evidential, pipeline check only)' : ''}
- Bootstrap: ${report.iterations} iterations, seed ${report.seed}, ${(1 - report.alpha) * 100}% CI
- Pairs: ${summary.n} (${summary.positives} hot / ${summary.negatives} cold)

## Catch (true-positive) rate

| metric | baseline | hosted | delta | ${(1 - report.alpha) * 100}% CI | significant |
|---|---:|---:|---:|---|:--:|
| catch rate | ${pct(summary.catch.baselineRate)} | ${pct(summary.catch.hostedRate)} | ${signedPct(summary.catch.delta)} | [${signedPct(summary.catch.ci.lower)}, ${signedPct(summary.catch.ci.upper)}] | ${summary.catchSignificant ? '✅ yes' : 'no'} |

## False-positive rate (non-regression gate)

| metric | baseline | hosted | delta | ${(1 - report.alpha) * 100}% CI | regressed |
|---|---:|---:|---:|---|:--:|
| FP rate | ${pct(summary.fp.baselineRate)} | ${pct(summary.fp.hostedRate)} | ${signedPct(summary.fp.delta)} | [${signedPct(summary.fp.ci.lower)}, ${signedPct(summary.fp.ci.upper)}] | ${summary.fpRegressed ? '❌ yes' : '✅ no'} |

## McNemar (paired correctness)

- baseline-only correct (b): ${summary.mcnemar.b}
- hosted-only correct (c): ${summary.mcnemar.c}
- discordant pairs (n): ${summary.mcnemar.n}
- statistic (1 df, continuity-corrected): ${summary.mcnemar.statistic.toFixed(4)}
- p-value: ${summary.mcnemar.pValue.toFixed(4)}

Reproduce: \`npm run compare:ko-hosted\` (fixture) or \`node scripts/ko-hosted-compare.mjs --engine mock\`.
`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const rows = loadPairs(args.input);
  const pairs = applyEngine(rows, args.engine);
  const summary = summarize(pairs, { seed: args.seed, iterations: args.iterations, alpha: args.alpha });
  const report = {
    reportVersion: 1,
    generatedAt: new Date().toISOString(),
    input: relative(REPO_ROOT, args.input),
    engine: args.engine,
    seed: args.seed,
    iterations: args.iterations,
    alpha: args.alpha,
    summary,
  };

  if (args.write) {
    mkdirSync(REPORT_DIR, { recursive: true });
    const jsonPath = resolve(REPORT_DIR, 'ko-hosted-compare.json');
    const mdPath = resolve(REPORT_DIR, 'ko-hosted-compare.md');
    writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(mdPath, renderMarkdown(report));
    if (!args.quiet) {
      console.log(`Wrote ${relative(REPO_ROOT, mdPath)}`);
      console.log(`Wrote ${relative(REPO_ROOT, jsonPath)}`);
    }
  }

  if (!args.quiet) {
    console.log(
      `catch delta ${signedPct(summary.catch.delta)} ` +
        `[${signedPct(summary.catch.ci.lower)}, ${signedPct(summary.catch.ci.upper)}] ` +
        `(significant: ${summary.catchSignificant}); ` +
        `FP delta ${signedPct(summary.fp.delta)} (regressed: ${summary.fpRegressed}); ` +
        `McNemar p=${summary.mcnemar.pValue.toFixed(4)}`
    );
  }
  return report;
}

export { renderMarkdown };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
