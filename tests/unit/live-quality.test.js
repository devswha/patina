import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  classifyQuality,
  computeMeaningSafety,
  deliveredRewrite,
  evaluateModelGradedRewrite,
  evaluateRewriteQuality,
  loadLiveFixtures,
  renderMarkdownReport,
  aggregateCalls,
  normalizeUsage,
  resolveJudgeSettings,
  summarizeUsage,
  resolveLiveSettings,
  runLiveQuality,
  runLiveQualityReport,
} from '../quality/live-quality.mjs';

const fixture = {
  fixture_id: 'en-unit-live-01',
  language: 'en',
  register: 'unit',
  source_type: 'synthetic-ai',
  model_family: 'fixture',
  prompt_id: 'unit',
  redistribution: 'repo-ok',
  anchors: ['coffee', 'Paris', 'Tokyo'],
  facts: ['coffee', 'Paris', 'Tokyo'],
  text: [
    'Coffee is a pivotal cultural phenomenon. Coffee is a pivotal cultural phenomenon. Coffee is a pivotal cultural phenomenon.',
    'Paris and Tokyo both have coffee scenes that are important to local routines.',
  ].join('\n\n'),
};

const rewrite = `[BODY]
Coffee still matters in Paris and Tokyo, but not in some grand, world-historical way.
People meet over it, argue over it, and build small routines around it.
[/BODY]
[SELF_AUDIT]
Removed inflated claims.
[/SELF_AUDIT]`;

test('live fixtures load YAML frontmatter metadata for the deliberate runner', () => {
  const fixtures = loadLiveFixtures();
  assert.ok(fixtures.length >= 2);
  assert.ok(fixtures.some((item) => item.language === 'en'));
  assert.ok(fixtures.some((item) => item.language === 'ko'));
  for (const item of fixtures) {
    assert.equal(item.redistribution, 'repo-ok');
    assert.ok(Array.isArray(item.anchors));
    assert.ok(item.anchors.length > 0);
    assert.ok(item.text.length > 0);
  }
});

test('evaluateRewriteQuality exposes before/after safe-gain fields', () => {
  const result = evaluateRewriteQuality(fixture, rewrite);

  assert.equal(result.fixture_id, fixture.fixture_id);
  assert.equal(typeof result.before_score, 'number');
  assert.equal(typeof result.after_score, 'number');
  assert.equal(typeof result.humanization_gain, 'number');
  assert.equal(typeof result.meaning_safety, 'number');
  assert.equal(typeof result.safe_gain, 'number');
  assert.ok(['pass', 'warn', 'fail'].includes(result.status));
  assert.equal(result.preserved_facts.length, 3);
});

test('deliveredRewrite strips self-audit blocks before scoring', () => {
  const delivered = deliveredRewrite(rewrite);
  assert.match(delivered, /Coffee still matters/);
  assert.doesNotMatch(delivered, /SELF_AUDIT/);
  assert.doesNotMatch(delivered, /Removed inflated claims/);
});

test('meaning safety uses fact preservation and length sanity as a deterministic proxy', () => {
  assert.equal(computeMeaningSafety(fixture, fixture.text), 100);
  assert.ok(computeMeaningSafety(fixture, 'coffee only') < 70);
});

test('classification separates pass, warn, and fail', () => {
  assert.equal(classifyQuality({ afterScore: 20, meaningSafety: 90, safeGain: 10 }), 'pass');
  assert.equal(classifyQuality({ afterScore: 40, meaningSafety: 90, safeGain: 10 }), 'warn');
  assert.equal(classifyQuality({ afterScore: 20, meaningSafety: 50, safeGain: 10 }), 'fail');
});

test('default run skips live calls without failing', async () => {
  const results = await runLiveQuality({ fixtures: [fixture], dryRun: true });
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'skipped');
  assert.equal(typeof results[0].before_score, 'number');

  const report = renderMarkdownReport(results);
  assert.match(report, /Patina live rewrite quality/);
  assert.match(report, /skipped/);
});

test('live settings redact keys and prefer PATINA_LIVE env', () => {
  const settings = resolveLiveSettings({
    env: {
      PATINA_LIVE_PROVIDER: 'gemini',
      PATINA_LIVE_API_KEY: 'secret-live-key',
      PATINA_LIVE_MODEL: 'gemini-test-model',
      PATINA_LIVE_API_BASE: 'https://example.test/v1',
      PATINA_LIVE_TIMEOUT_MS: '12345',
    },
  });

  assert.equal(settings.provider, 'gemini');
  assert.equal(settings.hasApiKey, true);
  assert.equal(settings.apiKey, 'secret-live-key');
  assert.equal(settings.apiKeySource, 'env:PATINA_LIVE_API_KEY');
  assert.equal(settings.model, 'gemini-test-model');
  assert.equal(settings.baseURL, 'https://example.test/v1');
  assert.equal(settings.timeoutMs, 12345);
});

