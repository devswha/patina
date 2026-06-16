import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { extractScoreOverall } from '../../src/cli/score-gate.js';
import { formatOutput } from '../../src/output.js';

// Both numeric coercers behind the shared overall-score traversal
// (src/output.js extractOverallScore) now parse strictly: a plain numeric
// token (including exponent notation) is accepted, and anything else is
// rejected to null. Previously output.js toFiniteNumber stripped non-numeric
// characters before Number(), which mangled exponent notation ("1e3" -> 13)
// and silently salvaged junk ("12px" -> 12, "12abc34" -> 1234, "8%" -> 8) —
// a wrong-but-finite overall could flip the --format json gate (#505). The
// score-gate toFiniteScore was already strict; the two now agree.

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
  // Whitespace-only diverges only because the score gate's toFiniteScore
  // coerces "  " to 0 (a pre-existing quirk, out of #505 scope); the strict
  // JSON-output coercer rejects it.
  assert.equal(jsonOverall('  '), null);
});

test('coercers agree on plain numbers', () => {
  assert.equal(extractScoreOverall({ overall: 21 }, ''), 21);
  assert.equal(jsonOverall(21), 21);
  assert.equal(extractScoreOverall({ overall: '21.5' }, ''), 21.5);
  assert.equal(jsonOverall('21.5'), 21.5);
  // Surrounding whitespace is tolerated, whitespace-only is rejected.
  assert.equal(jsonOverall(' 30 '), 30);
});
