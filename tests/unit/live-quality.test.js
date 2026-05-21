import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import {
  classifyQuality,
  computeMeaningSafety,
  evaluateRewriteQuality,
  loadLiveFixtures,
  renderMarkdownReport,
  runLiveQuality,
} from '../quality/live-quality.mjs';

const fixture = {
  fixture_id: 'en-unit-live-01',
  language: 'en',
  register: 'unit',
  source_type: 'synthetic-ai',
  model_family: 'fixture',
  prompt_id: 'unit',
  redistribution: 'repo-ok',
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

test('live fixtures carry required metadata for the scaffold', () => {
  const fixtures = loadLiveFixtures();
  assert.ok(fixtures.length >= 2);
  assert.ok(fixtures.some((item) => item.language === 'en'));
  assert.ok(fixtures.some((item) => item.language === 'ko'));
  for (const item of fixtures) {
    assert.equal(item.redistribution, 'repo-ok');
    assert.ok(Array.isArray(item.facts));
    assert.ok(item.facts.length > 0);
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
