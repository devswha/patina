import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  renderMarkdown,
  validateResultsSchema,
} from '../../scripts/benchmark-report.mjs';

function metrics(overrides = {}) {
  return {
    total: 1,
    n: 1,
    accuracy: 1,
    precision: 1,
    recall: 1,
    f1: 1,
    tp: 1,
    fp: 0,
    fn: 0,
    tn: 0,
    ci_low: 1,
    ci_high: 1,
    confidence_method: 'unit',
    ...overrides,
  };
}

function benchmarkResults(overrides = {}) {
  const detectorMetrics = metrics();
  return {
    schemaVersion: 3,
    fixtureSchemaVersion: 1,
    nodeVersion: 'v22.0.0',
    generatedAt: '2026-05-21T00:00:00.000Z',
    fixtureCount: 1,
    overallAccuracy: 1,
    overall: metrics(),
    perLanguage: {
      en: {
        ...metrics(),
        byDetector: {
          burstiness: detectorMetrics,
          koDiagnostics: detectorMetrics,
          mattr: detectorMetrics,
          lexicon: detectorMetrics,
        },
      },
    },
    ranking: {
      overall: {
        n: 1,
        positives: 1,
        negatives: 0,
        roc_auc: null,
        pr_auc: 1,
        bestF1: {
          threshold: 10,
          precision: 1,
          recall: 1,
          f1: 1,
          accuracy: 1,
        },
        low_fpr: [
          { target_fpr: 0.01, negatives: 0, max_false_positives: 0, actual_fpr: null, tpr: null, supported: false, reason: 'no_negatives' },
          { target_fpr: 0.05, negatives: 0, max_false_positives: 0, actual_fpr: null, tpr: null, supported: false, reason: 'no_negatives' },
        ],
      },
      perLanguage: {},
    },
    fixtures: [
      {
        fixture_id: 'unit-ai-01',
        lang: 'en',
        class: 'ai',
        expected_hot: true,
        predicted_hot: true,
        correct: true,
        signal_score: 10,
        cv: 0.1,
        cv_band: 'low',
        mattr: 0.8,
        mattr_band: 'high',
        lexicon_density: 0,
        lexicon_hits: [],
      },
    ],
    ...overrides,
  };
}

test('benchmark report renders undefined ranking metrics as unavailable, not zero', () => {
  const results = benchmarkResults();

  assert.doesNotThrow(() => validateResultsSchema(results));

  const markdown = renderMarkdown(results, 0);
  assert.match(markdown, /\| overall \| 1 \| 1 \| 0 \| — \| 1 \| 10 \|/);
  assert.doesNotMatch(markdown, /\| overall \| 1 \| 1 \| 0 \| 0 \| 1 \| 10 \|/);
});

test('benchmark report schema rejects nonnumeric ranking metrics', () => {
  const results = benchmarkResults({
    ranking: {
      overall: {
        ...benchmarkResults().ranking.overall,
        roc_auc: 'n/a',
      },
      perLanguage: {},
    },
  });

  assert.throws(() => validateResultsSchema(results), /ranking\.overall\.roc_auc/);
});
