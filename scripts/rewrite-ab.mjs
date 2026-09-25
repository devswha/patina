#!/usr/bin/env node
// Rewrite-quality A/B harness: compare two rewrite configurations on the same
// fixtures so multi-pass / pipeline questions are answered with data, not
// intuition. For each fixture it produces a rewrite per config, model-grades
// both (before/after AI score, MPS, fidelity) and measures edit churn, then
// reports per-fixture winners + aggregate deltas.
//
// The multi-pass iterative baseline (detect -> rewrite -> score -> rollback with
// MPS/fidelity floors) is retained as research-only comparison data. The default
// comparison is `single` (one-shot rewrite) vs `iterative-baseline` (multi-pass)
// to answer whether multi-pass rewriting beats one pass.
//
// LLM-backed and opt-in (like quality:live): non-deterministic, may incur
// provider cost. The core comparison/aggregation is pure and unit-tested with
// injected produce/grade functions.
//
// Usage:
//   PATINA_LIVE=1 PATINA_LIVE_PROVIDER=gemini PATINA_LIVE_API_KEY=... \
//     npm run quality:rewrite-ab -- --configs single,iterative-baseline --language ko --limit 3
//   npm run quality:rewrite-ab -- --json

import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import { callLLM as defaultCallLLM } from '../src/api.js';
import { loadConfig, getRepoRoot } from '../src/config.js';
import { loadCoreFile, loadPatterns, loadDocumentType } from '../src/loader.js';
import { fenceReferenceText } from '../src/prompt-builder.js';
import { classifyWebPromptBudget } from '../src/web-prompt-budget.js';
import { evaluateNumberSafety } from '../src/features/meaning-proxy.js';
import {
  compareKoreanStructure,
  koreanStructureDistance,
} from '../src/features/korean-structure-fingerprint.js';
import { runIterativeRewriteBaseline } from './iterative-rewrite-baseline.mjs';
import {
  DEFAULT_POLICY,
  aggregateCalls,
  buildPatinaRewritePrompt,
  createBackendJudgeCallLLM,
  createLiveCallLLM,
  deliveredRewrite,
  evaluateModelGradedRewrite,
  loadLiveFixtures,
  resolveJudgeSettings,
  resolveLiveSettings,
} from '../tests/quality/live-quality.mjs';
import { wilsonInterval } from '../tests/quality/ranking-metrics.mjs';

export const REWRITE_AB_SCHEMA_VERSION = 7;
export const DEFAULT_CONFIGS = ['single', 'iterative-baseline'];
export const REWRITE_AB_TEMPERATURE = 0.2;
export const REWRITE_CONFIGS = Object.freeze([
  'single',
  'iterative-baseline',
  'request-shaped-v1',
]);
export const ITERATIVE_BASELINE_POLICY = Object.freeze({
  targetScore: 30,
  maxIterations: 3,
  plateauThreshold: 10,
});

// Normalized word-level edit ratio: 0 = identical, →1 = fully rewritten.
// Conservative rewrites should keep this low; a config that "wins" on AI score
// only by rewriting everything is visible here.
export function editChurn(original, rewrite) {
  const a = String(original ?? '').trim().split(/\s+/).filter(Boolean);
  const b = String(rewrite ?? '').trim().split(/\s+/).filter(Boolean);
  if (a.length === 0 && b.length === 0) return 0;
  // LCS length with one bounded row instead of an O(n*m) matrix.
  const row = new Uint32Array(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = 0;
    for (let j = 1; j <= b.length; j += 1) {
      const previous = row[j];
      row[j] = a[i - 1] === b[j - 1]
        ? diagonal + 1
        : Math.max(row[j], row[j - 1]);
      diagonal = previous;
    }
  }
  const lcs = row[b.length];
  const denom = a.length + b.length;
  return denom === 0 ? 0 : Math.round(((denom - 2 * lcs) / denom) * 1000) / 1000;
}

// Pick the winning config without detector scores. Among number-safe configs
// that meet MPS/fidelity floors, preserve structure and minimize churn.
// Returns 'none' when no config preserved meaning.
export function pickWinner(entries, policy = DEFAULT_POLICY) {
  const eligible = entries.filter(
    (e) =>
      e.status !== 'error' &&
      typeof e.mps === 'number' &&
      typeof e.fidelity === 'number' &&
      e.mps >= policy.mpsFloor &&
      e.fidelity >= policy.fidelityFloor &&
      e.numberSafety?.ok !== false,
  );
  if (eligible.length === 0) return 'none';
  eligible.sort(
    (x, y) =>
      (x.structure_distance ?? 1) - (y.structure_distance ?? 1)
      || (x.churn ?? 1) - (y.churn ?? 1),
  );
  return eligible[0].config;
}

const PREFERENCE_RATING_KEYS = Object.freeze([
  'naturalness',
  'register_fit',
  'clarity',
  'cohesion',
]);

function preferenceChoice(result) {
  return typeof result === 'string' ? result : result?.winner;
}

function validPreferenceRatings(value) {
  return value && PREFERENCE_RATING_KEYS.every(
    (key) => Number.isFinite(value[key]) && value[key] >= 1 && value[key] <= 5,
  );
}

