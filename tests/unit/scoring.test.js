import test from 'node:test';
import assert from 'node:assert';
import {
  clamp03,
  combinedScore,
  interpretScore,
  lengthRatioPoints,
  scoreFidelity,
  scoreMPS,
  scoreDeterministicSignals,
  scoreText,
} from '../../src/scoring.js';
import { loadConfig } from '../../src/config.js';

test('interpretScore maps documented AI-likeness boundaries', () => {
  const cases = [
    [0, 'human'],
    [15, 'human'],
    [16, 'mostly human'],
    [30, 'mostly human'],
    [31, 'mixed'],
    [50, 'mixed'],
    [51, 'AI-like'],
    [70, 'AI-like'],
    [71, 'heavily AI'],
    [100, 'heavily AI'],
  ];

  for (const [score, expected] of cases) {
    assert.strictEqual(interpretScore(score), expected, String(score));
  }
});

test('lengthRatioPoints scores bucket boundaries and empty original text', () => {
  const original = 'a'.repeat(100);
  const cases = [
    [29, 0],
    [30, 1],
    [49, 1],
    [50, 2],
    [69, 2],
    [70, 3],
    [130, 3],
    [131, 2],
    [150, 2],
    [151, 1],
    [200, 1],
    [201, 0],
  ];

  for (const [length, expected] of cases) {
    assert.strictEqual(
      lengthRatioPoints(original, 'b'.repeat(length)),
      expected,
      `${length}%`
    );
  }

  assert.strictEqual(lengthRatioPoints('', 'rewritten'), 3);
});

test('clamp03 clamps out-of-range values and rounds fractions', () => {
  const cases = [
    [-1, 0],
    [0, 0],
    [1.4, 1],
    [1.5, 2],
    [2.6, 3],
    [3, 3],
    [4, 3],
    [Number.NaN, 0],
  ];

  for (const [value, expected] of cases) {
    assert.strictEqual(clamp03(value), expected, String(value));
  }
});

test('combinedScore uses default and profile-specific config weights', () => {
  const config = loadConfig();

  assert.strictEqual(
    combinedScore({ aiLikeness: 40, fidelity: 80, profile: 'missing', config }),
    32
  );

  assert.strictEqual(
    combinedScore({ aiLikeness: 40, fidelity: 80, profile: 'legal', config }),
    27
  );

  assert.strictEqual(
    combinedScore({ aiLikeness: 40, fidelity: 80, profile: 'marketing', config }),
    33
  );

  assert.strictEqual(
    combinedScore({
      aiLikeness: 40,
      fidelity: 80,
      deterministicScore: { overall: 90 },
      profile: 'legal',
      config: {
        ...config,
        scoring: { deterministic: { 'combined-weight': 0.25 } },
      },
    }),
    39.6
  );
});

test('score helpers accept an injected callLLM implementation', async () => {
  const seen = [];
  const now = () => 123;
  const sleep = async () => {};
  const callLLM = async (args) => {
    seen.push(args);
    assert.strictEqual(args.now, now);
    assert.strictEqual(args.sleep, sleep);

    if (args.prompt.includes('AI-likeness scoring engine')) {
      return '{ "overall": 22, "interpretation": "mostly human" }';
    }
    if (args.prompt.includes('Meaning Preservation evaluator')) {
      return '{ "anchors": [], "pass_count": 1, "total_count": 1, "polarity_pass_count": 0, "polarity_total_count": 0, "mps": 91 }';
    }
    return '{ "claims_preserved": 3, "no_fabrication": 3, "tone_match": 3, "rationale": "ok" }';
  };

  const config = loadConfig();
  const common = {
    apiKey: 'test-key',
    baseURL: 'https://example.com/v1',
    model: 'test-model',
    callLLM,
    now,
    sleep,
  };

  const score = await scoreText({
    text: 'Example text.',
    config,
    patterns: [],
    ...common,
  });
  const mps = await scoreMPS({
    original: 'Example text.',
    rewritten: 'Example text.',
    ...common,
  });
  const fidelity = await scoreFidelity({
    original: 'Example text.',
    rewritten: 'Example text.',
    ...common,
  });

  assert.strictEqual(score.overall, 22);
  assert.strictEqual(score.llmScore.overall, 22);
  assert.equal(typeof score.deterministicScore.overall, 'number');
  assert.strictEqual(mps.mps, 91);
  assert.strictEqual(fidelity.fidelity, 100);
  assert.strictEqual(seen.length, 3);
});

