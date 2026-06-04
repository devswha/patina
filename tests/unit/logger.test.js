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

test('logger emits NDJSON records with stable fields', () => {
  const lines = captureConsoleError(() => {
    const logger = createLogger({ json: true });
    logger.info('rewrite.complete', {
      message: '[patina] rewrite complete',
      model: 'claude',
      latency_ms: 1234,
    });
  });

  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]);
  assert.equal(record.level, 'info');
  assert.equal(record.event, 'rewrite.complete');
  assert.equal(record.model, 'claude');
  assert.equal(record.latency_ms, 1234);
});
