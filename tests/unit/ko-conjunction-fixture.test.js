import test from 'node:test';
import assert from 'node:assert/strict';

import {
  loadManifest,
  evaluateCandidate,
  candidateFires,
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
  // The rewrite floor (0.80) is deliberately NOT pinned so a future fixture
  // addition dropping below it is an informative result, not a regression to
  // block. Current measured precision is 1.00: the anchor veto below removes
  // every boundary negative without losing a hot document.
});

test('the anchor veto keeps anchored chains out and anchor-free chains in', () => {
  // The decision comment on #880: counting openers alone "cannot distinguish
  // 남발 from ordinary use". These two shapes are that sentence as fixtures.
  const anchoredChain = '그리고 한 가지 더 말씀드리면, 이번 계약은 3년입니다. 또한 갱신 조건은 별도 협의입니다. 다만 해지는 6개월 전 통보가 필요합니다.';
  const anchorFreeChain = '그리고 이러한 노력은 계속되고 있습니다. 또한 이러한 성과는 의미가 있습니다. 따라서 이러한 흐름은 계속될 것입니다.';
  assert.equal(candidateFires(anchoredChain), false, 'a connective chain around real content must not fire');
  assert.equal(candidateFires(anchorFreeChain), true, 'a connective chain with no anchors must fire');
});
