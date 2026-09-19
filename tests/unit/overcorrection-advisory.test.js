import test from 'node:test';
import assert from 'node:assert/strict';

import { warnIfOvercorrected, assessOvercorrection } from '../../src/cli/overcorrection-advisory.js';

function collectLogger() {
  const events = [];
  return {
    events,
    warn(event, fields) { events.push({ event, message: fields?.message }); },
  };
}

// A human draft that leans on em dashes as asides, and a rewrite that strips
// every one of them — the "stop-slop bans dashes" failure #882 describes.
const DASH_ORIGINAL = [
  'The migration took three weekends — longer than anyone budgeted for.',
  'We kept the old bindings — they were the only record of what production did.',
  'By April the smoke check caught two bad configs — both before deploy.',
].join('\n');
const DASH_WIPED = [
  'The migration took three weekends, longer than anyone budgeted for.',
  'We kept the old bindings. They were the only record of what production did.',
  'By April the smoke check caught two bad configs, both before deploy.',
].join('\n');
const DASH_KEPT = [
  'The migration took three weekends — longer than anyone budgeted for.',
  'We kept the old bindings because they recorded what production did.',
  'By April the smoke check caught two bad configs before deploy.',
].join('\n');

test('wiping every typographic dash from a dash-heavy source warns', () => {
  const logger = collectLogger();
  const result = warnIfOvercorrected({ original: DASH_ORIGINAL, text: DASH_WIPED, logger });
  assert.ok(result, 'returns an assessment when the guard fires');
  assert.equal(result.trip, true);
  assert.equal(logger.events.length, 1);
  assert.equal(logger.events[0].event, 'rewrite.overcorrection_guard');
  assert.match(logger.events[0].message, /dash/i);
  assert.match(logger.events[0].message, /Advisory only/, 'the guard never changes output');
});

test('keeping at least one dash does not warn', () => {
  const logger = collectLogger();
  assert.equal(warnIfOvercorrected({ original: DASH_ORIGINAL, text: DASH_KEPT, logger }), null);
  assert.equal(logger.events.length, 0);
});

test('a source that never used dashes is not a dash wipe', () => {
  const logger = collectLogger();
  const plain = 'We shipped the parser on Tuesday. It handled every fixture we had.';
  assert.equal(warnIfOvercorrected({ original: plain, text: plain, logger }), null);
  assert.equal(logger.events.length, 0);
});

test('slang the source never used warns (en)', () => {
  const logger = collectLogger();
  const original = 'The release was delayed because the migration was incomplete.';
  const result = warnIfOvercorrected({ original, text: 'Honestly the release slipped, ngl the migration was not done.', logger, lang: 'en' });
  assert.ok(result);
  assert.equal(result.trip, true);
  assert.match(logger.events[0].message, /slang/i);
});

test('slang already present in the source is not an addition', () => {
  const logger = collectLogger();
  const original = 'ngl the migration was rough.';
  assert.equal(warnIfOvercorrected({ original, text: 'ngl the migration was hard.', logger, lang: 'en' }), null);
  assert.equal(logger.events.length, 0);
});

test('slang the source never used warns (ko)', () => {
  const logger = collectLogger();
  const original = '이번 마이그레이션은 예상보다 오래 걸렸습니다.';
  const result = warnIfOvercorrected({ original, text: 'ㄹㅇ 이번 마이그레이션 오래 걸림 ㅋㅋ', logger, lang: 'ko' });
  assert.ok(result);
  assert.equal(result.trip, true);
});

test('config overcorrection-guard: false disables it', () => {
  const logger = collectLogger();
  assert.equal(
    warnIfOvercorrected({ original: DASH_ORIGINAL, text: DASH_WIPED, logger, config: { 'overcorrection-guard': false } }),
    null,
  );
  assert.equal(logger.events.length, 0);
});

test('assessOvercorrection is pure and never throws on junk input', () => {
  assert.equal(assessOvercorrection(null, null), null);
  assert.equal(assessOvercorrection(undefined, 'text'), null);
  assert.equal(assessOvercorrection(DASH_ORIGINAL, DASH_WIPED).trip, true);
});

test('a new cadence stack in the rewrite warns (en)', () => {
  const original = 'The migration finished over the weekend with no downtime, because the team rehearsed the cutover twice and kept a rollback runbook ready for the on-call engineer.';
  const rewrite = 'We shipped it. One weekend. Zero downtime. The team rehearsed twice.';
  const assessment = assessOvercorrection(original, rewrite, { lang: 'en' });
  assert.equal(assessment?.trip, true);
  assert.ok(assessment.reasons.some((reason) => reason.includes('cadence stack')), assessment.reasons.join(' | '));
  assert.equal(assessment.cadenceIntroduced, true);
});