test('model-graded evaluation uses scoring floors and reports pass', async () => {
  const result = await evaluateModelGradedRewrite(fixture, rewrite, {
    settings: {
      apiKey: 'test-key',
      baseURL: 'https://example.test/v1',
      model: 'test-model',
      timeoutMs: 1000,
    },
    callLLM: fakeQualityModel,
  });

  assert.equal(result.status, 'pass');
  assert.equal(result.mode, 'live-api');
  assert.equal(result.after_score, 20);
  assert.equal(result.mps, 95);
  assert.equal(result.fidelity, 91.7);
  assert.deepEqual(result.policy_violations, []);
});

test('live report is structured and fail-closed when credentials are missing', async () => {
  const report = await runLiveQualityReport({ fixtures: [fixture], live: true, env: {} });

  assert.equal(report.schema_version, 1);
  assert.equal(report.settings.hasApiKey, false);
  assert.equal(report.summary.error, 1);
  assert.equal(report.results[0].status, 'error');
  assert.match(report.results[0].errors[0], /no API key/);

  const markdown = renderMarkdownReport(report);
  assert.match(markdown, /schema_version: 1/);
  assert.match(markdown, /api_key: missing/);
});

test('judge settings resolve to null when no judge override is configured', () => {
  assert.equal(resolveJudgeSettings({ env: {} }), null);
  assert.equal(resolveJudgeSettings({ env: { PATINA_LIVE_MODEL: 'candidate' } }), null);
});

test('judge model alone inherits the primary endpoint and credential', () => {
  const primary = {
    baseURL: 'https://example.test/v1',
    model: 'candidate-model',
    apiKey: 'primary-key',
    timeoutMs: 120000,
  };
  const judge = resolveJudgeSettings({ env: { PATINA_LIVE_JUDGE_MODEL: 'judge-model' } }, primary);

  assert.equal(judge.model, 'judge-model');
  assert.equal(judge.baseURL, 'https://example.test/v1');
  assert.equal(judge.apiKey, 'primary-key');
  assert.equal(judge.hasApiKey, true);
  assert.equal(judge.apiKeySource, 'primary');
  assert.equal(judge.timeoutMs, 120000);
});

test('judge on a different host never reuses the primary credential', () => {
  const primary = {
    baseURL: 'https://example.test/v1',
    model: 'candidate-model',
    apiKey: 'primary-key',
    timeoutMs: 120000,
  };
  const judge = resolveJudgeSettings({
    env: {
      PATINA_LIVE_JUDGE_MODEL: 'judge-model',
      PATINA_LIVE_JUDGE_API_BASE: 'https://other.test/v1',
    },
  }, primary);

  assert.equal(judge.baseURL, 'https://other.test/v1');
  assert.equal(judge.apiKey, null);
  assert.equal(judge.hasApiKey, false);
});

test('live report fails closed when the judge lacks a credential', async () => {
  const report = await runLiveQualityReport({
    fixtures: [fixture],
    live: true,
    env: {
      PATINA_LIVE_API_KEY: 'primary-key',
      PATINA_LIVE_API_BASE: 'https://example.test/v1',
      PATINA_LIVE_MODEL: 'candidate-model',
      PATINA_LIVE_JUDGE_MODEL: 'judge-model',
      PATINA_LIVE_JUDGE_API_BASE: 'https://other.test/v1',
    },
  });

  assert.equal(report.summary.error, 1);
  assert.match(report.results[0].errors[0], /judge API key/);
  assert.equal(report.settings.judge.model, 'judge-model');
  assert.equal(report.settings.judge.apiKey, undefined);
});

test('model-graded scoring calls route to the fixed judge, not the candidate', async () => {
  const seenModels = [];
  const recordingModel = (args) => {
    seenModels.push(args.model);
    return fakeQualityModel(args);
  };
  const result = await evaluateModelGradedRewrite(fixture, rewrite, {
    settings: {
      apiKey: 'candidate-key',
      baseURL: 'https://example.test/v1',
      model: 'candidate-model',
      timeoutMs: 1000,
    },
    judgeSettings: {
      apiKey: 'judge-key',
      baseURL: 'https://judge.test/v1',
      model: 'judge-model',
      timeoutMs: 2000,
    },
    callLLM: recordingModel,
  });

  assert.equal(result.status, 'pass');
  assert.ok(seenModels.length >= 4);
  assert.ok(seenModels.every((model) => model === 'judge-model'));
});

