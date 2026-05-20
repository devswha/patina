import test from 'node:test';
import assert from 'node:assert';
import {
  clamp03,
  combinedScore,
  interpretScore,
  lengthRatioPoints,
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
