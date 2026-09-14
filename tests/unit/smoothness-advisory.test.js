import test from 'node:test';
import assert from 'node:assert/strict';

import { warnIfTooSmooth } from '../../src/cli/smoothness-advisory.js';

function collectLogger() {
  const events = [];
  return {
    events,
    warn(event, fields) { events.push({ event, message: fields?.message }); },
  };
}

const BELOW_BAND = [
  'The cat sat on the red mat now.',
  'The dog ran on the old rug now.',
  'The fox hid in the big den now.',
  'The hen sat on the hay bed now.',
].join('\n');

const NATURAL_VARIED = [
  'Stop.',
  'I spent the better part of an afternoon walking that street before I noticed the bakery had already closed for the long weekend.',
  'She just shrugged and said maybe tomorrow!',
].join('\n');

test('below-band rewrite output warns', () => {
  const logger = collectLogger();
  const result = warnIfTooSmooth({ text: BELOW_BAND, logger });
  assert.ok(result, 'returns an assessment when the floor fires');
  assert.equal(result.trip, true);
  assert.equal(logger.events.length, 1);
  assert.equal(logger.events[0].event, 'rewrite.smoothness_floor');
  assert.match(logger.events[0].message, /unusually even/);
  assert.match(logger.events[0].message, /Advisory only/, 'floor is advisory, never blocking');
});

test('natural-varied text does not warn', () => {
  const logger = collectLogger();
  const result = warnIfTooSmooth({ text: NATURAL_VARIED, logger });
  assert.equal(result, null);
  assert.equal(logger.events.length, 0);
});

test('short text returns null', () => {
  const logger = collectLogger();
  assert.equal(warnIfTooSmooth({ text: 'Hello there friend.', logger }), null);
  assert.equal(warnIfTooSmooth({ text: 'One sentence.\nTwo sentences.', logger }), null);
  assert.equal(logger.events.length, 0);
});

test('config smoothness-floor: false disables it', () => {
  const logger = collectLogger();
  assert.equal(
    warnIfTooSmooth({
      text: BELOW_BAND,
      config: { 'smoothness-floor': false },
      logger,
    }),
    null,
  );
  assert.equal(logger.events.length, 0);
});