function preferenceRatingsByConfig(ab, ba, candidates) {
  if (
    !validPreferenceRatings(ab?.A)
    || !validPreferenceRatings(ab?.B)
    || !validPreferenceRatings(ba?.A)
    || !validPreferenceRatings(ba?.B)
  ) {
    return null;
  }
  const average = (left, right) => Object.fromEntries(
    PREFERENCE_RATING_KEYS.map((key) => [key, (left[key] + right[key]) / 2]),
  );
  return {
    [candidates[0].config]: average(ab.A, ba.B),
    [candidates[1].config]: average(ab.B, ba.A),
  };
}

function researchErrorCode(error) {
  const message = String(error?.message ?? '').toLowerCase();
  if (message.includes('timed out') || message.includes('timeout')) return 'timeout';
  if (message.includes('schema')) return 'schema_error';
  if (message.includes('backend')) return 'backend_error';
  return 'candidate_error';
}

// Pure comparison core. `produce(config, fixture) -> rawRewrite` and
// `grade(fixture, rawRewrite) -> { before_score, after_score, mps, fidelity, ... }`
// are injected so this is unit-testable without a live model.
export async function compareRewrites({
  fixtures,
  configs = DEFAULT_CONFIGS,
  produce,
  grade,
  prefer,
  policy = DEFAULT_POLICY,
  now = Date.now,
  costRates = null,
  experiment = null,
}) {
  if (!Array.isArray(configs) || configs.length !== 2 || new Set(configs).size !== 2) {
    throw new Error('rewrite comparison requires exactly two distinct configs');
  }
  const perFixture = [];
  const candidateTally = Object.fromEntries([...configs, 'none'].map((c) => [c, 0]));
  const preferenceTally = Object.fromEntries([...configs, 'none', 'inconsistent', 'error'].map((c) => [c, 0]));

  for (const fixture of fixtures) {
    const entries = [];
    for (const config of configs) {
      let candidateCalls = [];
      let candidate_latency_ms = null;
      let rewrite;
      let numberSafety = null;
      let structure;
      const startedAt = now();
      try {
        const produced = await produce(config, fixture);
        candidate_latency_ms = Math.max(0, now() - startedAt);
        const raw = produced && typeof produced === 'object' && 'text' in produced
          ? produced.text
          : produced;
        candidateCalls = produced && typeof produced === 'object'
          ? produced.candidateCalls ?? []
          : [];
        rewrite = deliveredRewrite(raw);
        numberSafety = fixture.language === 'ko'
          ? evaluateNumberSafety(fixture.text, rewrite, 'ko')
          : null;
        structure = fixture.language === 'ko'
          ? compareKoreanStructure(fixture.text, rewrite)
          : null;
        const gradingStartedAt = now();
        const graded = await grade(fixture, raw, candidateCalls);
        const grading_latency_ms = Math.max(0, now() - gradingStartedAt);
        const usage = {
          ...(graded.usage ?? {}),
          candidate: graded.usage?.candidate ?? aggregateCalls(candidateCalls),
          judge: graded.usage?.judge ?? null,
        };
        const entry = {
          config,
          before_score: graded.before_score ?? null,
          after_score: graded.after_score ?? null,
          ai_delta: graded.ai_delta ?? null,
          mps: graded.mps ?? null,
          fidelity: graded.fidelity ?? null,
          churn: editChurn(fixture.text, rewrite),
          structure_distance: structure?.fingerprintDistance ?? null,
          untouched_span_ratio: structure?.untouchedSpanRatio ?? null,
          number_safety_ok: numberSafety?.ok ?? null,
          candidate_latency_ms,
          grading_latency_ms,
          usage,
          estimated_cost_usd: usageCost(usage, costRates),
          status: graded.status ?? null,
          error_count: Array.isArray(graded.errors) ? graded.errors.length : 0,
        };
        Object.defineProperty(entry, 'numberSafety', { value: numberSafety, enumerable: false });
        Object.defineProperty(entry, 'sourceFingerprint', {
          value: structure?.before ?? null,
          enumerable: false,
        });
        Object.defineProperty(entry, 'rewrite', { value: rewrite, enumerable: false });
        Object.defineProperty(entry, 'structureFingerprint', {
          value: structure?.after ?? null,
          enumerable: false,
        });
        entries.push(entry);
      } catch (err) {
        if (Array.isArray(err?.candidateCalls)) candidateCalls = err.candidateCalls;
        if (candidate_latency_ms === null) {
          candidate_latency_ms = Math.max(0, now() - startedAt);
        }
        const usage = { candidate: aggregateCalls(candidateCalls), judge: null };
        const entry = {
          config,
          status: 'error',
          error_code: researchErrorCode(err),
          after_score: null,
          mps: null,
          fidelity: null,
          candidate_latency_ms,
          usage,
          estimated_cost_usd: usageCost(usage, costRates),
          number_safety_ok: numberSafety?.ok ?? null,
        };
        Object.defineProperty(entry, 'numberSafety', { value: numberSafety, enumerable: false });
        entries.push(entry);
      }
    }
    const eligible = entries.filter((entry) =>
      entry.status !== 'error' &&
      typeof entry.mps === 'number' &&
      typeof entry.fidelity === 'number' &&
      entry.mps >= policy.mpsFloor &&
      entry.fidelity >= policy.fidelityFloor &&
      entry.numberSafety?.ok !== false,
    );
    let preference_winner = 'none';
    let preference_ratings = null;
    if (prefer && eligible.length === 2) {
      try {
        const candidates = eligible.map((entry) => ({ config: entry.config, rewrite: entry.rewrite }));
        const [ab, ba] = await Promise.all([
          prefer({ fixture, candidates, order: 'AB' }),
          prefer({ fixture, candidates, order: 'BA' }),
        ]);
        const abChoice = preferenceChoice(ab);
        const baChoice = preferenceChoice(ba);
        if (!['A', 'B'].includes(abChoice) || !['A', 'B'].includes(baChoice)) {
          preference_winner = 'error';
        } else {
          const abWinner = candidates[abChoice === 'A' ? 0 : 1].config;
          const baWinner = candidates[baChoice === 'A' ? 1 : 0].config;
          preference_winner = abWinner === baWinner ? abWinner : 'inconsistent';
          preference_ratings = preferenceRatingsByConfig(ab, ba, candidates);
        }
      } catch {
        preference_winner = 'error';
      }
    }
    preferenceTally[preference_winner] += 1;
    const candidate_winner = configs.includes(preference_winner)
      ? preference_winner
      : pickWinner(entries, policy);
    const outcome = eligible.length < 2
      ? (entries.some((entry) => entry.status === 'error') ? 'error' : 'none')
      : !prefer
        ? 'none'
        : configs.includes(preference_winner)
          ? 'judged'
          : preference_winner;
    candidateTally[candidate_winner] += 1;
    perFixture.push({
      fixture_ref: createHash('sha256').update(String(fixture.fixture_id)).digest('hex').slice(0, 16),
      language: fixture.language,
      register: fixture.register,
      candidate_winner,
      preference_winner,
      ...(preference_ratings ? { preference_ratings } : {}),
      outcome,
      preference_eligible: eligible.length === 2,
      entries,
    });
  }

  return {
    schema_version: REWRITE_AB_SCHEMA_VERSION,
    configs,
    policy,
    results: perFixture,
    summary: summarize(perFixture, configs, candidateTally, preferenceTally, policy, experiment),
  };
}

