import test from 'node:test';
import assert from 'node:assert';
import {
  clamp03,
  combinedScore,
  interpretScore,
  lengthRatioPoints,
  scoreFidelity,
  scoreMPS,
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
  assert.strictEqual(mps.mps, 91);
  assert.strictEqual(fidelity.fidelity, 100);
  assert.strictEqual(seen.length, 3);
});
