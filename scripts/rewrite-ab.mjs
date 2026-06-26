#!/usr/bin/env node
// Rewrite-quality A/B harness: compare two rewrite configurations on the same
// fixtures so multi-pass / pipeline questions are answered with data, not
// intuition. For each fixture it produces a rewrite per config, model-grades
// both (before/after AI score, MPS, fidelity) and measures edit churn, then
// reports per-fixture winners + aggregate deltas.
//
// The multi-pass `runOuroboros` loop (detect -> rewrite -> score -> rollback with
// MPS/fidelity floors) is retained as a research baseline here, even though the
// CLI's `--ouroboros` now aliases the lighter `--verify`. The default comparison
// is `single` (one-shot rewrite) vs `ouroboros` (multi-pass) — the
// deterministic-question-with-an-LLM answer to "does multi-pass beat one pass?"
//
// LLM-backed and opt-in (like quality:live): non-deterministic, may incur
// provider cost. The core comparison/aggregation is pure and unit-tested with
// injected produce/grade functions.
//
// Usage:
//   PATINA_LIVE=1 PATINA_LIVE_PROVIDER=gemini PATINA_LIVE_API_KEY=... \
//     npm run quality:rewrite-ab -- --configs single,ouroboros --language ko --limit 3
//   npm run quality:rewrite-ab -- --json

import { resolve } from 'node:path';

import { callLLM as defaultCallLLM } from '../src/api.js';
import { loadConfig, getRepoRoot } from '../src/config.js';
import { loadCoreFile, loadPatterns, loadProfile } from '../src/loader.js';
import { runOuroboros } from '../src/ouroboros.js';
import {
  DEFAULT_POLICY,
  buildPatinaRewritePrompt,
  deliveredRewrite,
  evaluateModelGradedRewrite,
  loadLiveFixtures,
  resolveLiveSettings,
} from '../tests/quality/live-quality.mjs';

export const REWRITE_AB_SCHEMA_VERSION = 1;
export const DEFAULT_CONFIGS = ['single', 'ouroboros'];

// Normalized word-level edit ratio: 0 = identical, →1 = fully rewritten.
// Conservative rewrites should keep this low; a config that "wins" on AI score
// only by rewriting everything is visible here.
export function editChurn(original, rewrite) {
  const a = String(original ?? '').trim().split(/\s+/).filter(Boolean);
  const b = String(rewrite ?? '').trim().split(/\s+/).filter(Boolean);
  if (a.length === 0 && b.length === 0) return 0;
  // LCS length (O(n*m); fixtures are short paragraphs).
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const lcs = dp[a.length][b.length];
  const denom = a.length + b.length;
  return denom === 0 ? 0 : Math.round(((denom - 2 * lcs) / denom) * 1000) / 1000;
}

// Pick the winning config for one fixture: among configs that meet the MPS and
// fidelity floors, the lowest after-AI-score wins; ties break on lower churn.
// Returns 'none' when no config preserved meaning.
export function pickWinner(entries, policy = DEFAULT_POLICY) {
  const eligible = entries.filter(
    (e) =>
      typeof e.after_score === 'number' &&
      typeof e.mps === 'number' &&
      typeof e.fidelity === 'number' &&
      e.mps >= policy.mpsFloor &&
      e.fidelity >= policy.fidelityFloor,
  );
  if (eligible.length === 0) return 'none';
  eligible.sort((x, y) => x.after_score - y.after_score || (x.churn ?? 1) - (y.churn ?? 1));
  return eligible[0].config;
}

// Pure comparison core. `produce(config, fixture) -> rawRewrite` and
// `grade(fixture, rawRewrite) -> { before_score, after_score, mps, fidelity, ... }`
// are injected so this is unit-testable without a live model.
export async function compareRewrites({ fixtures, configs = DEFAULT_CONFIGS, produce, grade, policy = DEFAULT_POLICY }) {
  const perFixture = [];
  const tally = Object.fromEntries([...configs, 'none'].map((c) => [c, 0]));

  for (const fixture of fixtures) {
    const entries = [];
    for (const config of configs) {
      try {
        const raw = await produce(config, fixture);
        const graded = await grade(fixture, raw);
        entries.push({
          config,
          before_score: graded.before_score ?? null,
          after_score: graded.after_score ?? null,
          ai_delta: graded.ai_delta ?? null,
          mps: graded.mps ?? null,
          fidelity: graded.fidelity ?? null,
          churn: editChurn(fixture.text, deliveredRewrite(raw)),
          status: graded.status ?? null,
          errors: graded.errors ?? [],
        });
      } catch (err) {
        entries.push({ config, status: 'error', errors: [err.message], after_score: null, mps: null, fidelity: null });
      }
    }
    const winner = pickWinner(entries, policy);
    tally[winner] += 1;
    perFixture.push({ fixture_id: fixture.fixture_id, language: fixture.language, register: fixture.register, winner, entries });
  }

  return { schema_version: REWRITE_AB_SCHEMA_VERSION, configs, policy, results: perFixture, summary: summarize(perFixture, configs, tally) };
}