function mean(values) {
  const nums = values.filter((v) => typeof v === 'number');
  return nums.length ? Math.round((nums.reduce((s, v) => s + v, 0) / nums.length) * 10) / 10 : null;
}

function meanCost(values) {
  const nums = values.filter(Number.isFinite);
  return nums.length
    ? Math.round((nums.reduce((sum, value) => sum + value, 0) / nums.length) * 1_000_000) / 1_000_000
    : null;
}

function quantile(values, probability) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function candidateUsageTotals(usage) {
  const section = usage?.candidate;
  if (
    !Number.isFinite(section?.prompt_tokens)
    || section.prompt_tokens < 0
    || !Number.isFinite(section?.completion_tokens)
    || section.completion_tokens < 0
  ) {
    return null;
  }
  return {
    prompt: section.prompt_tokens,
    completion: section.completion_tokens,
  };
}

function usageTokens(usage) {
  const totals = candidateUsageTotals(usage);
  return totals ? totals.prompt + totals.completion : null;
}

function usageCost(usage, rates) {
  const totals = candidateUsageTotals(usage);
  const rate = rates?.candidate;
  if (
    !totals
    || !Number.isFinite(rate?.input)
    || rate.input <= 0
    || !Number.isFinite(rate?.output)
    || rate.output <= 0
  ) {
    return null;
  }
  // Provider-normalized prompt/completion totals already include any cached or
  // reasoning subsets. Charging those detail fields again would double-count.
  const total = (
    totals.prompt * rate.input
    + totals.completion * rate.output
  ) / 1_000_000;
  return Math.round(total * 1_000_000) / 1_000_000;
}

function cohortStructureDistance(entries) {
  const fingerprints = entries.map((entry) => entry.structureFingerprint).filter(Boolean);
  const distances = [];
  for (let left = 0; left < fingerprints.length; left += 1) {
    for (let right = left + 1; right < fingerprints.length; right += 1) {
      distances.push(koreanStructureDistance(fingerprints[left], fingerprints[right]));
    }
  }
  return mean(distances);
}

function wilson95(successes, total) {
  if (!Number.isSafeInteger(successes) || !Number.isSafeInteger(total) || total <= 0 || successes < 0 || successes > total) return null;
  const { low, high } = wilsonInterval(successes, total, 1.96);
  return [low, high].map((value) => Math.round(value * 1000) / 1000);
}

