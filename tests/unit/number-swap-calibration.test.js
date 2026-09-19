import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  loadManifest,
  evaluateCandidate,
  candidateFires,
} from '../../scripts/number-swap-candidate-eval.mjs';

const VARIANTS = ['v1', 'v2', 'v3', 'v4'];

test('the calibration manifest has the shape the process requires', () => {
  const docs = loadManifest();
  assert.equal(docs.length, 50);
  assert.equal(docs.filter((d) => d.class === 'swap').length, 20);
  assert.equal(docs.filter((d) => d.class === 'faithful').length, 20);
  assert.equal(docs.filter((d) => d.class === 'drift').length, 8);
  assert.equal(docs.filter((d) => d.class === 'miss').length, 2);
  assert.equal(new Set(docs.map((d) => d.id)).size, 50, 'ids are unique');
  for (const doc of docs) {
    assert.ok(doc.original?.trim(), `${doc.id} has original text`);
    assert.ok(doc.rewrite?.trim(), `${doc.id} has rewrite text`);
    assert.ok(doc.why?.trim(), `${doc.id} records why it was designed that way`);
  }
});

test('every variant reports the four measured cells', () => {
  const report = evaluateCandidate();
  for (const variant of VARIANTS) {
    const r = report.variants[variant];
    assert.ok(r, `${variant} must be measured`);
    assert.equal(r.tp + r.fp + r.tn + r.fn + r.expectedMiss, 50, `${variant} accounts for every row`);
  }
});

test('unit-crossing swaps are caught by the multi-slot variants', () => {
  // The issue's Korean example: 년/명 bindings cross while both values survive.
  const doc = loadManifest().find((d) => d.id === 'swap-ko-01');
  for (const variant of ['v3', 'v4']) {
    assert.equal(candidateFires(doc.original, doc.rewrite, variant), true, `${variant} must catch swap-ko-01`);
  }
});

test('the polarity non-goal holds on every variant', () => {
  // increased->decreased keeps the bag at percent:20/1. Antonym lists are an
  // explicit non-goal, so no binding variant may fire on these rows.
  const misses = loadManifest().filter((d) => d.class === 'miss');
  for (const doc of misses) {
    for (const variant of VARIANTS) {
      assert.equal(candidateFires(doc.original, doc.rewrite, variant), false, `${variant} fired on ${doc.id}`);
    }
  }
});

test('faithful clause reorders stay silent under the nearest-word rule', () => {
  const doc = loadManifest().find((d) => d.id === 'faithful-en-01');
  assert.equal(candidateFires(doc.original, doc.rewrite, 'v1'), false);
});

test('the recorded conclusion still holds: no variant reaches 0.80 precision at 0.50 recall', () => {
  // docs/research/2026-number-swap-calibration.md concludes local binding is
  // not feasible at high precision. If a future variant clears this, the
  // research note and this pin must both be updated deliberately.
  const report = evaluateCandidate();
  for (const variant of VARIANTS) {
    const r = report.variants[variant];
    const clears = r.precision >= 0.80 && r.recall >= 0.50;
    assert.equal(clears, false, `${variant} now clears the bar — update the research note`);
  }
});
