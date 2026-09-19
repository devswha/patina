import test from 'node:test';
import assert from 'node:assert/strict';

import {
  loadManifest,
  evaluateCandidate,
  candidateFires,
  classifyEnding,
  endingProfile,
  REWRITE_FLOOR,
} from '../../scripts/ko-overcorrection-flattening-candidate-eval.mjs';

test('the KO flattening manifest has the shape the process requires', () => {
  const docs = loadManifest();
  assert.equal(docs.length, 50);
  assert.equal(docs.filter((d) => d.class === 'hot').length, 25);
  assert.equal(docs.filter((d) => d.class === 'cold').length, 25);
  assert.ok(new Set(docs.map((d) => d.register)).size >= 2, 'at least two registers');
  assert.equal(new Set(docs.map((d) => d.id)).size, 50, 'ids are unique');
  for (const doc of docs) {
    assert.ok(doc.original?.trim(), `${doc.id} has original text`);
    assert.ok(doc.rewrite?.trim(), `${doc.id} has rewrite text`);
    assert.ok(doc.why?.trim(), `${doc.id} records why it was designed that way`);
  }
});

test('the cold set keeps its five control groups', () => {
  // Removing any group would let the rule fire on work it must not judge:
  // faithful edits, uniform sources, short sources, requested unification,
  // and near-total-but-not-total collapse.
  const docs = loadManifest();
  const byPrefix = (prefix) => docs.filter((d) => d.id.startsWith(prefix)).length;
  assert.equal(byPrefix('cold-faithful-'), 10);
  assert.equal(byPrefix('cold-uniform-'), 4);
  assert.equal(byPrefix('cold-short-'), 4);
  assert.equal(byPrefix('cold-requested-'), 5);
  assert.equal(byPrefix('cold-boundary-'), 2);
  for (const doc of docs.filter((d) => d.registerRequested)) {
    assert.equal(doc.class, 'cold', `${doc.id}: a requested unification is never hot`);
  }
});

test('the recorded conclusion holds: v1 clears the rewrite floor with zero false fires', () => {
  const report = evaluateCandidate().v1;
  assert.ok(
    report.precision >= REWRITE_FLOOR.precision && report.recall >= REWRITE_FLOOR.recall,
    `floors: precision ${report.precision}, recall ${report.recall}`,
  );
  assert.equal(report.fp, 0, `no cold pair may fire: ${report.falsePositives.join(', ')}`);
  // v3 (collapse + >=2 gained calque classes) is recorded as failing the
  // recall floor; pin that so the coupling cannot quietly become the gate.
  assert.ok(evaluateCandidate().v3.recall < REWRITE_FLOOR.recall, 'v3 stays below the recall floor');
});

test('a varied source flattened to one ending fires; the guard classes stay silent', () => {
  const varied = '아침에 비가 왔다. 우산을 챙겼음. 점심엔 그쳤죠. 오후엔 맑았어요. 저녁엔 별이 떴다. 내일도 좋겠다.';
  const flattened = '아침에 비가 왔습니다. 우산을 챙겼습니다. 점심에는 그쳤습니다. 오후에는 맑았습니다. 저녁에는 별이 떴습니다. 내일도 좋을 것입니다.';
  assert.equal(candidateFires(varied, flattened), true, 'an ending collapse over a varied source must fire');
  assert.equal(
    candidateFires(varied, flattened, { registerRequested: true }),
    false,
    'a register the user requested is exempt',
  );
  const uniform = '보고서를 제출했습니다. 검토했습니다. 수정했습니다. 회신했습니다. 공유했습니다.';
  assert.equal(candidateFires(uniform, flattened), false, 'an already-uniform source is never judged');
});

test('the ending classifier handles ㅂ-irregular formal surfaces', () => {
  // 됩니다/드립니다/줍니다 carry the ㅂ as batchim, so the surface never
  // contains "합니다/습니다" — the class must match 니다, not a suffix list.
  assert.equal(classifyEnding('정상화됩니다.'), 'formal');
  assert.equal(classifyEnding('감사드립니다.'), 'formal');
  assert.equal(classifyEnding('곰을 봅니다.'), 'formal');
  assert.equal(classifyEnding('안녕하십니까?'), 'formal');
  assert.equal(classifyEnding('확인했음.'), 'clipped');
  assert.equal(classifyEnding('갈까요?'), 'polite');
  assert.equal(classifyEnding('못 쓰지.'), 'banmal');
  assert.equal(classifyEnding('좋다.'), 'plain');
  // A pair profile must count, not just classify.
  assert.equal(endingProfile('a. b. c. d. e. f.').n, 0, 'non-Korean tails are not classifiable');
});