export function evaluatePromotion(summary, configs, observedFixtureCount) {
  const [baselineName, treatmentName] = configs;
  const baseline = summary.byConfig?.[baselineName] ?? {};
  const treatment = summary.byConfig?.[treatmentName] ?? {};
  const preference = summary.preference?.byConfig?.[treatmentName] ?? {};
  const baselineRatings = summary.ratings?.byConfig?.[baselineName] ?? {};
  const treatmentRatings = summary.ratings?.byConfig?.[treatmentName] ?? {};
  const failures = [];
  const requireGate = (condition, name) => {
    if (!condition) failures.push(name);
  };
  const outcomeCount = Object.values(summary.outcomes ?? {})
    .reduce((sum, value) => sum + Number(value || 0), 0);
  const baselineFailureRate = baseline.attempted ? baseline.failures / baseline.attempted : 1;
  const treatmentFailureRate = treatment.attempted ? treatment.failures / treatment.attempted : 1;

  requireGate(
    summary.experiment?.confirmatory === true
      && summary.experiment.corpus_hash_matches === true
      && summary.experiment.configs_match === true
      && summary.experiment.language === 'ko',
    'confirmatory-binding',
  );
  requireGate(observedFixtureCount === 120, 'fixture-count');
  requireGate(outcomeCount === observedFixtureCount, 'outcome-accounting');
  requireGate(preference.judged >= 80, 'consistent-judgments');
  requireGate(preference.ci95?.[0] > 0.5, 'preference-ci');
  requireGate(treatment.p10_mps >= baseline.p10_mps - 2, 'p10-mps');
  requireGate(treatment.p10_fidelity >= baseline.p10_fidelity - 2, 'p10-fidelity');
  requireGate(treatmentRatings.cohesion >= baselineRatings.cohesion + 0.2, 'cohesion-rating');
  requireGate(
    treatmentRatings.p10_cohesion >= baselineRatings.p10_cohesion - 0.3,
    'p10-cohesion',
  );
  requireGate(
    Number.isFinite(treatment.cohort_structure_distance)
      && treatment.cohort_structure_distance >= baseline.cohort_structure_distance,
    'cohort-structure',
  );
  requireGate(
    Number.isFinite(treatment.p95_latency_ms)
      && treatment.p95_latency_ms <= baseline.p95_latency_ms * 1.25,
    'latency-budget',
  );
  requireGate(
    Number.isFinite(treatment.mean_reported_tokens)
      && treatment.mean_reported_tokens <= baseline.mean_reported_tokens * 1.2,
    'token-budget',
  );
  requireGate(
    Number.isFinite(baseline.estimated_cost_usd)
      && baseline.estimated_cost_usd > 0
      && Number.isFinite(treatment.estimated_cost_usd)
      && treatment.estimated_cost_usd > 0
      && treatment.estimated_cost_usd <= baseline.estimated_cost_usd * 1.2,
    'cost-budget',
  );
  requireGate(
    baselineFailureRate <= 0.05
      && treatmentFailureRate <= 0.05
      && Math.abs(treatmentFailureRate - baselineFailureRate) <= 0.02,
    'failure-rate',
  );
  requireGate(
    treatment.number_safety_failures <= baseline.number_safety_failures,
    'number-safety-non-regression',
  );
  requireGate(
    baseline.reported_token_rows === baseline.attempted
      && treatment.reported_token_rows === treatment.attempted,
    'token-evidence-coverage',
  );
  requireGate(
    baseline.cost_rows === baseline.attempted
      && treatment.cost_rows === treatment.attempted,
    'cost-evidence-coverage',
  );
  requireGate(
    baseline.latency_rows === baseline.attempted
      && treatment.latency_rows === treatment.attempted,
    'latency-evidence-coverage',
  );

  return {
    preregistered_fixture_count: 120,
    observed_fixture_count: observedFixtureCount,
    all_outcomes_accounted: outcomeCount === observedFixtureCount,
    cost_evidence_available: Number.isFinite(baseline.estimated_cost_usd)
      && baseline.estimated_cost_usd > 0
      && Number.isFinite(treatment.estimated_cost_usd)
      && treatment.estimated_cost_usd > 0,
    ready: failures.length === 0,
    failures,
  };
}

