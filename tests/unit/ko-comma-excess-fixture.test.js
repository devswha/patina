import test from 'node:test';
import assert from 'node:assert/strict';

import {
  loadManifest,
  evaluateCandidate,
  candidateFires,
  REWRITE_FLOOR,
} from '../../scripts/ko-comma-excess-candidate-eval.mjs';

test('the KO comma-excess manifest has the shape the process requires', () => {
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
  // Lists that ARE the content: recipes with units, rosters, specs, statistics,
  // procedural 첫째/둘째 documents, and exclamation-heavy personal posts. A rule
  // that fires on these is curve-fitted to commas, not to the parallel tell.
  const docs = loadManifest();
  const boundary = docs.filter((d) => d.class === 'cold' && /레시피|이름|나열|스펙|통계|목록|인원|감탄|실적|재료/.test(d.why));
  assert.ok(boundary.length >= 10, `expected the boundary negatives, found ${boundary.length}`);
});

test('the candidate clears both floors on the fixture', () => {
  const report = evaluateCandidate();
  assert.ok(
    report.precision >= REWRITE_FLOOR.precision && report.recall >= REWRITE_FLOOR.recall,
    `floors: precision ${report.precision}, recall ${report.recall}`,
  );
  assert.equal(report.fp, 0, `no cold document may fire: ${report.falsePositives.join(', ')}`);
});

test('noun and unit lists never fire; inflection stacks do', () => {
  // The two shapes this gap is about, as fixtures: parallel inflection endings
  // are the tell, shared unit/noun characters are not.
  const recipe = '레시피 공유! 밀가루 200g, 설탕 50g, 버터 100g, 계란 2개! 180도에서 20분 굽기! 완성!';
  const roster = '회의 참석자는 김민수, 이영희, 박철수, 최수진 네 명입니다. 안건은 예산 확정과 일정 조정 두 가지입니다. 회의록은 내일 오전 배포하겠습니다.';
  const promo = '저희 서비스는 친절하게, 정확하게, 신속하게, 꼼꼼하게 처리해 드립니다! 언제든 편하게, 부담 없이, 자유롭게, 편리하게 문의해 주세요! 감사합니다!';
  assert.equal(candidateFires(recipe), false, 'a unit list is content, not a tell');
  assert.equal(candidateFires(roster), false, 'a name roster is content, not a tell');
  assert.equal(candidateFires(promo), true, 'a parallel-inflection promo stack must fire');
});
