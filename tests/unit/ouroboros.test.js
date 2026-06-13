import test from 'node:test';
import assert from 'node:assert';

import { runOuroboros } from '../../src/ouroboros.js';

const BASE_TEXT = 'Original claim text.';

function baseConfig(overrides = {}) {
  return {
    language: 'en',
    profile: 'default',
    ouroboros: {
      'target-score': 30,
      'max-iterations': 3,
      'plateau-threshold': 10,
      'fidelity-floor': 70,
      'mps-floor': 70,
      'combined-weights': {
        default: {
          'ai-likeness': 0.6,
          fidelity: 0.4,
        },
      },
      ...overrides,
    },
  };
}

function createLLMFixture({
  scores,
  rewrites = [],
  mps = [],
  fidelityGrades = [],
}) {
  const calls = {
    score: [],
    rewrite: [],
    mps: [],
    fidelity: [],
  };

  const next = (items, label) => {
    assert.ok(items.length > 0, `missing fake ${label} response`);
    return items.shift();
  };

  const callLLM = async ({ prompt }) => {
    if (prompt.includes('AI-likeness scoring engine')) {
      calls.score.push(prompt);
      return JSON.stringify({
        categories: {},
        overall: next(scores, 'score'),
        interpretation: 'test',
      });
    }

    if (prompt.includes('Meaning Preservation evaluator')) {
      calls.mps.push(prompt);
      return JSON.stringify({
        anchors: [],
        pass_count: 1,
        total_count: 1,
        polarity_pass_count: 0,
        polarity_total_count: 0,
        mps: next(mps, 'MPS'),
      });
    }

    if (prompt.includes('Fidelity evaluator')) {
      calls.fidelity.push(prompt);
      const grade = next(fidelityGrades, 'fidelity');
      return JSON.stringify({
        claims_preserved: grade,
        no_fabrication: grade,
        tone_match: grade,
        rationale: 'test fixture',
      });
    }

    calls.rewrite.push(prompt);
    return next(rewrites, 'rewrite');
  };

  return { calls, callLLM };
}

function runWithFixture(fixture, config = baseConfig()) {
  return runOuroboros({
    config,
    patterns: [],
    profile: null,
    voice: null,
    scoring: null,
    text: BASE_TEXT,
    apiKey: 'test-key',
    baseURL: 'https://example.com/v1',
    model: 'test-model',
    callLLM: fixture.callLLM,
  });
}

test('runOuroboros exits early when the initial score already meets target', async () => {
  const fixture = createLLMFixture({ scores: [20] });

  const result = await runWithFixture(fixture);

  assert.equal(result.finalText, BASE_TEXT);
  assert.equal(result.finalScore, 20);
  assert.equal(result.iterations, 0);
  assert.match(result.reason, /Already at target/);
  assert.equal(fixture.calls.score.length, 1);
  assert.equal(fixture.calls.rewrite.length, 0);
});

test('runOuroboros stops on plateau and keeps the latest non-rollback text', async () => {
  const fixture = createLLMFixture({
    scores: [80, 75],
    rewrites: ['Rewritten claim text.'],
    mps: [100],
    fidelityGrades: [3],
  });

  const result = await runWithFixture(fixture);

  assert.equal(result.finalText, 'Rewritten claim text.');
  assert.equal(result.finalScore, 75);
  assert.equal(result.iterations, 1);
  assert.equal(result.reason, 'Plateau');
});

test('runOuroboros rolls back on combined-score regression', async () => {
  const fixture = createLLMFixture({
    scores: [40, 50],
    rewrites: ['Regression claim text.'],
    mps: [100],
    fidelityGrades: [3],
  });

  const result = await runWithFixture(fixture);

  assert.equal(result.finalText, BASE_TEXT);
  assert.equal(result.finalScore, 40);
  assert.equal(result.iterations, 1);
  assert.match(result.reason, /^Regression/);
});

test('runOuroboros rolls back on fidelity-floor violation', async () => {
  const fixture = createLLMFixture({
    scores: [80, 20],
    rewrites: ['Fidelity bad text.'],
    mps: [100],
    fidelityGrades: [1],
  });

  const result = await runWithFixture(fixture, baseConfig({ 'target-score': 5 }));

  assert.equal(result.finalText, BASE_TEXT);
  assert.equal(result.finalScore, 80);
  assert.equal(result.iterations, 1);
  assert.equal(result.reason, 'Fidelity floor violation');
});