function summarize(perFixture, configs, candidateTally, preferenceTally, policy, experiment) {
  const outcomes = Object.fromEntries(
    ['judged', 'inconsistent', 'error', 'none'].map((outcome) => [
      outcome,
      perFixture.filter((fixture) => fixture.outcome === outcome).length,
    ]),
  );
  const byConfig = {};
  const ratingsByConfig = {};
  for (const config of configs) {
    const entries = perFixture.map((f) => f.entries.find((e) => e.config === config)).filter(Boolean);
    const successful = entries.filter((entry) =>
      typeof entry.mps === 'number'
      && typeof entry.fidelity === 'number'
      && entry.status !== 'error',
    );
    const eligible = successful.filter((entry) =>
      entry.mps >= policy.mpsFloor
      && entry.fidelity >= policy.fidelityFloor
      && entry.numberSafety?.ok !== false,
    );
    const usageValues = entries.map((entry) => usageTokens(entry.usage)).filter(Number.isFinite);
    const costValues = entries.map((entry) => entry.estimated_cost_usd).filter(Number.isFinite);
    byConfig[config] = {
      attempted: entries.length,
      successful: successful.length,
      failures: entries.length - successful.length,
      eligible: eligible.length,
      mean_after_score: mean(successful.map((e) => e.after_score)),
      mean_ai_delta: mean(successful.map((e) => e.ai_delta)),
      mean_mps: mean(successful.map((e) => e.mps)),
      mean_fidelity: mean(successful.map((e) => e.fidelity)),
      p10_mps: quantile(successful.map((e) => e.mps), 0.1),
      p10_fidelity: quantile(successful.map((e) => e.fidelity), 0.1),
      mean_churn: mean(successful.map((e) => e.churn)),
      mean_structure_distance: mean(successful.map((e) => e.structure_distance)),
      cohort_structure_distance: cohortStructureDistance(successful),
      p95_latency_ms: quantile(entries.map((e) => e.candidate_latency_ms), 0.95),
      latency_rows: entries.filter((entry) => Number.isFinite(entry.candidate_latency_ms)).length,
      p95_grading_latency_ms: quantile(successful.map((e) => e.grading_latency_ms), 0.95),
      mean_reported_tokens: mean(usageValues),
      reported_token_rows: usageValues.length,
      estimated_cost_usd: meanCost(costValues),
      cost_rows: costValues.length,
      number_safety_failures: entries.filter(
        (entry) => entry.numberSafety?.ok === false,
      ).length,
      candidate_wins: candidateTally[config] ?? 0,
      preference_wins: preferenceTally[config] ?? 0,
    };
    const ratings = perFixture
      .map((fixture) => fixture.preference_ratings?.[config])
      .filter(Boolean);
    ratingsByConfig[config] = Object.fromEntries(
      PREFERENCE_RATING_KEYS.map((key) => [key, mean(ratings.map((rating) => rating[key]))]),
    );
    ratingsByConfig[config].p10_cohesion = quantile(
      ratings.map((rating) => rating.cohesion),
      0.1,
    );
  }
  const paired = perFixture
    .map((fixture) => configs.map((config) => fixture.entries.find((entry) => entry.config === config)))
    .filter((entries) => entries.every(
      (entry) =>
        entry?.status !== 'error'
        && typeof entry?.after_score === 'number'
        && typeof entry?.mps === 'number'
        && typeof entry?.fidelity === 'number',
    ));
  const judged = configs.reduce((total, config) => total + (preferenceTally[config] ?? 0), 0);
  const preferenceRates = Object.fromEntries(configs.map((config) => {
    const wins = preferenceTally[config] ?? 0;
    return [config, { wins, judged, rate: judged ? Math.round((wins / judged) * 1000) / 1000 : null, ci95: wilson95(wins, judged) }];
  }));
  const summary = {
    experiment,
    byConfig,
    candidate_wins: candidateTally,
    preference_wins: preferenceTally,
    paired: {
      n: paired.length,
      after_score_delta_second_minus_first: mean(paired.map(([first, second]) => second.after_score - first.after_score)),
      mps_delta_second_minus_first: mean(paired.map(([first, second]) => second.mps - first.mps)),
      fidelity_delta_second_minus_first: mean(paired.map(([first, second]) => second.fidelity - first.fidelity)),
    },
    preference: {
      eligible: perFixture.filter((fixture) => fixture.preference_eligible).length,
      judged,
      inconsistent: preferenceTally.inconsistent ?? 0,
      errors: preferenceTally.error ?? 0,
      none: preferenceTally.none ?? 0,
      byConfig: preferenceRates,
    },
    outcomes,
    ratings: { byConfig: ratingsByConfig },
  };
  summary.promotion = evaluatePromotion(summary, configs, perFixture.length);
  summary.decision = summary.promotion.ready ? 'promote' : 'advisory_only';
  return summary;
}

// ---- live (LLM-backed) production runners ----

async function produceSingle(fixture, { settings, callLLM, repoRoot }) {
  const prompt = await buildPatinaRewritePrompt(fixture, { repoRoot });
  return callLLM({ prompt, apiKey: settings.apiKey, baseURL: settings.baseURL, model: settings.model, temperature: REWRITE_AB_TEMPERATURE });
}

export function requestShapedPromptMode(fixture) {
  return classifyWebPromptBudget({
    mode: fixture.mode || 'first',
    lang: fixture.language,
    text: fixture.text,
    documentType: fixture.documentType || 'default',
    persona: fixture.persona,
    register: fixture.requestRegister,
    jargon: fixture.jargon,
    rewriteHeadings: fixture.rewriteHeadings,
    original: fixture.original ?? fixture.text,
    history: fixture.history ?? [],
  }).selected;
}

async function produceRequestShaped(fixture, { settings, callLLM, repoRoot }) {
  const promptMode = requestShapedPromptMode(fixture);
  const prompt = await buildPatinaRewritePrompt(fixture, {
    repoRoot,
    promptMode,
    minimalStructureGuidance: promptMode === 'minimal' ? 'short-safe-v1' : 'baseline',
  });
  return callLLM({ prompt, apiKey: settings.apiKey, baseURL: settings.baseURL, model: settings.model, temperature: REWRITE_AB_TEMPERATURE });
}

async function produceIterativeBaseline(fixture, { settings, callLLM, repoRoot, config }) {
  const baselineConfig = {
    ...config,
    language: fixture.language,
    ...(fixture.documentType ? { documentType: fixture.documentType } : {}),
  };
  const patterns = loadPatterns(repoRoot, fixture.language);
  const documentType = loadDocumentType(repoRoot, baselineConfig.documentType || 'default');
  const voice = loadCoreFile(repoRoot, 'voice.md');
  const scoring = loadCoreFile(repoRoot, 'scoring.md');
  const result = await runIterativeRewriteBaseline({
    config: baselineConfig,
    policy: ITERATIVE_BASELINE_POLICY,
    patterns,
    documentType,
    voice,
    scoring,
    text: fixture.text,
    apiKey: settings.apiKey,
    baseURL: settings.baseURL,
    model: settings.model,
    callLLM: (args) => callLLM({
      ...args,
      temperature: REWRITE_AB_TEMPERATURE,
      timeout: settings.timeoutMs,
    }),
  });
  return result.finalText;
}

