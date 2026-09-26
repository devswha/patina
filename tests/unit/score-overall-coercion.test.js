import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { extractScoreOverall } from '../../src/cli/score-gate.js';
import { formatOutput } from '../../src/output.js';

// The score gate and the JSON formatter share one overall-score traversal
// (src/output.js extractOverallScore) that parses strictly: a plain numeric
// token (including exponent notation) is accepted, anything else is null, so
// a wrong-but-finite overall cannot flip the --format json gate (#505).

function jsonOverall(overall) {
  const out = formatOutput({ raw: '', overall }, 'score', { format: 'json' });
  return JSON.parse(out).overall;
}

test('exponent notation parses to its real value on both paths (#505)', () => {
  assert.equal(extractScoreOverall({ overall: '1e3' }, ''), 1000);
  assert.equal(jsonOverall('1e3'), 1000);
  assert.equal(extractScoreOverall({ overall: '1e2' }, ''), 100);
  assert.equal(jsonOverall('1e2'), 100);
});

test('non-numeric junk is rejected to null on both paths (#505)', () => {
  for (const junk of ['12px', '12abc34', '8%', '**12**', 'abc']) {
    assert.equal(extractScoreOverall({ overall: junk }, ''), null, `score gate: ${junk}`);
    assert.equal(jsonOverall(junk), null, `json output: ${junk}`);
  }
  assert.equal(extractScoreOverall({ overall: '  ' }, ''), null);
  assert.equal(jsonOverall('  '), null);
});

test('plain numbers parse on both paths', () => {
  assert.equal(extractScoreOverall({ overall: 21 }, ''), 21);
  assert.equal(jsonOverall(21), 21);
  assert.equal(extractScoreOverall({ overall: '21.5' }, ''), 21.5);
  assert.equal(jsonOverall('21.5'), 21.5);
  // Surrounding whitespace is tolerated, whitespace-only is rejected.
  assert.equal(jsonOverall(' 30 '), 30);
});