test('normalizeUsage maps OpenAI-compat and native Anthropic shapes', () => {
  assert.deepEqual(normalizeUsage({
    prompt_tokens: 100,
    completion_tokens: 60,
    completion_tokens_details: { reasoning_tokens: 40 },
    prompt_tokens_details: { cached_tokens: 80 },
  }), {
    prompt_tokens: 100,
    completion_tokens: 60,
    reasoning_tokens: 40,
    cached_read_tokens: 80,
    cache_write_tokens: null,
  });
  assert.deepEqual(normalizeUsage({
    input_tokens: 50,
    output_tokens: 30,
    cache_read_input_tokens: 20,
    cache_creation_input_tokens: 10,
  }), {
    prompt_tokens: 50,
    completion_tokens: 30,
    reasoning_tokens: null,
    cached_read_tokens: 20,
    cache_write_tokens: 10,
  });
  assert.equal(normalizeUsage(null), null);
});

test('aggregateCalls sums per-attempt usages so failed paid retries stay billed', () => {
  const totals = aggregateCalls([
    {
      ms: 1000,
      attempts: 2,
      usages: [
        { prompt_tokens: 100, completion_tokens: 10 },
        { prompt_tokens: 100, completion_tokens: 50, completion_tokens_details: { reasoning_tokens: 30 } },
      ],
    },
    { ms: 500, attempts: 1, usages: [] },
  ]);

  assert.equal(totals.calls, 2);
  assert.equal(totals.duration_ms, 1500);
  assert.equal(totals.attempts, 3);
  assert.equal(totals.prompt_tokens, 200);
  assert.equal(totals.completion_tokens, 60);
  assert.equal(totals.reasoning_tokens, 30);
  assert.equal(totals.cached_read_tokens, null);
});

test('model-graded results carry judge usage aggregates from live calls', async () => {
  const withUsage = async (args) => {
    if (typeof args.onAttempt === 'function') {
      args.onAttempt({ attemptIndex: 1, usage: { prompt_tokens: 10, completion_tokens: 5 } });
    }
    return fakeQualityModel(args);
  };
  const result = await evaluateModelGradedRewrite(fixture, rewrite, {
    settings: {
      apiKey: 'test-key',
      baseURL: 'https://example.test/v1',
      model: 'test-model',
      timeoutMs: 1000,
    },
    candidateCalls: [{ ms: 2000, attempts: 1, usages: [{ prompt_tokens: 900, completion_tokens: 300 }] }],
    callLLM: withUsage,
  });

  assert.equal(result.usage.judge.calls, 4);
  assert.equal(result.usage.judge.attempts, 4);
  assert.equal(result.usage.judge.prompt_tokens, 40);
  assert.equal(result.usage.judge.completion_tokens, 20);
  assert.equal(result.usage.candidate.calls, 1);
  assert.equal(result.usage.candidate.prompt_tokens, 900);

  const summary = summarizeUsage([result]);
  assert.equal(summary.judge.prompt_tokens, 40);
  assert.equal(summary.candidate.completion_tokens, 300);
  assert.equal(summarizeUsage([{ fixture_id: 'x' }]), null);
});

async function fakeQualityModel({ prompt }) {
  if (prompt.includes('AI-likeness scoring engine')) {
    const isRewrite = prompt.includes('Coffee still matters');
    return JSON.stringify({
      categories: {},
      overall: isRewrite ? 20 : 70,
      interpretation: isRewrite ? 'mostly human' : 'AI-like',
    });
  }
  if (prompt.includes('Meaning Preservation evaluator')) {
    return JSON.stringify({
      anchors: [
        { type: 'claim', content: 'coffee', verdict: 'PASS' },
        { type: 'claim', content: 'Paris', verdict: 'PASS' },
        { type: 'claim', content: 'Tokyo', verdict: 'PASS' },
      ],
      pass_count: 3,
      total_count: 3,
      polarity_pass_count: 1,
      polarity_total_count: 1,
      mps: 95,
    });
  }
  if (prompt.includes('Fidelity evaluator')) {
    return JSON.stringify({
      claims_preserved: 3,
      no_fabrication: 3,
      tone_match: 2,
      rationale: 'Claims and tone are mostly preserved.',
    });
  }
  return rewrite;
}
