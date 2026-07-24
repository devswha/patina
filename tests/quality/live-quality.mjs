#!/usr/bin/env node

/**
 * Opt-in live rewrite quality runner.
 *
 * Default execution never calls a model: it scores fixture inputs and reports a
 * skipped live pass. Pass --live or set PATINA_LIVE=1 / PATINA_LIVE_* env vars
 * to run credentialed OpenAI-compatible rewrites and model-graded checks.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { callLLM as defaultCallLLM } from '../../src/api.js';
import { invokeBackendChain, resolveBackend } from '../../src/backends/index.js';
import { providerHttpKeyEnvVars, resolveHttpApiKey } from '../../src/auth.js';
import { loadConfig, getRepoRoot } from '../../src/config.js';
import { loadCoreFile, loadPatterns, loadProfile } from '../../src/loader.js';
import { formatOutput } from '../../src/output.js';
import { buildPrompt } from '../../src/prompt-builder.js';
import { resolveProviderConfig, selectProvider } from '../../src/providers.js';
import { scoreFidelity, scoreMPS, scoreText } from '../../src/scoring.js';
import { scoreText as scoreProseText } from '../../scripts/prose-score.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const DEFAULT_FIXTURE_DIR = resolve(REPO_ROOT, 'tests/fixtures/live-quality');
const LEGACY_FIXTURE_PATH = resolve(REPO_ROOT, 'tests/quality/live-fixtures.jsonl');

export const LIVE_QUALITY_SCHEMA_VERSION = 1;
export const DEFAULT_POLICY = Object.freeze({
  aiAfterCeiling: 30,
  mpsFloor: 70,
  fidelityFloor: 70,
  requireAiImprovement: true,
});

const REQUIRED_FIXTURE_FIELDS = ['fixture_id', 'language', 'redistribution', 'text'];

export function loadLiveFixtures(source = DEFAULT_FIXTURE_DIR) {
  const resolved = resolve(source);
  if (existsSync(resolved) && statSync(resolved).isDirectory()) {
    return loadMarkdownFixtureDir(resolved);
  }
  if (existsSync(resolved)) {
    return loadJsonlFixtures(resolved);
  }
  return loadJsonlFixtures(LEGACY_FIXTURE_PATH);
}

function loadJsonlFixtures(fixturePath) {
  const body = readFileSync(fixturePath, 'utf8');
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => validateFixture(JSON.parse(line), `${fixturePath}:${index + 1}`));
}

function loadMarkdownFixtureDir(root) {
  const paths = collectMarkdownFiles(root);
  if (paths.length === 0) throw new Error(`no live-quality markdown fixtures found in ${root}`);
  return paths.map((path) => parseMarkdownFixture(path));
}

function collectMarkdownFiles(root) {
  const entries = readdirSync(root, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) paths.push(...collectMarkdownFiles(path));
    else if (entry.isFile() && extname(entry.name) === '.md') paths.push(path);
  }
  return paths.sort();
}

function parseMarkdownFixture(path) {
  const raw = readFileSync(path, 'utf8');
  const match = raw.match(/^---\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
  if (!match) throw new Error(`${path}: missing YAML frontmatter`);
  const meta = yaml.load(match[1]) || {};
  return validateFixture({ ...meta, text: match[2].trim() }, path);
}

function validateFixture(fixture, source) {
  for (const field of REQUIRED_FIXTURE_FIELDS) {
    if (!(field in fixture)) throw new Error(`missing ${field} in ${source}`);
  }
  if (!['en', 'ko', 'zh', 'ja'].includes(fixture.language)) {
    throw new Error(`unsupported language ${fixture.language} in ${source}`);
  }
  const anchors = normalizeStringArray(fixture.anchors ?? fixture.facts, `${source}: anchors`);
  if (anchors.length === 0) throw new Error(`anchors/facts must be a non-empty array in ${source}`);
  return {
    register: 'unspecified',
    source_type: 'fixture',
    model_family: 'fixture',
    prompt_id: 'live-quality-v2',
    ...fixture,
    anchors,
    facts: anchors,
    expected_focus: normalizeStringArray(fixture.expected_focus, `${source}: expected_focus`, { required: false }),
  };
}

function normalizeStringArray(value, source, { required = true } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${source} must be an array`);
    return [];
  }
  if (!Array.isArray(value)) throw new Error(`${source} must be an array`);
  return value.map((item) => String(item).trim()).filter(Boolean);
}

export async function buildPatinaRewritePrompt(fixture, { repoRoot = getRepoRoot() } = {}) {
  const config = loadConfig();
  config.language = fixture.language;
  if (fixture.profile) config.profile = fixture.profile;

  const patterns = loadPatterns(repoRoot, fixture.language);
  const profile = loadProfile(repoRoot, config.profile || 'default');
  const voice = loadCoreFile(repoRoot, 'voice.md');

  return buildPrompt({
    config,
    patterns,
    profile: profile.body ? profile : null,
    voice: voice.body ? voice : null,
    scoring: null,
    text: fixture.text,
    mode: 'rewrite',
  });
}

export function deliveredRewrite(rawRewrite, { logger = { warn() {} } } = {}) {
  return formatOutput(String(rawRewrite || ''), 'rewrite', {}, { logger }).trim();
}

export function evaluateRewriteQuality(fixture, rawRewrite, { repoRoot = REPO_ROOT } = {}) {
  const rewrite = deliveredRewrite(rawRewrite);
  const before = scoreProseText(fixture.text, {
    file: `${fixture.fixture_id}.md`,
    lang: fixture.language,
    repoRoot,
  });
  const after = scoreProseText(rewrite, {
    file: `${fixture.fixture_id}.rewrite.md`,
    lang: fixture.language,
    repoRoot,
  });
  const humanizationGain = round1(before.score - after.score);
  const meaningSafety = round1(computeMeaningSafety(fixture, rewrite));
  const safeGain = round1(Math.max(0, humanizationGain) * (meaningSafety / 100));
  const status = classifyQuality({ afterScore: after.score, meaningSafety, safeGain });
  const facts = preservedFacts(fixture.facts, rewrite, fixture.language);

  return {
    fixture_id: fixture.fixture_id,
    language: fixture.language,
    register: fixture.register,
    mode: 'offline-candidate',
    before_score: round1(before.score),
    after_score: round1(after.score),
    humanization_gain: humanizationGain,
    meaning_safety: meaningSafety,
    safe_gain: safeGain,
    status,
    preserved_facts: facts.preserved,
    total_facts: facts.total,
  };
}

export async function evaluateModelGradedRewrite(fixture, rawRewrite, options = {}) {
  const repoRoot = options.repoRoot || REPO_ROOT;
  const policy = options.policy || DEFAULT_POLICY;
  const settings = options.settings || resolveLiveSettings(options);
  const judgeSettings = options.judgeSettings !== undefined
    ? options.judgeSettings
    : resolveJudgeSettings(options, settings);
  const judge = judgeSettings || settings;
  const rewrite = deliveredRewrite(rawRewrite, { logger: options.logger });
  const config = loadConfig();
  config.language = fixture.language;
  if (fixture.profile) config.profile = fixture.profile;
  const patterns = loadPatterns(repoRoot, fixture.language);
  const deadline = judge.timeoutMs ? Date.now() + judge.timeoutMs : undefined;
  const judgeCalls = [];
  const baseCallLLM = options.callLLM
    || (judge.backend ? createBackendJudgeCallLLM(judge, options.backendDeps) : defaultCallLLM);
  const callLLM = createLiveCallLLM(baseCallLLM, judge, (call) => judgeCalls.push(call));

  const common = {
    apiKey: judge.apiKey,
    baseURL: judge.baseURL,
    model: judge.model,
    deadline,
    callLLM,
    logger: options.logger,
  };

  const [beforeScore, afterScore, mpsResult, fidelityResult] = await Promise.all([
    scoreText({ text: fixture.text, config, patterns, ...common }),
    scoreText({ text: rewrite, config, patterns, ...common }),
    scoreMPS({ original: fixture.text, rewritten: rewrite, ...common }),
    scoreFidelity({ original: fixture.text, rewritten: rewrite, ...common }),
  ]);

  const result = modelGradedResult({
    fixture,
    beforeScore,
    afterScore,
    mpsResult,
    fidelityResult,
    policy,
  });
  result.usage = {
    candidate: aggregateCalls(options.candidateCalls || []),
    judge: aggregateCalls(judgeCalls),
  };
  return result;
}

/**
 * Normalize provider usage payloads (OpenAI-compat and native Anthropic
 * shapes) into one token accounting so judge cost distortions — hidden
 * reasoning tokens, cache reads/writes — are visible per run.
 */
