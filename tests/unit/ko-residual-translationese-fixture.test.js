import test from 'node:test';
import assert from 'node:assert/strict';

import {
  loadManifest,
  evaluateCandidate,
  candidateFires,
  collectWeakSignals,
  REWRITE_FLOOR,
} from '../../scripts/ko-residual-translationese-candidate-eval.mjs';

test('the KO residual-translationese manifest has the shape the process requires', () => {
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

test('the cold set keeps its native-formal boundary documents', () => {
  // The gap's central hazard: formal Korean (legal, manuals, notices,
  // academic tone) legitimately carries single weak signals. These must keep
  // the rule cold; removing them would let it fire on native formal writing.
  const docs = loadManifest();
  const boundary = docs.filter((d) => d.class === 'cold' && /격식|법률|계약|공고|매뉴얼|문체|공문/.test(d.why));
  assert.ok(boundary.length >= 5, `expected the formal boundary negatives, found ${boundary.length}`);
});

test('the cold ceiling never produces a single genitive chain', () => {
  const docs = loadManifest().filter((d) => d.class === 'cold');
  for (const doc of docs) {
    const genitive = collectWeakSignals(doc.text).active.find((e) => e.id === 'genitive-chain');
    assert.equal(genitive, undefined, `${doc.id} produced a genitive chain`);
  }
});

test('the candidate clears both floors with zero false fires', () => {
  const report = evaluateCandidate();
  assert.ok(
    report.precision >= REWRITE_FLOOR.precision && report.recall >= REWRITE_FLOOR.recall,
    `floors: precision ${report.precision}, recall ${report.recall}`,
  );
  assert.equal(report.fp, 0, `no cold document may fire: ${report.falsePositives.join(', ')}`);
});

test('genitive chains anchor the rule; single weak classes stay cold', () => {
  const coupled = '이 솔루션은 기업의 데이터의 안전한 관리의 효율성을 제공합니다. 사용자는 실시간의 정보의 접근의 가능성을 가지고 있습니다. 시스템은 안정적인 성능을 제공합니다.';
  const chained = '이 책의 내용의 구성은 탄탄합니다. 지식의 확장의 즐거움을 선사합니다. 독자의 성장의 여정을 응원합니다!';
  const formalSingle = '계약 조건은 다음과 같습니다. 총액 1억 원, 납기 3월 31일, 하자보수 2년입니다. 분쟁은 관할 법원에서 해결합니다.';
  assert.equal(candidateFires(coupled), true, 'a chain coupled with weak classes must fire');
  assert.equal(candidateFires(chained), true, 'three standalone chains must fire');
  assert.equal(candidateFires(formalSingle), false, 'single weak signals without a chain must stay cold');
});