test('a cadence stack the source already had is not an addition', () => {
  const original = 'We shipped it. One weekend. Zero downtime. The team rehearsed twice and kept the runbook open.';
  const rewrite = 'We shipped it. One weekend. Zero downtime. The runbook stayed open.';
  const assessment = assessOvercorrection(original, rewrite, { lang: 'en' });
  assert.equal(assessment?.cadenceIntroduced ?? false, false);
  if (assessment) assert.ok(!assessment.reasons.some((r) => r.includes('cadence stack')));
});

test('mixed-length prose does not trip the cadence stack', () => {
  const original = 'The quarterly review covered three areas. Budget stayed flat.';
  const rewrite = 'Budget stayed flat this quarter. The review covered hiring, tooling, and vendor costs, with each owner presenting their own numbers for the first time. Hiring paused. Tooling renewed.';
  const assessment = assessOvercorrection(original, rewrite, { lang: 'en' });
  assert.equal(assessment?.cadenceIntroduced ?? false, false);
});

test('ko rewrites never trip the cadence signal (pattern 38 is en-only)', () => {
  const original = '이번 마이그레이션은 주말 동안 무중단으로 완료되었습니다. 팀이 컷오버를 두 번 리허설했고 롤백 런북을 준비했습니다.';
  const rewrite = '완료했습니다. 주말이었죠. 무중단이었습니다. 두 번 리허설했습니다.';
  const assessment = assessOvercorrection(original, rewrite, { lang: 'ko' });
  assert.equal(assessment?.cadenceIntroduced ?? false, false);
});

// ---------- stage 3: Korean flattening (#882) — measured on flattening-50.jsonl ----------

// hot-02 from the fixture: a varied meeting note (다/습니다/음/게요) flattened
// onto plain 평서형.
const KO_FLAT_ORIGINAL = '3시 회의는 30분 늦게 시작됐다. 출석자는 5명이었고, 안건은 두 가지였음. 먼저 배포 일정을 확정했다. 다음 주 월요일로 결론이 났다. 예산안은 보류됐습니다. 다음 회의 때 다시 논의하겠습니다. 회의록은 내일 공유할게요.';
const KO_FLAT_REWRITE = '3시 회의는 30분 늦게 시작되었다. 출석자는 5명이었고 안건은 두 가지였다. 먼저 배포 일정의 확정이 이루어졌다. 다음 주 월요일로 결론이 나왔다. 예산안은 보류의 상태에 놓였다. 다음 회의에서 재논의가 이루어질 예정이다. 회의록의 공유가 내일 진행될 예정이다.';
// cold-faithful-01: a faithful rewrite keeps the ending mix.
const KO_KEPT_REWRITE = '3시 회의는 30분 늦게 시작됐습니다. 출석자는 5명, 안건은 두 건이었음. 배포 일정은 다음 주 월요일로 확정됐습니다. 예산안은 보류됐고 다음 회의에서 다시 논의하겠습니다. 회의록은 내일 공유할게요.';
// cold-uniform-01: an already-uniform 합니다체 source has nothing to defend.
const KO_UNIFORM_ORIGINAL = '안녕하십니까. 6월 정기 점검 안내드립니다. 점검 일시는 6월 14일 토요일 새벽 2시부터 6시까지입니다. 점검 시간 동안 서비스 이용이 제한됩니다. 불편을 드려 죄송합니다. 문의는 고객지원팀으로 부탁드립니다. 감사합니다.';
const KO_UNIFORM_REWRITE = '안녕하십니까. 6월 정기 점검을 안내드립니다. 점검은 6월 14일 토요일 새벽 2시부터 6시까지 진행됩니다. 점검 시간 동안 서비스 이용이 제한됩니다. 불편을 드려 죄송합니다. 문의는 고객지원팀으로 부탁드립니다. 감사합니다.';
// cold-boundary-01: 7/8 unified but one sentence keeps its own ending.
const KO_BOUNDARY_ORIGINAL = '요리 블로그를 시작했다. 첫 포스트는 김치찌개였음. 조회수는 3을 기록했죠. 그중 2는 나였다. 그래도 계속한다. 어느 날 터지겠지. 요리는 취미이자 재테크다. 사진 실력도 늘었으면 좋겠어요.';
const KO_BOUNDARY_REWRITE = '요리 블로그의 시작을 알렸습니다. 첫 포스트는 김치찌개였습니다. 조회수는 3을 기록했습니다. 그중 2는 나였다. 그래도 지속할 예정입니다. 어느 날은 인기를 얻을 것입니다. 요리는 취미이자 재테크입니다. 사진 실력도 늘어나길 바랍니다.';

test('flattening a varied Korean source onto one ending warns (ko, #882 stage 3)', () => {
  const logger = collectLogger();
  const result = warnIfOvercorrected({ original: KO_FLAT_ORIGINAL, text: KO_FLAT_REWRITE, logger, lang: 'ko' });
  assert.ok(result, 'the flattening guard fires');
  assert.equal(result.trip, true);
  assert.ok(result.reasons.some((r) => r.includes('flattened')), result.reasons.join(' | '));
  assert.equal(result.koFlattening.flattened, true);
  assert.equal(result.koFlattening.sourceClasses, 4);
  assert.equal(result.koFlattening.collapsedTo, 'plain');
  assert.equal(logger.events.length, 1);
  assert.match(logger.events[0].message, /Advisory only/);
});