export function normalizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const toCount = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);
  return {
    prompt_tokens: toCount(usage.prompt_tokens ?? usage.input_tokens),
    completion_tokens: toCount(usage.completion_tokens ?? usage.output_tokens),
    reasoning_tokens: toCount(usage.completion_tokens_details?.reasoning_tokens),
    cached_read_tokens: toCount(usage.prompt_tokens_details?.cached_tokens ?? usage.cache_read_input_tokens),
    cache_write_tokens: toCount(usage.cache_creation_input_tokens),
  };
}

/**
 * Aggregate recorded live calls into totals. Token sums stay null until at
 * least one call reports that field, so "provider reported nothing" is
 * distinguishable from "zero tokens".
 */
export function aggregateCalls(calls) {
  const totals = {
    calls: calls.length,
    duration_ms: 0,
    attempts: 0,
    prompt_tokens: null,
    completion_tokens: null,
    reasoning_tokens: null,
    cached_read_tokens: null,
    cache_write_tokens: null,
  };
  for (const call of calls) {
    totals.duration_ms += Number.isFinite(call?.ms) ? call.ms : 0;
    totals.attempts += Number.isFinite(call?.attempts) && call.attempts > 0 ? call.attempts : 1;
    const usages = Array.isArray(call?.usages) ? call.usages : (call?.usage ? [call.usage] : []);
    for (const raw of usages) {
      const usage = normalizeUsage(raw);
      if (!usage) continue;
      for (const key of ['prompt_tokens', 'completion_tokens', 'reasoning_tokens', 'cached_read_tokens', 'cache_write_tokens']) {
        if (usage[key] === null) continue;
        totals[key] = (totals[key] ?? 0) + usage[key];
      }
    }
  }
  return totals;
}

