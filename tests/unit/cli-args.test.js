import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { parseArgs, validateOutputRouting } from '../../src/cli/args.js';
import { applyScoreGate } from '../../src/cli/score-gate.js';
import { PatinaCliError } from '../../src/errors.js';

test('output routing flags require --batch (#440)', () => {
  assert.throws(
    () => validateOutputRouting(parseArgs(['--in-place', 'draft.md'])),
    /--in-place requires --batch/,
  );
  assert.throws(
    () => validateOutputRouting(parseArgs(['--suffix', '-humanized', 'draft.md'])),
    /--suffix requires --batch/,
  );
  assert.throws(
    () => validateOutputRouting(parseArgs(['--outdir', 'out', 'draft.md'])),
    /--outdir requires --batch/,
  );
  // With --batch each destination is valid on its own.
  for (const flags of [['--in-place'], ['--suffix', '-x'], ['--outdir', 'out']]) {
    validateOutputRouting(parseArgs(['--batch', ...flags, 'a.md', 'b.md']));
  }
});

test('output destinations are mutually exclusive (#440)', () => {
  assert.throws(
    () => validateOutputRouting(parseArgs(['--batch', '--in-place', '--outdir', 'out', 'a.md'])),
    /--in-place and --outdir cannot be combined/,
  );
  assert.throws(
    () => validateOutputRouting(parseArgs(['--batch', '--suffix', '-x', '--outdir', 'out', 'a.md'])),
    /--suffix and --outdir cannot be combined/,
  );
});

test('--outdir rejects input basename collisions instead of silently overwriting (#440)', () => {
  assert.throws(
    () => validateOutputRouting(parseArgs(['--batch', '--outdir', 'out', 'a/readme.md', 'b/readme.md'])),
    /--outdir would overwrite readme\.md/,
  );
  // Distinct basenames and a repeated identical path are fine.
  validateOutputRouting(parseArgs(['--batch', '--outdir', 'out', 'a/one.md', 'b/two.md']));
  validateOutputRouting(parseArgs(['--batch', '--outdir', 'out', 'a/one.md', 'a/one.md']));
});

test('--suffix keeps hyphen values but rejects swallowed flag names (#440)', () => {
  assert.equal(parseArgs(['--batch', '--suffix', '-humanized', 'a.md']).suffix, '-humanized');
  assert.throws(
    () => parseArgs(['--suffix', '--batch', 'a.md']),
    /--suffix requires a value/,
  );
  assert.throws(
    () => parseArgs(['--suffix', '--outdir', 'a.md']),
    /--suffix requires a value/,
  );
});

test('--no-stop-on-retryable-storm turns storm stopping off (#440)', () => {
  assert.equal(parseArgs(['--batch']).stopOnRetryableStorm, undefined);
  assert.equal(parseArgs(['--batch', '--stop-on-retryable-storm']).stopOnRetryableStorm, true);
  assert.equal(parseArgs(['--batch', '--no-stop-on-retryable-storm']).stopOnRetryableStorm, false);
});

test('blank numeric values are rejected instead of coercing to 0 (#440)', () => {
  assert.throws(() => parseArgs(['--exit-on', '']), /--exit-on expects a number/);
  assert.throws(() => parseArgs(['--exit-on', '   ']), /--exit-on expects a number/);
  assert.throws(() => parseArgs(['--max-retries', '']), /--max-retries expects a non-negative integer/);
  assert.throws(() => parseArgs(['--max-failure-rate', '']), /--max-failure-rate expects a ratio or percent/);
  // Explicit zeros remain valid.
  assert.equal(parseArgs(['--exit-on', '0']).gate, 0);
  assert.equal(parseArgs(['--max-retries', '0']).maxRetries, 0);
});

test('--flag=value works for value-taking options (#440)', () => {
  const parsed = parseArgs(['--lang=en', '--max-retries=2', '--suffix=-humanized', 'a.md']);
  assert.equal(parsed.lang, 'en');
  assert.equal(parsed.maxRetries, 2);
  assert.equal(parsed.suffix, '-humanized');
  assert.deepEqual(parsed.files, ['a.md']);
});

test('=value on boolean switches and unknown options stays an error (#440)', () => {
  assert.throws(() => parseArgs(['--quiet=1']), /--quiet does not take a value/);
  assert.throws(() => parseArgs(['--unknown=x']), /unknown option --unknown=x/);
});

test('-- ends option parsing so dash-prefixed files are usable (#440)', () => {
  const parsed = parseArgs(['--lang', 'en', '--', '-draft.md', '--not-a-flag.md']);
  assert.equal(parsed.lang, 'en');
  assert.deepEqual(parsed.files, ['-draft.md', '--not-a-flag.md']);
});

test('applyScoreGate throws a typed runtime error when overall is missing (#440)', () => {
  let err;
  try {
    applyScoreGate('no score here', 'no score here', 30, { warn() {} });
  } catch (e) {
    err = e;
  }
  assert.ok(err instanceof PatinaCliError);
  assert.equal(err.exitCode, 1);
  assert.match(err.what, /score gate could not find a numeric overall value/);
  assert.match(err.action, /--format json/);
});