function liveProducer(deps) {
  return async (config, fixture) => {
    const candidateCalls = [];
    const trackedCallLLM = createLiveCallLLM(
      deps.callLLM,
      deps.settings,
      (call) => candidateCalls.push(call),
    );
    const trackedDeps = { ...deps, callLLM: trackedCallLLM };
    let text;
    try {
      if (config === 'single') text = await produceSingle(fixture, trackedDeps);
      else if (config === 'iterative-baseline') text = await produceIterativeBaseline(fixture, trackedDeps);
      else if (config === 'request-shaped-v1') text = await produceRequestShaped(fixture, trackedDeps);
      else throw new Error(`unknown rewrite config: ${config}`);
    } catch (error) {
      const trackedError = error instanceof Error ? error : new Error(String(error));
      Object.defineProperty(trackedError, 'candidateCalls', {
        value: candidateCalls,
        enumerable: false,
      });
      throw trackedError;
    }
    return { text, candidateCalls };
  };
}

export function assertTrustedLocalFixtures({
  candidate,
  judge,
  fixturePath,
  fixtures,
  repoRoot,
}) {
  if (!candidate?.backend && !judge?.backend) return;
  let fixtureRoot;
  let realFixturePath;
  try {
    fixtureRoot = realpathSync(resolve(repoRoot, 'tests/fixtures'));
    realFixturePath = realpathSync(resolve(fixturePath));
  } catch {
    throw new Error('local-agent backends require existing repo-owned fixture paths');
  }
  const relativePath = relative(fixtureRoot, realFixturePath);
  if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error('local-agent backends require repo-owned fixture paths');
  }
  if (!fixtures.every((fixture) => fixture.redistribution === 'repo-ok')) {
    throw new Error('local-agent backends require repo-ok fixtures');
  }
}

export function parseArgs(argv) {
  const opts = { configs: DEFAULT_CONFIGS, fixtures: null, json: false, language: null, limit: null, live: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--live') opts.live = true;
    else if (arg === '--configs') opts.configs = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (arg === '--fixtures') opts.fixtures = argv[++i];
    else if (arg === '--fixture-id') opts.fixtureId = argv[++i];
    else if (arg === '--language') opts.language = argv[++i];
    else if (arg === '--limit') opts.limit = Number(argv[++i]);
    else if (arg === '--backend') opts.backend = argv[++i];
    else if (arg === '--judge-provider') opts.judgeProvider = argv[++i];
    else if (arg === '--judge-model') opts.judgeModel = argv[++i];
    else if (arg === '--judge-base-url') opts.judgeBaseURL = argv[++i];
    else if (arg === '--judge-timeout-ms') opts.judgeTimeoutMs = Number(argv[++i]);
    else if (arg === '--judge-backend') opts.judgeBackend = argv[++i];
    else if (arg === '--candidate-input-cost-per-million') opts.candidateInputCostPerMillion = Number(argv[++i]);
    else if (arg === '--candidate-output-cost-per-million') opts.candidateOutputCostPerMillion = Number(argv[++i]);
    else if (arg === '--judge-extra-body') opts.judgeExtraBody = argv[++i];
    else if (arg === '--help') {
      console.log('Usage: quality:rewrite-ab -- [--configs single,iterative-baseline|request-shaped-v1 --language ko [--fixture-id ko-blog-01]] --live [--backend codex-cli] [--judge-backend claude-cli] [--candidate-input-cost-per-million N --candidate-output-cost-per-million N]');
      process.exit(0);
    }
    else throw new Error(`unknown rewrite-ab option: ${arg}`);
  }
  return opts;
}

export function buildPreferenceJudgePrompt({ original, candidates, order }) {
  const [first, second] = order === 'AB' ? candidates : [candidates[1], candidates[0]];
  return [
    'You are a native-Korean blind rewrite-quality judge. Return JSON only: {"winner":"A|B","A":{"naturalness":1-5,"register_fit":1-5,"clarity":1-5,"cohesion":1-5},"B":{"naturalness":1-5,"register_fit":1-5,"clarity":1-5,"cohesion":1-5}}. Choose the more faithful, natural, register-appropriate, clear, cohesive, minimally over-edited, and publishable candidate.',
    fenceReferenceText(original, { label: '## Original' }),
    fenceReferenceText(first.rewrite, { label: '## Candidate A' }),
    fenceReferenceText(second.rewrite, { label: '## Candidate B' }),
  ].join('\n');
}

export function createPreferenceJudge(judgeSettings, callLLM = defaultCallLLM) {
  if (!judgeSettings) throw new Error('A fixed judge is required for blind preference comparison; configure PATINA_LIVE_JUDGE_* settings.');
  if (!judgeSettings.backend && !judgeSettings.hasApiKey) {
    throw new Error('Fixed HTTP judge has no API key; configure PATINA_LIVE_JUDGE_API_KEY or matching primary HTTP credentials.');
  }
  return async ({ fixture, candidates, order }) => {
    const response = await callLLM({
      prompt: buildPreferenceJudgePrompt({ original: fixture.text, candidates, order }),
      apiKey: judgeSettings.apiKey,
      baseURL: judgeSettings.baseURL,
      model: judgeSettings.model,
      temperature: 0,
      timeout: judgeSettings.timeoutMs,
      ...(judgeSettings.extraBody ? { extraBody: judgeSettings.extraBody } : {}),
    });
    const raw = String(response).trim();
    const jsonText = raw.startsWith('```')
      ? raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
      : raw;
    const parsed = JSON.parse(jsonText);
    if (
      !['A', 'B'].includes(parsed?.winner)
      || !validPreferenceRatings(parsed.A)
      || !validPreferenceRatings(parsed.B)
    ) {
      throw new Error('blind preference judge returned an invalid rating object');
    }
    return parsed;
  };
}