function modelGradedResult({ fixture, beforeScore, afterScore, mpsResult, fidelityResult, policy }) {
  const before = numberOrNull(beforeScore?.overall);
  const after = numberOrNull(afterScore?.overall);
  const mps = numberOrNull(mpsResult?.mps);
  const fidelity = numberOrNull(fidelityResult?.fidelity);
  const errors = [];
  const violations = [];

  if (before === null || beforeScore?.error) errors.push('before-score-unavailable');
  if (after === null || afterScore?.error) errors.push('after-score-unavailable');
  if (mps === null || mpsResult?.error) errors.push('mps-unavailable');
  if (fidelity === null || fidelityResult?.error) errors.push('fidelity-unavailable');

  if (mps !== null && mps < policy.mpsFloor) violations.push(`mps<${policy.mpsFloor}`);
  if (fidelity !== null && fidelity < policy.fidelityFloor) violations.push(`fidelity<${policy.fidelityFloor}`);
  if (after !== null && after > policy.aiAfterCeiling) violations.push(`ai_after>${policy.aiAfterCeiling}`);
  if (policy.requireAiImprovement && before !== null && after !== null && after >= before) {
    violations.push('ai_not_improved');
  }

  const meaningUnsafe = violations.some((item) => item.startsWith('mps<') || item.startsWith('fidelity<'));
  const status = errors.length > 0 || meaningUnsafe
    ? 'error'
    : violations.length > 0
      ? 'warn'
      : 'pass';

  return {
    fixture_id: fixture.fixture_id,
    language: fixture.language,
    register: fixture.register,
    mode: 'live-api',
    status,
    before_score: before,
    after_score: after,
    ai_delta: before !== null && after !== null ? round1(before - after) : null,
    mps,
    fidelity,
    policy_violations: violations,
    errors,
  };
}

