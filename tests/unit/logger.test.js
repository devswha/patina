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