export function assertIndependentJudge(candidate, judge) {
  if (!judge) throw new Error('an independent fixed judge is required');
  if (candidate.backend && judge.backend && candidate.backend === judge.backend) {
    throw new Error('producer and judge must use independent backend settings');
  }
  const family = (settings) => {
    const backendFamilies = {
      'codex-cli': 'openai',
      'claude-cli': 'anthropic',
      'gemini-cli': 'google',
      'kimi-cli': 'moonshot',
      'glm-cli': 'zhipu',
    };
    if (settings.backend) return backendFamilies[settings.backend] ?? null;
    const providerFamilies = {
      openai: 'openai',
      claude: 'anthropic',
      anthropic: 'anthropic',
      gemini: 'google',
      google: 'google',
      kimi: 'moonshot',
      moonshot: 'moonshot',
      glm: 'zhipu',
      zhipu: 'zhipu',
      deepseek: 'deepseek',
    };
    if (providerFamilies[settings.provider]) return providerFamilies[settings.provider];
    const hint = `${settings.model ?? ''} ${settings.baseURL ?? ''}`.toLowerCase();
    if (/\b(gemini|googleapis)\b/.test(hint)) return 'google';
    if (/\b(claude|anthropic)\b/.test(hint)) return 'anthropic';
    if (/\b(gpt|openai|codex|o[1-9])\b/.test(hint)) return 'openai';
    if (/\b(kimi|moonshot)\b/.test(hint)) return 'moonshot';
    if (/\b(glm|bigmodel|zhipu)\b/.test(hint)) return 'zhipu';
    if (/\b(deepseek)\b/.test(hint)) return 'deepseek';
    return null;
  };
  const mixedTransport = Boolean(candidate.backend) !== Boolean(judge.backend);
  const candidateFamily = family(candidate);
  const judgeFamily = family(judge);
  // Any pair whose provider families are both known and equal is not
  // independent, regardless of transport shape: HTTP+HTTP same-family pairs
  // (e.g. two OpenAI-compatible endpoints with different model strings) are
  // rejected exactly like mixed CLI/HTTP same-family pairs. Mixed-transport
  // pairs with an unidentifiable side stay fail-closed as before.
  if (candidateFamily && judgeFamily && candidateFamily === judgeFamily) {
    throw new Error('producer and judge must use independently identifiable provider settings');
  }
  if (mixedTransport && (!candidateFamily || !judgeFamily)) {
    throw new Error('producer and judge must use independently identifiable provider settings');
  }
  if (candidate.model && judge.model && candidate.model === judge.model) {
    throw new Error('producer and judge must use independent model settings');
  }
  const candidateIdentity = candidate.backend
    ? `backend:${candidate.backend}:${candidate.model ?? ''}`
    : `http:${candidate.baseURL ?? ''}:${candidate.model ?? ''}`;
  const judgeIdentity = judge.backend
    ? `backend:${judge.backend}:${judge.model ?? ''}`
    : `http:${judge.baseURL ?? ''}:${judge.model ?? ''}`;
  if (candidateIdentity === judgeIdentity) {
    throw new Error('producer and judge must use independent model settings');
  }
}