function createLiveCallLLM(callLLM, settings, record) {
  return async (args) => {
    const startedAt = Date.now();
    // Per-attempt usages include tokens burnt on failed paid retries; the
    // final-response usage is only a fallback when no attempt reported one.
    const attemptUsages = [];
    let responseUsage = null;
    let model = null;
    let attempts = 0;
    const onResponse = (meta) => {
      if (meta?.usage) responseUsage = meta.usage;
      if (meta?.model) model = meta.model;
      if (typeof args.onResponse === 'function') args.onResponse(meta);
    };
    const onAttempt = (attempt) => {
      attempts += 1;
      if (attempt?.usage) attemptUsages.push(attempt.usage);
      if (typeof args.onAttempt === 'function') args.onAttempt(attempt);
    };
    try {
      return await callLLM({
        ...args,
        timeout: settings.timeoutMs,
        onResponse,
        onAttempt,
      });
    } finally {
      record?.({
        ms: Date.now() - startedAt,
        model: model ?? args.model ?? null,
        usages: attemptUsages.length ? attemptUsages : (responseUsage ? [responseUsage] : []),
        attempts,
      });
    }
  };
}

/**
 * Adapt a local subscription CLI backend (codex-cli, claude-cli, gemini-cli,
 * kimi-cli) into the callLLM shape the scoring functions consume, so the
 * fixed judge can run on a logged-in seat without an API key. CLI backends
 * report no token usage; the usage capture records calls and wall time only.
 */
export function createBackendJudgeCallLLM(judge, deps = {}) {
  const invoke = deps.invokeBackendChain || invokeBackendChain;
  const resolve = deps.resolveBackend || resolveBackend;
  const backend = resolve(judge.backend);
  return (args) => invoke({
    backends: [backend],
    prompt: args.prompt,
    model: judge.model ?? null,
    modelSource: judge.model ? 'option:judgeModel' : 'default',
    signal: args.signal,
    timeout: judge.timeoutMs,
    onResponse: args.onResponse,
  });
}

export function computeMeaningSafety(fixture, rewrite) {
  const facts = preservedFacts(fixture.facts, rewrite, fixture.language);
  const factScore = facts.total ? (facts.preserved.length / facts.total) * 100 : 100;
  const lengthScore = lengthSafetyScore(fixture.text, rewrite);
  return Math.min(factScore, lengthScore);
}

export function classifyQuality({ afterScore, meaningSafety, safeGain }) {
  if (afterScore <= 30 && meaningSafety >= 70 && safeGain > 0) return 'pass';
  if (meaningSafety >= 70 && safeGain > 0) return 'warn';
  return 'fail';
}

export async function runLiveQuality(options = {}) {
  const report = await runLiveQualityReport(options);
  return report.results;
}

export async function runLiveQualityReport(options = {}) {
  const fixtures = selectFixtures(options.fixtures ?? loadLiveFixtures(options.fixturePath), options);
  const policy = { ...DEFAULT_POLICY, ...(options.policy || {}) };
  const liveRequested = shouldRunLive(options);
  const settings = resolveLiveSettings(options);
  const judgeSettings = resolveJudgeSettings(options, settings);
  const candidateDir = options.candidateDir ? resolve(options.candidateDir) : null;
  const results = [];

  if (fixtures.length === 0) throw new Error('no live-quality fixtures selected');

  for (const fixture of fixtures) {
    const candidate = candidateDir ? readCandidate(candidateDir, fixture.fixture_id) : null;
    if (!liveRequested && !candidate) {
      results.push(skippedResult(fixture, 'live rewrite disabled; pass --live, set PATINA_LIVE=1, or pass --candidate-dir'));
      continue;
    }
    if (liveRequested && !settings.hasApiKey) {
      results.push(failedResult(fixture, new Error('live rewrite requested but no API key was found')));
      continue;
    }
    if (liveRequested && judgeSettings && !judgeSettings.backend && !judgeSettings.hasApiKey) {
      results.push(failedResult(fixture, new Error('fixed judge requested but no judge API key was found (set PATINA_LIVE_JUDGE_API_KEY or PATINA_LIVE_JUDGE_BACKEND)')));
      continue;
    }

    try {
      const candidateCalls = [];
      const rawRewrite = candidate ?? await runWithApi(fixture, { ...options, settings, recordCall: (call) => candidateCalls.push(call) });
      const result = liveRequested
        ? await evaluateModelGradedRewrite(fixture, rawRewrite, { ...options, settings, judgeSettings, policy, candidateCalls })
        : evaluateRewriteQuality(fixture, rawRewrite, options);
      results.push(result);
    } catch (err) {
      results.push(failedResult(fixture, err));
    }
  }

  return buildReport({
    results,
    settings: {
      ...redactSettings(settings),
      ...(judgeSettings ? { judge: redactSettings(judgeSettings) } : {}),
    },
    policy,
  });
}

