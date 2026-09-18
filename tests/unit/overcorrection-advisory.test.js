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