function renderMarkdown(report) {
  const s = report.summary.byConfig;
  const lines = [
    '# Rewrite A/B',
    '',
    `configs: ${report.configs.join(' vs ')} | fixtures: ${report.results.length} | decision: ${report.summary.decision}`,
    '',
    '## Per-config aggregate',
    '',
    '| config | attempted | successful | eligible | mean after-AI | mean ai-delta | mean MPS | mean fidelity | mean churn | candidate wins | preference wins |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...report.configs.map(
      (c) => `| ${c} | ${s[c].attempted} | ${s[c].successful} | ${s[c].eligible} | ${s[c].mean_after_score} | ${s[c].mean_ai_delta} | ${s[c].mean_mps} | ${s[c].mean_fidelity} | ${s[c].mean_churn} | ${s[c].candidate_wins} | ${s[c].preference_wins} |`,
    ),
    '',
    `candidate wins: ${Object.entries(report.summary.candidate_wins).map(([k, v]) => `${k}=${v}`).join(' · ')}`,
    `preference wins: ${Object.entries(report.summary.preference_wins).map(([k, v]) => `${k}=${v}`).join(' · ')}`,
    `preference evidence: eligible=${report.summary.preference.eligible} · judged=${report.summary.preference.judged} · inconsistent=${report.summary.preference.inconsistent} · errors=${report.summary.preference.errors}`,
    `paired successful rows: ${report.summary.paired.n} · after-score Δ(second−first)=${report.summary.paired.after_score_delta_second_minus_first} · MPS Δ=${report.summary.paired.mps_delta_second_minus_first} · fidelity Δ=${report.summary.paired.fidelity_delta_second_minus_first}`,
    ...report.configs.map((config) => {
      const preference = report.summary.preference.byConfig[config];
      return `${config} blind preference: ${preference.wins}/${preference.judged} · rate=${preference.rate} · Wilson95=${preference.ci95 ? preference.ci95.join('–') : 'n/a'}`;
    }),
    ...report.configs.map((config) => {
      const configSummary = report.summary.byConfig[config];
      const ratings = report.summary.ratings.byConfig[config];
      return `${config} safety/quality: p10 MPS=${configSummary.p10_mps} · p10 fidelity=${configSummary.p10_fidelity} · native ratings(naturalness/register/clarity/cohesion)=${ratings.naturalness}/${ratings.register_fit}/${ratings.clarity}/${ratings.cohesion}`;
    }),
    ...report.configs.map((config) => {
      const configSummary = report.summary.byConfig[config];
      return `${config} structure/ops: candidate distance=${configSummary.mean_structure_distance} · cohort distance=${configSummary.cohort_structure_distance} · p95 latency=${configSummary.p95_latency_ms}ms · reported tokens=${configSummary.mean_reported_tokens} · estimated cost=${configSummary.estimated_cost_usd ?? 'n/a'}`;
    }),
    `outcomes: ${Object.entries(report.summary.outcomes).map(([key, value]) => `${key}=${value}`).join(' · ')}`,
    `promotion ready: ${report.summary.promotion.ready} · observed=${report.summary.promotion.observed_fixture_count}/${report.summary.promotion.preregistered_fixture_count} · cost evidence=${report.summary.promotion.cost_evidence_available}`,
    '',
  ];
  return lines.join('\n');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const repoRoot = getRepoRoot();
  const configs = opts.configs;
  const fixtureSource = opts.fixtures ?? resolve(repoRoot, 'tests/fixtures/live-quality');
  const language = opts.language;
  const invalidConfig = configs.find((config) => !REWRITE_CONFIGS.includes(config));
  if (invalidConfig) throw new Error(`unknown rewrite config: ${invalidConfig}. Accepted configs: ${REWRITE_CONFIGS.join(', ')}`);
  const settings = resolveLiveSettings(opts);
  const live = opts.live ?? (
    process.env.PATINA_LIVE === '1'
    || Boolean(process.env.PATINA_LIVE_PROVIDER || process.env.PATINA_LIVE_API_KEY || process.env.PATINA_LIVE_BACKEND)
  );
  if (!live) {
    console.error('Rewrite A/B is LLM-backed and opt-in. Set PATINA_LIVE=1 (+ PATINA_LIVE_PROVIDER/API_KEY) or pass --live.');
    process.exit(1);
  }
  if (!settings.backend && !settings.hasApiKey) {
    console.error('No live credential found. Set PATINA_LIVE_API_KEY or PATINA_LIVE_BACKEND.');
    process.exit(1);
  }
  let fixtures = loadLiveFixtures(fixtureSource);
  if (language) fixtures = fixtures.filter((f) => f.language === language);
  if (opts.fixtureId) fixtures = fixtures.filter((fixture) => fixture.fixture_id === opts.fixtureId);
  if (Number.isFinite(opts.limit) && opts.limit >= 0) fixtures = fixtures.slice(0, opts.limit);
  if (fixtures.length === 0) {
    console.error('no fixtures selected');
    process.exit(1);
  }

  const config = loadConfig();
  const fixedJudge = resolveJudgeSettings(opts, settings);
  assertIndependentJudge(settings, fixedJudge);
  assertTrustedLocalFixtures({
    candidate: settings,
    judge: fixedJudge,
    fixturePath: fixtureSource,
    fixtures,
    repoRoot,
  });
  const candidateCallLLM = settings.backend
    ? createBackendJudgeCallLLM(settings)
    : defaultCallLLM;
  const deps = { settings, callLLM: candidateCallLLM, repoRoot, config };
  const produce = liveProducer(deps);
  const policy = {
    ...DEFAULT_POLICY,
    mpsFloor: config.verification?.['mps-floor'] ?? DEFAULT_POLICY.mpsFloor,
    fidelityFloor: config.verification?.['fidelity-floor'] ?? DEFAULT_POLICY.fidelityFloor,
  };
  const judgeCallLLM = fixedJudge?.backend
    ? createBackendJudgeCallLLM(fixedJudge)
    : defaultCallLLM;
  const grade = (fixture, raw, candidateCalls) => evaluateModelGradedRewrite(fixture, raw, {
    settings: fixedJudge,
    policy,
    callLLM: judgeCallLLM,
    candidateCalls,
  });
  const prefer = createPreferenceJudge(fixedJudge, judgeCallLLM);
  const costRates = Number.isFinite(opts.candidateInputCostPerMillion)
    && opts.candidateInputCostPerMillion > 0
    && Number.isFinite(opts.candidateOutputCostPerMillion)
    && opts.candidateOutputCostPerMillion > 0
    ? {
        candidate: {
          input: opts.candidateInputCostPerMillion,
          output: opts.candidateOutputCostPerMillion,
        },
      }
    : null;
  const report = await compareRewrites({
    fixtures,
    configs,
    produce,
    grade,
    prefer,
    policy,
    costRates,
  });
  console.log(opts.json ? JSON.stringify(report, null, 2) : renderMarkdown(report));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
