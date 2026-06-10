import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { extractScoreOverall } from '../../src/cli/score-gate.js';
import { formatOutput } from '../../src/output.js';

// Pins the intentional divergence between the two numeric coercers behind the
// shared overall-score traversal (src/output.js extractOverallScore):
// - score-gate toFiniteScore: plain Number() — rejects anything that is not
//   already a plain number, but accepts exponent notation.
// - output.js toFiniteNumber: strips non-numeric characters before Number()
//   (so "**12**" or "12px" parse), which mangles exponent notation.
// These must NOT be merged; see the comment in src/cli/score-gate.js.

function jsonOverall(overall) {
  const out = formatOutput({ raw: '', overall }, 'score', { format: 'json' });
  return JSON.parse(out).overall;
}

test('coercer divergence: "1e3" → 1000 via score gate, 13 via JSON output', () => {
  assert.equal(extractScoreOverall({ overall: '1e3' }, ''), 1000);
  assert.equal(jsonOverall('1e3'), 13);
});

test('coercer divergence: "12px" → null via score gate, 12 via JSON output', () => {
  assert.equal(extractScoreOverall({ overall: '12px' }, ''), null);
  assert.equal(jsonOverall('12px'), 12);
});

test('coercers agree on plain numbers', () => {
  assert.equal(extractScoreOverall({ overall: 21 }, ''), 21);
  assert.equal(jsonOverall(21), 21);
  assert.equal(extractScoreOverall({ overall: '21.5' }, ''), 21.5);
  assert.equal(jsonOverall('21.5'), 21.5);
});
