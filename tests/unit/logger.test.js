import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { createLogger } from '../../src/logger.js';

function captureConsoleError(fn) {
  const original = console.error;
  const lines = [];
  console.error = (message) => lines.push(String(message));
  try {
    fn();
  } finally {
    console.error = original;
  }
  return lines;
}

test('logger respects quiet and PATINA_LOG_LEVEL', () => {
  const previous = process.env.PATINA_LOG_LEVEL;
  process.env.PATINA_LOG_LEVEL = 'warn';
  try {
    const lines = captureConsoleError(() => {
      const logger = createLogger();
      logger.info('hidden', { message: '[patina] hidden' });
      logger.warn('shown', { message: '[patina] shown' });
      createLogger({ quiet: true }).error('also_hidden', { message: '[patina] hidden error' });
    });
    assert.deepEqual(lines, ['[patina] shown']);
  } finally {
    if (previous === undefined) delete process.env.PATINA_LOG_LEVEL;
    else process.env.PATINA_LOG_LEVEL = previous;
  }
});