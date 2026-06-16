import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { createLogger } from '../../src/logger.js';

function captureStream() {
  const lines = [];
  const stream = { write: (chunk) => lines.push(String(chunk).replace(/\n$/, '')) };
  return { stream, lines };
}

test('logger respects quiet and PATINA_LOG_LEVEL', () => {
  const previous = process.env.PATINA_LOG_LEVEL;
  process.env.PATINA_LOG_LEVEL = 'warn';
  try {
    const cap = captureStream();
    const logger = createLogger({ stream: cap.stream });
    logger.info('hidden', { message: '[patina] hidden' });
    logger.warn('shown', { message: '[patina] shown' });
    createLogger({ quiet: true, stream: cap.stream }).error('also_hidden', { message: '[patina] hidden error' });
    assert.deepEqual(cap.lines, ['[patina] shown']);
  } finally {
    if (previous === undefined) delete process.env.PATINA_LOG_LEVEL;
    else process.env.PATINA_LOG_LEVEL = previous;
  }
});

test('logger falls back to the structured event name when no message is provided (G3)', () => {
  const cap = captureStream();
  const logger = createLogger({ stream: cap.stream, level: 'info' });
  // Previously dropped silently because emit() short-circuited on a missing
  // message; now the event name is written instead.
  logger.warn('some.event', { code: 42 });
  // A message-bearing call is unchanged: the message still wins over the event.
  logger.warn('explicit', { message: '[patina] explicit message' });
  assert.deepEqual(cap.lines, ['some.event', '[patina] explicit message']);
});

test('logger still drops an event with neither a message nor an event name', () => {
  const cap = captureStream();
  const logger = createLogger({ stream: cap.stream, level: 'info' });
  logger.warn('');
  logger.warn(undefined, { code: 1 });
  assert.deepEqual(cap.lines, []);
});