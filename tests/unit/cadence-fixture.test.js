import test from 'node:test';
import assert from 'node:assert/strict';

import {
  loadManifest,
  evaluateCadenceFixture,
  SCORE_ONLY_FLOOR,
  REWRITE_FLOOR,
} from '../../scripts/cadence-fixture-eval.mjs';

// The promotion gate for #879. process/pattern-freshness.md says a candidate that
// misses its floor must keep its issue open rather than have the gate lowered, so
// this pins the floors themselves — not the exact TP/FN counts, which may move if
// someone legitimately improves the detector.

test('the cadence promotion manifest has the shape the process requires', () => {
  const docs = loadManifest();
  assert.equal(docs.length, 50);
  assert.equal(docs.filter((d) => d.class === 'hot').length, 25);
  assert.equal(docs.filter((d) => d.class === 'cold').length, 25);
  assert.ok(new Set(docs.map((d) => d.register)).size >= 2, 'at least two registers');
  assert.equal(new Set(docs.map((d) => d.id)).size, 50, 'ids are unique');
  for (const doc of docs) {
    assert.ok(doc.text?.trim(), `${doc.id} has text`);
    assert.ok(doc.why?.trim(), `${doc.id} records why it was designed that way`);
  }
});

test('every fixture document is eligible, so the detector actually runs on it', () => {
  const report = evaluateCadenceFixture(loadManifest());
  assert.deepEqual(report.ineligible, [], 'an ineligible document would silently pad the cold side');
});

test('the shipped cadence signal clears its promotion floors on the fixture', () => {
  const report = evaluateCadenceFixture(loadManifest());
  assert.ok(
    report.precision >= SCORE_ONLY_FLOOR.precision && report.recall >= SCORE_ONLY_FLOOR.recall,
    `score-only floor: precision ${report.precision}, recall ${report.recall}`,
  );
  assert.ok(
    report.precision >= REWRITE_FLOOR.precision && report.recall >= REWRITE_FLOOR.recall,
    `rewrite floor: precision ${report.precision}, recall ${report.recall}`,
  );
  // "no severe false positives" is the part that protects human writing.
  assert.equal(report.fp, 0, `false positives: ${JSON.stringify(report.falsePositives.map((r) => r.id))}`);
});
