import test from 'node:test';
import assert from 'node:assert/strict';

import {
  loadManifest,
  evaluateCandidate,
  SCORE_ONLY_FLOOR,
} from '../../scripts/ko-conjunction-candidate-eval.mjs';

test('the KO conjunction manifest has the shape the process requires', () => {
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

test('the cold set keeps its boundary documents', () => {
  // These are what stop the fixture from flattering the rule: legitimate Korean
  // that opens every sentence with a connective and still carries real anchors.
  // Removing them would push precision back to a meaningless 1.00.
  const docs = loadManifest();
  const boundary = docs.filter((d) => d.class === 'cold' && d.why.includes('boundary'));
  assert.ok(boundary.length >= 5, `expected the boundary negatives, found ${boundary.length}`);
});

test('the candidate clears the score-only floor on the fixture', () => {
  const report = evaluateCandidate(loadManifest());
  assert.ok(
    report.precision >= SCORE_ONLY_FLOOR.precision && report.recall >= SCORE_ONLY_FLOOR.recall,
    `score-only floor: precision ${report.precision}, recall ${report.recall}`,
  );
  // The rewrite floor (0.80) is deliberately NOT pinned. Measured precision is
  // 0.83 — barely above it — and the false positives are a known systematic class
  // rather than noise, so a future fixture addition dropping below 0.80 would be
  // an informative result, not a regression to block.
});