test('a register the user requested is exempt from the flattening note', () => {
  const logger = collectLogger();
  const result = warnIfOvercorrected({
    original: KO_FLAT_ORIGINAL,
    text: '3시 회의는 30분 늦게 시작되었습니다. 출석자는 5명이었고 안건은 두 가지였습니다. 배포 일정은 다음 주 월요일로 확정되었습니다. 예산안은 보류되었습니다. 다음 회의에서 다시 논의하겠습니다. 회의록은 내일 공유하겠습니다.',
    logger,
    lang: 'ko',
    registerRequested: true,
  });
  assert.equal(result, null);
  assert.equal(logger.events.length, 0);
});

test('an already-uniform Korean source is never judged for flattening', () => {
  const logger = collectLogger();
  const result = warnIfOvercorrected({ original: KO_UNIFORM_ORIGINAL, text: KO_UNIFORM_REWRITE, logger, lang: 'ko' });
  assert.equal(result, null);
});

test('a faithful Korean rewrite that keeps the ending mix stays silent', () => {
  const logger = collectLogger();
  const result = warnIfOvercorrected({ original: KO_FLAT_ORIGINAL, text: KO_KEPT_REWRITE, logger, lang: 'ko' });
  assert.equal(result, null);
});

test('a near-total collapse that keeps one source ending stays silent (0.875 boundary)', () => {
  const logger = collectLogger();
  const result = warnIfOvercorrected({ original: KO_BOUNDARY_ORIGINAL, text: KO_BOUNDARY_REWRITE, logger, lang: 'ko' });
  assert.equal(result, null);
});

test('the flattening signal is ko-only: a collapsed english rewrite does not trip it', () => {
  const original = 'The migration finished over the weekend with no downtime, because the team rehearsed the cutover twice and kept a rollback runbook ready for the on-call engineer.';
  const rewrite = 'The migration finished over the weekend with no downtime. The team rehearsed the cutover twice. A rollback runbook stayed ready for the on-call engineer.';
  const assessment = assessOvercorrection(original, rewrite, { lang: 'en' });
  assert.equal(assessment?.koFlattening ?? null, null);
});

test('gained translationese classes ride along as warning context, not as a gate', () => {
  // hot-04: the rewrite flattens AND newly carries 가능성/가지고 있습니다 — the
  // calques must appear in the reason text.
  const original = '주말에 캠핑을 다녀왔다. 장소는 강원도 캠핑장이었음. 밤에는 별이 정말 많았죠. 아이들이 불장난을 하자마자 소동이 났다. 아침엔 안개가 껴서 풍경이 환상적이었어요. 다음엔 가을에 가보고 싶다. 캠핑, 역시 좋다.';
  const rewrite = '주말에 캠핑을 다녀왔습니다. 장소는 강원도의 캠핑장이었습니다. 밤에는 별의 관측이 가능한 하늘이었습니다. 아이들의 불장난으로 소동의 소지가 있었습니다. 아침에는 안개가 낀 풍경이 환상적인 수준이었습니다. 가을의 재방문에 대한 가능성을 가지고 있습니다. 캠핑은 여전히 만족의 대상입니다.';
  const assessment = assessOvercorrection(original, rewrite, { lang: 'ko' });
  assert.equal(assessment?.koFlattening?.flattened, true);
  assert.ok(assessment.koFlattening.gainedCalques.length >= 2, assessment.koFlattening.gainedCalques.join(', '));
  assert.match(assessment.reasons.join(' | '), /translated phrasing/);
});

test('the shipped guard reproduces the measured 50-pair result: 25 fires, 0 false fires', async () => {
  // Ties the implementation to the calibration corpus: any drift between the
  // advisory's gate and scripts/ko-overcorrection-flattening-candidate-eval.mjs
  // breaks this count. (Dynamic import keeps this test out of the module graph
  // of the product code under test.)
  const { loadManifest } = await import('../../scripts/ko-overcorrection-flattening-candidate-eval.mjs');
  const docs = loadManifest();
  let fired = 0;
  const falseFires = [];
  const misses = [];
  for (const doc of docs) {
    const assessment = assessOvercorrection(doc.original, doc.rewrite, {
      lang: 'ko',
      registerRequested: Boolean(doc.registerRequested),
    });
    const flatteningFired = Boolean(assessment?.koFlattening?.flattened);
    if (doc.class === 'hot') {
      if (flatteningFired) fired += 1;
      else misses.push(doc.id);
    } else if (flatteningFired) {
      falseFires.push(doc.id);
    }
  }
  assert.deepEqual(misses, [], `hot pairs the guard failed to flag: ${misses.join(', ')}`);
  assert.deepEqual(falseFires, [], `cold pairs the guard fired on: ${falseFires.join(', ')}`);
  assert.equal(fired, 25);
});