function mean(values) {
  const nums = values.filter((v) => typeof v === 'number');
  return nums.length ? Math.round((nums.reduce((s, v) => s + v, 0) / nums.length) * 10) / 10 : null;
}

function summarize(perFixture, configs, tally) {
  const byConfig = {};
  for (const config of configs) {
    const entries = perFixture.map((f) => f.entries.find((e) => e.config === config)).filter(Boolean);
    byConfig[config] = {
      n: entries.length,
      mean_after_score: mean(entries.map((e) => e.after_score)),
      mean_ai_delta: mean(entries.map((e) => e.ai_delta)),
      mean_mps: mean(entries.map((e) => e.mps)),
      mean_fidelity: mean(entries.map((e) => e.fidelity)),
      mean_churn: mean(entries.map((e) => e.churn)),
      wins: tally[config] ?? 0,
    };
  }
  return { byConfig, wins: tally };
}

// ---- live (LLM-backed) production runners ----

async function produceSingle(fixture, { settings, callLLM, repoRoot }) {
  const prompt = await buildPatinaRewritePrompt(fixture, { repoRoot });
  return callLLM({ prompt, apiKey: settings.apiKey, baseURL: settings.baseURL, model: settings.model, temperature: 0.2 });
}

async function produceOuroboros(fixture, { settings, callLLM, repoRoot }) {
  const config = loadConfig();
  config.language = fixture.language;
  if (fixture.profile) config.profile = fixture.profile;
  config.ouroboros = { ...(config.ouroboros || {}), enabled: true };
  const patterns = loadPatterns(repoRoot, fixture.language);
  const profile = loadProfile(repoRoot, config.profile || 'default');
  const voice = loadCoreFile(repoRoot, 'voice.md');
  const scoring = loadCoreFile(repoRoot, 'scoring.md');
  const result = await runOuroboros({
    config,
    patterns,
    profile: profile.body ? profile : null,
    voice,
    scoring,
    text: fixture.text,
    apiKey: settings.apiKey,
    baseURL: settings.baseURL,
    model: settings.model,
    callLLM: (args) => callLLM({ ...args, timeout: settings.timeoutMs }),
  });
  return result.finalText;
}

function liveProducer(deps) {
  return (config, fixture) => {
    if (config === 'single') return produceSingle(fixture, deps);
    if (config === 'ouroboros') return produceOuroboros(fixture, deps);
    throw new Error(`unknown rewrite config: ${config}`);
  };
}

function parseArgs(argv) {
  const opts = { configs: DEFAULT_CONFIGS, json: false, language: null, limit: null, live: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--live') opts.live = true;
    else if (arg === '--configs') opts.configs = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--language') opts.language = argv[++i];
    else if (arg === '--limit') opts.limit = Number(argv[++i]);
  }
  return opts;
}

function renderMarkdown(report) {
  const s = report.summary.byConfig;
  const lines = [
    '# Rewrite A/B',
    '',
    `configs: ${report.configs.join(' vs ')} | fixtures: ${report.results.length}`,
    '',
    '## Per-config aggregate',
    '',
    '| config | mean after-AI | mean ai-delta | mean MPS | mean fidelity | mean churn | wins |',
    '|---|---:|---:|---:|---:|---:|---:|',
    ...report.configs.map(
      (c) => `| ${c} | ${s[c].mean_after_score} | ${s[c].mean_ai_delta} | ${s[c].mean_mps} | ${s[c].mean_fidelity} | ${s[c].mean_churn} | ${s[c].wins} |`,
    ),
    '',
    `head-to-head wins: ${Object.entries(report.summary.wins).map(([k, v]) => `${k}=${v}`).join(' · ')}`,
    '',
  ];
  return lines.join('\n');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const repoRoot = getRepoRoot();
  const settings = resolveLiveSettings(opts);
  const live = opts.live ?? (process.env.PATINA_LIVE === '1' || Boolean(process.env.PATINA_LIVE_PROVIDER || process.env.PATINA_LIVE_API_KEY));
  if (!live) {
    console.error('Rewrite A/B is LLM-backed and opt-in. Set PATINA_LIVE=1 (+ PATINA_LIVE_PROVIDER/API_KEY) or pass --live.');
    process.exit(1);
  }
  if (!settings.hasApiKey) {
    console.error('No API key found for the live rewrite. Set PATINA_LIVE_API_KEY or the provider key.');
    process.exit(1);
  }
  let fixtures = loadLiveFixtures();
  if (opts.language) fixtures = fixtures.filter((f) => f.language === opts.language);
  if (Number.isFinite(opts.limit) && opts.limit >= 0) fixtures = fixtures.slice(0, opts.limit);
  if (fixtures.length === 0) {
    console.error('no fixtures selected');
    process.exit(1);
  }

  const deps = { settings, callLLM: defaultCallLLM, repoRoot };
  const produce = liveProducer(deps);
  const grade = (fixture, raw) => evaluateModelGradedRewrite(fixture, raw, { settings, policy: DEFAULT_POLICY, callLLM: defaultCallLLM });
  const report = await compareRewrites({ fixtures, configs: opts.configs, produce, grade });
  console.log(opts.json ? JSON.stringify(report, null, 2) : renderMarkdown(report));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