function shouldRunLive(options = {}) {
  if (options.dryRun) return false;
  if (options.live !== undefined) return Boolean(options.live);
  const env = options.env || process.env;
  return env.PATINA_LIVE === '1' ||
    Boolean(env.PATINA_LIVE_PROVIDER || env.PATINA_LIVE_API_KEY || env.PATINA_LIVE_MODEL || env.PATINA_LIVE_API_BASE);
}

export function resolveLiveSettings(options = {}) {
  const env = options.env || process.env;
  const providerName = options.provider ?? env.PATINA_LIVE_PROVIDER ?? env.PATINA_PROVIDER ?? null;
  const provider = selectProvider(providerName);
  const explicitApiKey = options.apiKey ?? env.PATINA_LIVE_API_KEY ?? null;
  const fallbackKey = explicitApiKey ? undefined : resolveOptionalApiKey(provider, env, options.apiKeyFile);
  const apiKey = explicitApiKey || fallbackKey?.apiKey || null;
  const apiKeySource = explicitApiKey
    ? (options.apiKey ? 'option:apiKey' : 'env:PATINA_LIVE_API_KEY')
    : fallbackKey?.source ?? null;
  const baseURL = options.baseURL ?? env.PATINA_LIVE_API_BASE ?? env.PATINA_API_BASE;
  const model = options.model ?? env.PATINA_LIVE_MODEL ?? env.PATINA_MODEL;
  const resolved = resolveProviderConfig({ provider, apiKey, baseURL, model });
  const timeoutMs = parsePositiveInt(options.timeoutMs ?? env.PATINA_LIVE_TIMEOUT_MS, 120000);

  return {
    provider: provider?.name ?? null,
    baseURL: resolved.baseURL,
    model: resolved.model,
    apiKey,
    hasApiKey: Boolean(apiKey),
    apiKeySource,
    baseURLSource: baseURL ? sourceLabel(options.baseURL, env.PATINA_LIVE_API_BASE, 'baseURL') : resolved.baseURLSource,
    modelSource: model ? sourceLabel(options.model, env.PATINA_LIVE_MODEL, 'model') : resolved.modelSource,
    timeoutMs,
  };
}

/**
 * Resolve the optional fixed-judge settings used for model-graded scoring
 * (scoreText/scoreMPS/scoreFidelity). Returns null when no judge override is
 * configured, in which case the candidate model judges its own rewrite
 * (historical behavior). Configure via --judge-* flags or PATINA_LIVE_JUDGE_*
 * env vars. The primary credential is reused only when the judge talks to the
 * same base URL; a different judge endpoint must bring its own API key so
 * credentials never cross hosts.
 */