test('runOuroboros rolls back on MPS-floor violation', async () => {
  const fixture = createLLMFixture({
    scores: [80, 20],
    rewrites: ['MPS bad claim text.'],
    mps: [50],
    fidelityGrades: [3],
  });

  const result = await runWithFixture(fixture, baseConfig({ 'target-score': 5 }));

  assert.equal(result.finalText, BASE_TEXT);
  assert.equal(result.finalScore, 80);
  assert.equal(result.iterations, 1);
  assert.equal(result.reason, 'MPS floor violation');
});

test('runOuroboros logs per-iteration score progress and latency', async () => {
  const fixture = createLLMFixture({
    scores: [80, 70],
    rewrites: ['Lower score claim text.'],
    mps: [100],
    fidelityGrades: [3],
  });
  const records = [];
  const logger = {
    info(event, fields) {
      records.push({ event, ...fields });
    },
    warn() {},
    progress() {},
    closeProgress() {},
  };
  let currentTime = 1_000;

  const result = await runOuroboros({
    config: baseConfig({ 'target-score': 75 }),
    patterns: [],
    profile: null,
    voice: null,
    scoring: null,
    text: BASE_TEXT,
    apiKey: 'test-key',
    baseURL: 'https://example.com/v1',
    model: 'test-model',
    now: () => currentTime,
    logger,
    callLLM: async (args) => {
      currentTime += 250;
      return fixture.callLLM(args);
    },
  });

  assert.equal(result.reason, 'Target met');
  assert.equal(records.length, 1);
  assert.equal(records[0].event, 'ouroboros.iteration');
  assert.equal(records[0].model, 'test-model');
  assert.equal(records[0].latency_ms, 500);
  assert.match(records[0].message, /\[ouroboros\] iter 1\/3 score 80 → 70 \(0\.5s\)/);
});

test('runOuroboros rolls back when target is met but fidelity floor is violated', async () => {
  // Score 20 meets the default target (30), but fidelity grade 1 is below the
  // 70 floor. Floors must win: the gutted rewrite is rejected, not returned.
  const fixture = createLLMFixture({
    scores: [80, 20],
    rewrites: ['Gutted but target-meeting text.'],
    mps: [100],
    fidelityGrades: [1],
  });

  const result = await runWithFixture(fixture);

  assert.equal(result.finalText, BASE_TEXT);
  assert.equal(result.finalScore, 80);
  assert.equal(result.iterations, 1);
  assert.equal(result.reason, 'Fidelity floor violation');
});

test('runOuroboros rolls back when target is met but MPS floor is violated', async () => {
  const fixture = createLLMFixture({
    scores: [80, 20],
    rewrites: ['Meaning-stripped target-meeting text.'],
    mps: [50],
    fidelityGrades: [3],
  });

  const result = await runWithFixture(fixture);

  assert.equal(result.finalText, BASE_TEXT);
  assert.equal(result.finalScore, 80);
  assert.equal(result.iterations, 1);
  assert.equal(result.reason, 'MPS floor violation');
});

test('runOuroboros rolls back when target is met but the MPS scorer fails', async () => {
  // scoreMPS returns { mps: null } on schema failure; that must fail closed
  // even when the AI-likeness target is met.
  const fixture = createLLMFixture({
    scores: [80, 20],
    rewrites: ['Target-meeting text with unverifiable meaning.'],
    mps: [null],
    fidelityGrades: [3],
  });

  const result = await runWithFixture(fixture);

  assert.equal(result.finalText, BASE_TEXT);
  assert.equal(result.finalScore, 80);
  assert.equal(result.iterations, 1);
  assert.equal(result.reason, 'MPS scorer failure');
});

test('runOuroboros accepts a target-met iteration when both floors pass', async () => {
  const fixture = createLLMFixture({
    scores: [80, 20],
    rewrites: ['Faithful target-meeting text.'],
    mps: [95],
    fidelityGrades: [3],
  });

  const result = await runWithFixture(fixture);

  assert.equal(result.finalText, 'Faithful target-meeting text.');
  assert.equal(result.finalScore, 20);
  assert.equal(result.iterations, 1);
  assert.equal(result.reason, 'Target met');
});

test('ouroboros iteration prompts skip the self-audit phase (#444)', async () => {
  const fixture = createLLMFixture({
    scores: [80, 75],
    rewrites: ['Rewritten claim text.'],
    mps: [100],
    fidelityGrades: [3],
  });
  await runWithFixture(fixture);
  assert.equal(fixture.calls.rewrite.length, 1);
  const rewritePrompt = fixture.calls.rewrite[0];
  assert.doesNotMatch(rewritePrompt, /Phase 3: Self-Audit/);
  assert.doesNotMatch(rewritePrompt, /\[SELF_AUDIT\]/);
  assert.match(rewritePrompt, /Output ONLY the final humanized text/);
});
