import test from 'node:test';
import assert from 'node:assert/strict';

import {
  EXPECTED_KO_DIAGNOSTIC_IDS,
  INCONCLUSIVE_STATUSES,
  evaluateRhetoricContract,
  getKoDiagnosticFixture,
  isRhetoricSuccess,
  loadKoDiagnosticFixtures,
  namedDecorativeProblemRemains,
} from '../quality/rhetoric-contract.mjs';

const fixtures = loadKoDiagnosticFixtures();

test('loads the eight synthetic PLAN §2.3 KO diagnostic cases', () => {
  assert.deepEqual(fixtures.map((row) => row.id), [...EXPECTED_KO_DIAGNOSTIC_IDS]);
  assert.equal(fixtures.every((row) => row.kind === 'synthetic-development'), true);
  assert.equal(fixtures.every((row) => row.qualityClaim === false), true);
  assert.deepEqual(
    fixtures.map((row) => row.cohort),
    ['T', 'T', 'C', 'C', 'C', 'C', 'C', 'N'],
  );
  assert.match(getKoDiagnosticFixture('ko-diag-t-innovative').source, /혁신적인 기능/);
  assert.match(getKoDiagnosticFixture('ko-diag-t-count-hype').source, /100명에서 300명으로 폭발적으로/);
  assert.match(getKoDiagnosticFixture('ko-diag-c-traffic-outage').source, /접속량이 폭발적으로.*서버가 중단/);
  assert.match(getKoDiagnosticFixture('ko-diag-c-users-intensity').source, /이용자가 폭발적으로 증가/);
  assert.match(getKoDiagnosticFixture('ko-diag-c-error-possibility').source, /오류율이 감소할 수 있습니다/);
  assert.match(getKoDiagnosticFixture('ko-diag-c-quoted-explosion').source, /폭발적으로 증가했다/);
  assert.match(getKoDiagnosticFixture('ko-diag-c-exponential').source, /지수적으로 증가/);
  assert.match(getKoDiagnosticFixture('ko-diag-n-slogan').source, /놀라운 여름, 더 큰 즐거움/);
});

test('T no-op is uncorrected_failure even when meaning is preserved', () => {
  for (const id of ['ko-diag-t-innovative', 'ko-diag-t-count-hype']) {
    const fixture = getKoDiagnosticFixture(id);
    const result = evaluateRhetoricContract({
      fixture,
      finalText: fixture.source,
      status: 'ok',
      meaningPass: true,
    });
    assert.equal(result.status, 'ok');
    assert.equal(result.meaningPass, true);
    assert.equal(result.rhetoricEditAllowed, true);
    assert.equal(result.uncorrectedFailure, true);
    assert.equal(result.score, null);
    assert.equal(isRhetoricSuccess(result), false);
  }
});

test('T hype swapped for another empty intensifier stays uncorrected', () => {
  const innovativeSwap = '이 획기적인 기능은 CSV를 JSON으로 변환합니다.';
  const innovative = evaluateRhetoricContract({
    fixtureId: 'ko-diag-t-innovative',
    finalText: innovativeSwap,
    status: 'ok',
    meaningPass: true,
  });
  assert.equal(namedDecorativeProblemRemains('ko-diag-t-innovative', innovativeSwap), true);
  assert.equal(innovative.uncorrectedFailure, true);
  assert.equal(isRhetoricSuccess(innovative), false);

  const count = evaluateRhetoricContract({
    fixtureId: 'ko-diag-t-count-hype',
    finalText: '지난달 이용자가 100명에서 300명으로 엄청나게 증가했습니다.',
    status: 'ok',
    meaningPass: true,
  });
  assert.equal(count.uncorrectedFailure, true);
  assert.equal(isRhetoricSuccess(count), false);

  const corrected = evaluateRhetoricContract({
    fixtureId: 'ko-diag-t-innovative',
    finalText: '이 기능은 CSV를 JSON으로 변환합니다.',
    status: 'ok',
    meaningPass: true,
  });
  assert.equal(corrected.uncorrectedFailure, false);
  assert.equal(isRhetoricSuccess(corrected), true);
});

test('C quote, exponential, and slogan preservation is not uncorrected_failure', () => {
  for (const id of ['ko-diag-c-quoted-explosion', 'ko-diag-c-exponential', 'ko-diag-n-slogan']) {
    const fixture = getKoDiagnosticFixture(id);
    const result = evaluateRhetoricContract({
      fixture,
      finalText: fixture.source,
      status: 'ok',
      meaningPass: true,
    });
    assert.equal(result.rhetoricEditAllowed, false);
    assert.equal(result.uncorrectedFailure, false, id);
    assert.equal(namedDecorativeProblemRemains(id, fixture.source), false, `${id} must not use the T word list`);
    assert.equal(isRhetoricSuccess(result), true);
  }
});

test('skipped, timeout, auth, schema, and model_mismatch are not success or score 0', () => {
  const fixture = getKoDiagnosticFixture('ko-diag-t-innovative');
  for (const status of INCONCLUSIVE_STATUSES) {
    const result = evaluateRhetoricContract({
      fixture,
      finalText: '이 기능은 CSV를 JSON으로 변환합니다.',
      status,
      meaningPass: true,
    });
    assert.equal(result.status, status);
    assert.equal(result.meaningPass, null, `${status} must not keep a meaning verdict`);
    assert.equal(result.uncorrectedFailure, null, `${status} must not be a quality verdict`);
    assert.equal(result.score, null);
    assert.notEqual(result.score, 0);
    assert.equal(isRhetoricSuccess(result), false);
    assert.equal(isRhetoricSuccess({ ...result, meaningPass: true, uncorrectedFailure: false, score: 0 }), false);
  }
});
