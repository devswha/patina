import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { createBatchCircuitBreaker } from '../../src/cli/batch.js';

function breaker({ total = 10, ...parsed } = {}) {
  return createBatchCircuitBreaker({ parsed: { batch: true, ...parsed }, total });
}

const fail = (b, path = 'file.txt') => b.recordFailure({ path, err: new Error('boom') });

test('explicit --max-failure-rate keeps the warm-up sample instead of stopping on the first failure (#434)', () => {
  const b = breaker({ maxFailureRate: 0.5, maxFailures: Infinity });

  // One failed file is a 100% ratio over a sample of 1 — must NOT trip an
  // explicit 50% tolerance during warm-up (previously: stop-on-first-failure).
  fail(b);
  assert.equal(b.shouldStop(), false);

  // 1/2 and 2/4 are exactly at the tolerance (not above) — keep going.
  b.recordSuccess();
  assert.equal(b.shouldStop(), false);
  fail(b);
  b.recordSuccess();
  assert.equal(b.shouldStop(), false);

  // 3/5 = 60% > 50% after warm-up — now the configured rate stops the batch.
  fail(b);
  assert.equal(b.shouldStop(), true);
  assert.match(b.toError().message, /failure rate 60\.0% exceeded 50\.0%/);
});

test('explicit rate above the observed ratio lets the batch run past early failures', () => {
  const b = breaker({ maxFailureRate: 0.8, maxFailures: Infinity });
  fail(b);
  fail(b);
  b.recordSuccess();
  b.recordSuccess();
  // 2/4 = 50% <= 80% tolerance the user opted into.
  assert.equal(b.shouldStop(), false);
});

test('default failure-rate path still uses the min(total, 4) warm-up', () => {
  const b = breaker();

  // Defaults: rate 0.25, warm-up min(10, 4) = 4.
  fail(b);
  assert.equal(b.shouldStop(), false, 'first failure is inside the warm-up window');
  b.recordSuccess();
  b.recordSuccess();
  assert.equal(b.shouldStop(), false, 'still below the warm-up sample');
  b.recordSuccess();
  // 1/4 = 25% is not > 25% — boundary stays permissive.
  assert.equal(b.shouldStop(), false);
  fail(b);
  // 2/5 = 40% > 25% after warm-up.
  assert.equal(b.shouldStop(), true);
});

test('--max-failures 1 remains the stop-on-first-failure switch', () => {
  const b = breaker({ maxFailures: 1, maxFailureRate: 0.5 });
  fail(b);
  assert.equal(b.shouldStop(), true);
  assert.match(b.toError().message, /max failures reached \(1\/1\)/);
});

test('small batches engage the rate check only once fully sampled', () => {
  // total 2 → warm-up min(2, 4) = 2.
  const b = breaker({ total: 2, maxFailureRate: 0.5, maxFailures: Infinity });
  fail(b);
  assert.equal(b.shouldStop(), false);
  fail(b);
  // 2/2 = 100% > 50%.
  assert.equal(b.shouldStop(), true);
});