test('scoreText warns on deterministic divergence and keeps the pessimistic score', async () => {
  const warnings = [];
  const score = await scoreText({
    text: [
      'The tool is useful. The model is helpful. The system is reliable. The page is stable. The flow is simple.',
      'The draft is useful. The note is helpful. The copy is reliable. The line is stable. The page is simple.',
      'The output is useful. The result is helpful. The answer is reliable. The plan is stable. The text is simple.',
    ].join('\n\n'),
    config: loadConfig(),
    patterns: [],
    callLLM: async () => '{ "overall": 10, "interpretation": "human" }',
    logger: { warn: (event, fields) => warnings.push({ event, ...fields }) },
  });

  assert.strictEqual(score.llmScore.overall, 10);
  assert.strictEqual(score.deterministicScore.overall, 100);
  assert.ok(score.deterministicScore.signalScore > 0);
  assert.strictEqual(score.overall, 100);
  assert.strictEqual(score.scorePreference.selected, 'deterministic');
  assert.ok(warnings.some((entry) => entry.event === 'score.deterministic_divergence'));
});

test('deterministic signal score is additive and does not replace hot-ratio overall', () => {
  const deterministic = scoreDeterministicSignals({
    text: [
      'The tool is useful. The model is helpful. The system is reliable.',
      'The draft is useful. The note is helpful. The copy is reliable.',
    ].join('\n\n'),
    config: loadConfig(),
  });

  assert.strictEqual(deterministic.overall, 100);
  assert.equal(typeof deterministic.signalScore, 'number');
  assert.ok(deterministic.signalScore > 0);
});

test('deterministic markup-leakage short-circuits the score into the heavily-AI band', () => {
  const leakedText = [
    'I rewrote the parser this morning and it finally handles nested quotes without choking on them. The previous version tripped over one rare edge case that took the better part of two days to track down and reproduce.',
    'Reviewers wanted another pass on the error copy, so I split the longest messages into a short summary plus a separate hint. According to turn0search1 the phrasing still needs work, yet the overall structure holds together fine.',
    'We shipped it behind a flag and watched the logs over lunch. Nothing broke. The on-call engineer shrugged and went back to her coffee.',
  ].join('\n\n');
  const leaked = scoreDeterministicSignals({ text: leakedText, config: loadConfig() });
  // Every paragraph is ordinary human prose, so the hot ratio alone would be 0;
  // the near-proof-grade leakage token is what lifts the score.
  assert.strictEqual(leaked.hotParagraphs, 0);
  assert.strictEqual(leaked.bands.markupLeakage.leaked, true);
  assert.ok(leaked.overall >= 90, `expected leakage floor, got ${leaked.overall}`);
  assert.strictEqual(leaked.interpretation, 'heavily AI');

  const cleanText = leakedText.replace('According to turn0search1 the phrasing', 'According to the reviewer the phrasing');
  const clean = scoreDeterministicSignals({ text: cleanText, config: loadConfig() });
  assert.strictEqual(clean.bands.markupLeakage.leaked, false);
  assert.ok(clean.overall < 90, `clean prose should not hit the leakage floor, got ${clean.overall}`);
});

test('deterministic skipped and failure payloads pin signalScore to zero', () => {
  const disabled = scoreDeterministicSignals({
    text: 'Example.',
    config: {
      ...loadConfig(),
      language: 'ko',
      stylometry: { languages: ['en'] },
    },
  });
  assert.strictEqual(disabled.skipped, true);
  assert.strictEqual(disabled.signalScore, 0);

  const failed = scoreDeterministicSignals({
    text: 'Example.',
    config: loadConfig(),
    analyzer: () => {
      throw new Error('boom');
    },
  });
  assert.strictEqual(failed.skipped, true);
  assert.strictEqual(failed.signalScore, 0);
});
