import test from 'node:test';
import assert from 'node:assert';

import {
  DEFAULT_INPUT,
  anchorMps,
  evaluateFixtures,
  formatMarkdown,
  loadFixtures,
  summarize,
} from '../../scripts/adversarial-mps-report.mjs';

test('adversarial MPS fixtures pass the repo-owned gate', () => {
  const rows = evaluateFixtures(loadFixtures(DEFAULT_INPUT));
  const summary = summarize(rows);

  assert.strictEqual(summary.total, 10);
  assert.strictEqual(summary.passing, 10);
  assert.strictEqual(summary.failing, 0);
  assert.ok(summary.min_mps >= 90);
  assert.ok(summary.min_ai >= 60);
});

test('anchorMps fails when a required meaning anchor disappears', () => {
  const result = anchorMps({
    rewritten: 'The cache expires after 24 hours.',
    anchors: ['expires after 24 hours', '--no-cache'],
  });

  assert.strictEqual(result.pass_count, 1);
  assert.strictEqual(result.total_count, 2);
  assert.strictEqual(result.mps, 50);
});

test('adversarial report documents the companion recurrence gate', () => {
  const rows = evaluateFixtures(loadFixtures(DEFAULT_INPUT));
  const markdown = formatMarkdown(rows, { input: DEFAULT_INPUT });

  assert.match(markdown, /Proposed MPS-v2 companion check/);
  assert.match(markdown, /style_not_improved/);
  assert.match(markdown, /MPS proxy ≥90 and deterministic AI score ≥60/);
});