export function resolveJudgeSettings(options = {}, primary = null) {
  const env = options.env || process.env;
  const providerName = options.judgeProvider ?? env.PATINA_LIVE_JUDGE_PROVIDER ?? null;
  const model = options.judgeModel ?? env.PATINA_LIVE_JUDGE_MODEL ?? null;
  const baseURL = options.judgeBaseURL ?? env.PATINA_LIVE_JUDGE_API_BASE ?? null;
  const explicitApiKey = options.judgeApiKey ?? env.PATINA_LIVE_JUDGE_API_KEY ?? null;
  const backend = options.judgeBackend ?? env.PATINA_LIVE_JUDGE_BACKEND ?? null;
  if (!providerName && !model && !baseURL && !explicitApiKey && !backend) return null;

  // A subscription CLI backend judge (codex-cli, claude-cli, ...) needs no
  // key or endpoint: the logged-in seat is the credential.
  if (backend) {
    return {
      provider: null,
      backend,
      baseURL: null,
      model,
      apiKey: null,
      hasApiKey: false,
      apiKeySource: null,
      timeoutMs: parsePositiveInt(options.judgeTimeoutMs ?? env.PATINA_LIVE_JUDGE_TIMEOUT_MS, (primary ?? resolveLiveSettings(options)).timeoutMs),
    };
  }

  const base = primary ?? resolveLiveSettings(options);
  const provider = selectProvider(providerName);
  const resolved = resolveProviderConfig({ provider, apiKey: explicitApiKey, baseURL, model });
  const judgeBaseURL = baseURL ?? (providerName ? resolved.baseURL : base.baseURL);
  const judgeModel = model ?? (providerName ? resolved.model : base.model);
  const apiKey = explicitApiKey ?? (judgeBaseURL === base.baseURL ? base.apiKey : null);
  const timeoutMs = parsePositiveInt(options.judgeTimeoutMs ?? env.PATINA_LIVE_JUDGE_TIMEOUT_MS, base.timeoutMs);

  return {
    provider: provider?.name ?? null,
    baseURL: judgeBaseURL,
    model: judgeModel,
    apiKey,
    hasApiKey: Boolean(apiKey),
    apiKeySource: explicitApiKey
      ? (options.judgeApiKey ? 'option:judgeApiKey' : 'env:PATINA_LIVE_JUDGE_API_KEY')
      : (apiKey ? 'primary' : null),
    timeoutMs,
  };
}

function resolveOptionalApiKey(provider, env, apiKeyFile) {
  try {
    const envVars = providerHttpKeyEnvVars(provider?.apiKeyEnv);
    const apiKey = resolveHttpApiKey({ apiKeyFile, env, envVars });
    if (!apiKey) return null;
    if (apiKeyFile) return { apiKey, source: 'option:apiKeyFile' };
    const source = envVars.find((key) => env[key]) || 'env:PATINA_API_KEY';
    return { apiKey, source: `env:${source}` };
  } catch (err) {
    if (apiKeyFile) throw err;
    return null;
  }
}

function sourceLabel(optionValue, liveEnvValue, name) {
  if (optionValue) return `option:${name}`;
  if (liveEnvValue) return `env:PATINA_LIVE_${name === 'baseURL' ? 'API_BASE' : 'MODEL'}`;
  return 'env:PATINA';
}

function redactSettings(settings) {
  const { apiKey: _apiKey, ...safe } = settings;
  return safe;
}

/**
 * Sum per-result usage aggregates across a run, keyed by role. Returns null
 * when no result carries usage (offline/skip paths keep their legacy shape).
 */
export function summarizeUsage(results) {
  const roles = ['candidate', 'judge'];
  const totals = {};
  let any = false;
  for (const result of results) {
    if (!result?.usage) continue;
    for (const role of roles) {
      const part = result.usage[role];
      if (!part) continue;
      any = true;
      const target = totals[role] ?? (totals[role] = {
        calls: 0,
        duration_ms: 0,
        attempts: 0,
        prompt_tokens: null,
        completion_tokens: null,
        reasoning_tokens: null,
        cached_read_tokens: null,
        cache_write_tokens: null,
      });
      target.calls += part.calls ?? 0;
      target.duration_ms += part.duration_ms ?? 0;
      target.attempts += part.attempts ?? 0;
      for (const key of ['prompt_tokens', 'completion_tokens', 'reasoning_tokens', 'cached_read_tokens', 'cache_write_tokens']) {
        if (part[key] === null || part[key] === undefined) continue;
        target[key] = (target[key] ?? 0) + part[key];
      }
    }
  }
  return any ? totals : null;
}

function buildReport({ results, settings, policy }) {
  const summary = {
    total: results.length,
    pass: results.filter((result) => result.status === 'pass').length,
    warn: results.filter((result) => result.status === 'warn').length,
    error: results.filter((result) => result.status === 'error' || result.status === 'fail').length,
    skipped: results.filter((result) => result.status === 'skipped').length,
  };
  const usage = summarizeUsage(results);
  if (usage) summary.usage = usage;
  return {
    schema_version: LIVE_QUALITY_SCHEMA_VERSION,
    settings,
    policy,
    summary,
    results,
  };
}

