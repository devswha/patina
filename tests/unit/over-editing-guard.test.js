import test from 'node:test';
import assert from 'node:assert/strict';

import { warnIfAlreadyHuman } from '../../src/cli/run.js';

function collectLogger() {
  const events = [];
  return {
    events,
    warn(event, fields) { events.push({ event, message: fields?.message }); },
  };
}

const cleanScore = { skipped: false, paragraphCount: 5, hotParagraphs: 0, signalScore: 3.2, overall: 0 };

test('warns when the deterministic layer finds nothing to fix', () => {
  const logger = collectLogger();
  const result = warnIfAlreadyHuman({ text: 'x', logger, scorer: () => cleanScore });
  assert.ok(result, 'returns the score when the guard fires');
  assert.equal(logger.events.length, 1);
  assert.equal(logger.events[0].event, 'rewrite.over_editing_guard');
  assert.match(logger.events[0].message, /already reads human/);
  assert.match(logger.events[0].message, /Proceeding/, 'guard is advisory, never blocking');
});

test('stays silent when there is anything to fix or the score is unusable', () => {
  const cases = [
    { ...cleanScore, hotParagraphs: 1 },
    { ...cleanScore, signalScore: 25 },
    { ...cleanScore, overall: 12 },
    { ...cleanScore, paragraphCount: 2 }, // too short to judge (Study 0 Dev 1)
    { ...cleanScore, skipped: true },
    null,
  ];
  for (const score of cases) {
    const logger = collectLogger();
    const result = warnIfAlreadyHuman({ text: 'x', logger, scorer: () => score });
    assert.equal(result, null, `no guard for ${JSON.stringify(score)}`);
    assert.equal(logger.events.length, 0);
  }
});

test('config over-editing-guard: false disables it; scorer throw never escapes', () => {
  const logger = collectLogger();
  assert.equal(
    warnIfAlreadyHuman({ text: 'x', config: { 'over-editing-guard': false }, logger, scorer: () => cleanScore }),
    null,
  );
  assert.equal(logger.events.length, 0);

  assert.equal(
    warnIfAlreadyHuman({ text: 'x', logger, scorer: () => { throw new Error('boom'); } }),
    null,
    'a scorer failure must never break the rewrite path',
  );
});
