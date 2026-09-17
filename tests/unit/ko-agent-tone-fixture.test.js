import test from 'node:test';
import assert from 'node:assert/strict';

import {
  loadManifest,
  evaluateCandidate,
  candidateFires,
  REWRITE_FLOOR,
} from '../../scripts/ko-agent-tone-candidate-eval.mjs';

test('the KO agent-tone manifest has the shape the process requires', () => {
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

test('the cold set keeps its real-CS-reply boundary documents', () => {
  // The gap's central hazard: real customer-service replies use the same
  // vocabulary. They survive on anchors — order numbers, amounts, dates,
  // model names. Removing these negatives would let the rule fire on actual
  // support work.
  const docs = loadManifest();
  const boundary = docs.filter((d) => d.class === 'cold' && /CS|응대|실제|실무|기록|경험/.test(d.why));
  assert.ok(boundary.length >= 10, `expected the CS-reply boundary negatives, found ${boundary.length}`);
});

test('the candidate clears both floors with zero false fires', () => {
  const report = evaluateCandidate();
  assert.ok(
    report.precision >= REWRITE_FLOOR.precision && report.recall >= REWRITE_FLOOR.recall,
    `floors: precision ${report.precision}, recall ${report.recall}`,
  );
  assert.equal(report.fp, 0, `no cold document may fire: ${report.falsePositives.join(', ')}`);
});

test('marker stacks fire; the same vocabulary over a real case does not', () => {
  const vacuous = '안녕하세요, 고객님! 언제든지 편하게 문의해 주세요. 성심성의껏 도와드리겠습니다. 궁금한 점이 있으시면 말씀해 주세요. 항상 최선을 다하겠습니다. 감사합니다!';
  const anchored = '문의해 주셔서 감사합니다. 주문번호 20260917-0042의 환불 32,400원은 오늘 승인 취소되며 3영업일 내 입금됩니다. 추가 문의는 이 스레드에 남겨 주세요.';
  assert.equal(candidateFires(vacuous), true, 'an anchor-free marker stack must fire');
  assert.equal(candidateFires(anchored), false, 'the same vocabulary over a concrete case must not fire');
});