function judgeLabel(judge) {
  if (!judge) return 'self (candidate model scores itself)';
  if (judge.backend) return `${judge.backend}/${judge.model ?? 'default'}`;
  return judge.model;
}

export function renderMarkdownReport(reportOrResults) {
  const report = Array.isArray(reportOrResults)
    ? buildReport({ results: reportOrResults, settings: { legacy: true }, policy: DEFAULT_POLICY })
    : reportOrResults;
  const lines = [
    '# Patina live rewrite quality',
    '',
    `schema_version: ${report.schema_version}`,
    `provider: ${report.settings.provider ?? 'default'}`,
    `model: ${report.settings.model ?? 'default'}`,
    `judge: ${judgeLabel(report.settings.judge)}`,
    `api_key: ${report.settings.hasApiKey ? `present (${report.settings.apiKeySource || 'unknown source'})` : 'missing'}`,
    `policy: AI-after<=${report.policy.aiAfterCeiling}, MPS>=${report.policy.mpsFloor}, fidelity>=${report.policy.fidelityFloor}`,
    '',
    '| status | fixture | lang | mode | before | after | delta | mps | fidelity | notes |',
    '|---|---|---:|---|---:|---:|---:|---:|---:|---|',
  ];

  for (const result of report.results) {
    const notes = [
      ...(result.policy_violations || []),
      ...(result.errors || []),
      result.reason,
    ].filter(Boolean).join('; ');
    const cells = [
      result.status,
      result.fixture_id,
      result.language,
      result.mode || 'offline-candidate',
      formatNumber(result.before_score),
      formatNumber(result.after_score),
      formatNumber(result.ai_delta ?? result.humanization_gain),
      formatNumber(result.mps),
      formatNumber(result.fidelity ?? result.meaning_safety),
      notes || '-',
    ];
    lines.push(`| ${cells.join(' | ')} |`);
  }

  lines.push('', `Summary: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.error} error, ${report.summary.skipped} skipped.`);
  return `${lines.join('\n')}\n`;
}

export function parseArgs(argv = process.argv.slice(2)) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') options.json = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--live') options.live = true;
    else if (arg === '--fixtures') options.fixturePath = resolve(argv[++i]);
    else if (arg === '--candidate-dir') options.candidateDir = argv[++i];
    else if (arg === '--language') options.language = argv[++i];
    else if (arg === '--limit') options.limit = Number(argv[++i]);
    else if (arg === '--model') options.model = argv[++i];
    else if (arg === '--provider') options.provider = argv[++i];
    else if (arg === '--base-url') options.baseURL = argv[++i];
    else if (arg === '--api-key-file') options.apiKeyFile = argv[++i];
    else if (arg === '--timeout-ms') options.timeoutMs = Number(argv[++i]);
    else if (arg === '--judge-model') options.judgeModel = argv[++i];
    else if (arg === '--judge-provider') options.judgeProvider = argv[++i];
    else if (arg === '--judge-base-url') options.judgeBaseURL = argv[++i];
    else if (arg === '--judge-timeout-ms') options.judgeTimeoutMs = Number(argv[++i]);
    else if (arg === '--judge-backend') options.judgeBackend = argv[++i];
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    console.log(helpText());
    return;
  }

  const report = await runLiveQualityReport(options);
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else process.stdout.write(renderMarkdownReport(report));

  if (report.summary.error > 0) process.exitCode = 1;
}

async function runWithApi(fixture, options = {}) {
  const prompt = await buildPatinaRewritePrompt(fixture, options);
  const settings = options.settings || resolveLiveSettings(options);
  const callLLM = createLiveCallLLM(options.callLLM || defaultCallLLM, settings, options.recordCall);
  return callLLM({
    prompt,
    apiKey: settings.apiKey,
    baseURL: settings.baseURL,
    model: settings.model,
    temperature: 0.2,
  });
}

function selectFixtures(fixtures, { language, limit } = {}) {
  let selected = fixtures;
  if (language) selected = selected.filter((fixture) => fixture.language === language);
  if (Number.isFinite(limit) && limit >= 0) selected = selected.slice(0, limit);
  return selected;
}

function readCandidate(candidateDir, fixtureId) {
  const path = resolve(candidateDir, `${fixtureId}.md`);
  if (!existsSync(path)) throw new Error(`missing candidate rewrite: ${path}`);
  return readFileSync(path, 'utf8');
}

function skippedResult(fixture, reason) {
  const before = scoreProseText(fixture.text, {
    file: `${fixture.fixture_id}.md`,
    lang: fixture.language,
    repoRoot: REPO_ROOT,
  });
  return {
    fixture_id: fixture.fixture_id,
    language: fixture.language,
    register: fixture.register,
    mode: 'skipped',
    before_score: round1(before.score),
    after_score: null,
    humanization_gain: null,
    meaning_safety: null,
    safe_gain: null,
    status: 'skipped',
    reason,
  };
}

function failedResult(fixture, err) {
  return {
    fixture_id: fixture.fixture_id,
    language: fixture.language,
    register: fixture.register,
    mode: 'live-api',
    before_score: null,
    after_score: null,
    ai_delta: null,
    mps: null,
    fidelity: null,
    status: 'error',
    errors: [err.message],
  };
}

function preservedFacts(facts, rewrite, language = 'en') {
  const lowerRewrite = language === 'en' ? rewrite.toLowerCase() : rewrite;
  const preserved = facts.filter((fact) => {
    const needle = language === 'en' ? String(fact).toLowerCase() : String(fact);
    return lowerRewrite.includes(needle);
  });
  return { preserved, total: facts.length };
}

function lengthSafetyScore(original, rewrite) {
  if (!original || !rewrite) return 0;
  const ratio = rewrite.length / original.length;
  if (ratio >= 0.7 && ratio <= 1.3) return 100;
  if (ratio >= 0.5 && ratio <= 1.5) return 80;
  if (ratio >= 0.3 && ratio <= 2.0) return 60;
  return 30;
}

function parsePositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? round1(n) : null;
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

function formatNumber(n) {
  return Number.isFinite(n) ? Number(n).toFixed(1) : '-';
}

function helpText() {
  return `Usage: npm run quality:live -- [options]

Runs the deliberate live rewrite quality probe. By default this does not call a model; pass --live or set PATINA_LIVE=1 to use an OpenAI-compatible provider.

Options:
  --live                  Run credentialed API rewrites and model-graded checks
  --provider <name>       Provider preset (openai, gemini, groq, kimi, moonshot, together)
  --model <id>            Model id (or PATINA_LIVE_MODEL)
  --base-url <url>        OpenAI-compatible base URL (or PATINA_LIVE_API_BASE)
  --api-key-file <path>   Read API key from a file
  --timeout-ms <ms>       Per fixture live timeout budget (default: 120000)
  --judge-model <id>      Fixed judge model for scoring calls (or PATINA_LIVE_JUDGE_MODEL);
                          default: the candidate model scores its own rewrite
  --judge-provider <name> Provider preset for the judge (or PATINA_LIVE_JUDGE_PROVIDER)
  --judge-base-url <url>  Judge base URL (or PATINA_LIVE_JUDGE_API_BASE); a judge on a
                          different host needs its own PATINA_LIVE_JUDGE_API_KEY
  --judge-timeout-ms <ms> Judge scoring timeout budget (or PATINA_LIVE_JUDGE_TIMEOUT_MS)
  --judge-backend <name>  Run the judge on a local subscription CLI backend
                          (codex-cli, claude-cli, gemini-cli, kimi-cli — or
                          PATINA_LIVE_JUDGE_BACKEND); no API key needed
  --fixtures <path>       Fixture directory or legacy JSONL file
  --candidate-dir <dir>   Score precomputed rewrites named <fixture_id>.md
  --language <lang>       Filter fixtures by language
  --limit <n>             Limit selected fixtures
  --json                  Emit structured JSON report
  --dry-run               Force skip mode even if PATINA_LIVE_* is set
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
