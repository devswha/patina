import { test } from 'node:test';
import { strict as assert } from 'node:assert';

import { parseArgs, validateOutputRouting } from '../../src/cli/args.js';
import { applyScoreGate } from '../../src/cli/score-gate.js';
import { PatinaCliError, getProcessExitCode } from '../../src/errors.js';

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

test('bin exit code preserves score-gate code over later batch summary error (#526)', () => {
  const err = new PatinaCliError({
    what: 'batch completed with failures',
    why: 'One file failed after another file exceeded the score gate.',
    action: 'Review the failed batch entries.',
    exitCode: 1,
  });

  assert.equal(getProcessExitCode(err, 3), 3);
  assert.equal(getProcessExitCode(err, undefined), 1);
});

test('empty --suffix=/--outdir= is rejected instead of silently printing to stdout (#504)', () => {
  // The bug: '' passes the `!== undefined` destination check but is falsy, so
  // writeBatchOutput fell through to stdout (no files written, no error).
  let suffixErr;
  try {
    validateOutputRouting(parseArgs(['--batch', '--suffix=', 'a.md', 'b.md']));
  } catch (e) {
    suffixErr = e;
  }
  assert.ok(suffixErr instanceof PatinaCliError);
  assert.equal(suffixErr.exitCode, 2);
  assert.match(suffixErr.what, /--suffix requires a non-empty value/);

  let outdirErr;
  try {
    validateOutputRouting(parseArgs(['--batch', '--outdir=', 'a.md', 'b.md']));
  } catch (e) {
    outdirErr = e;
  }
  assert.ok(outdirErr instanceof PatinaCliError);
  assert.equal(outdirErr.exitCode, 2);
  assert.match(outdirErr.what, /--outdir requires a non-empty value/);

  // The existing 'requires --batch' and 'cannot be combined' errors still take
  // precedence over the empty-value check.
  assert.throws(
    () => validateOutputRouting(parseArgs(['--suffix=', 'a.md'])),
    /--suffix requires --batch/,
  );
  assert.throws(
    () => validateOutputRouting(parseArgs(['--batch', '--suffix=', '--outdir', 'out', 'a.md'])),
    /--suffix and --outdir cannot be combined/,
  );
});

test('valid non-empty --suffix/--outdir still pass routing validation (#504)', () => {
  validateOutputRouting(parseArgs(['--batch', '--suffix=.patina', 'a.md', 'b.md']));
  validateOutputRouting(parseArgs(['--batch', '--suffix', '-humanized', 'a.md', 'b.md']));
  validateOutputRouting(parseArgs(['--batch', '--outdir=out', 'a.md', 'b.md']));
  validateOutputRouting(parseArgs(['--batch', '--outdir', 'out/', 'a.md', 'b.md']));
  // --in-place takes no value and is unaffected.
  validateOutputRouting(parseArgs(['--batch', '--in-place', 'a.md', 'b.md']));
});

test('--max-failure-rate in the ambiguous (1,2) interval warns but still returns the percent ratio (#508 G4)', () => {
  const original = process.stderr.write;
  const lines = [];
  process.stderr.write = (chunk) => {
    lines.push(String(chunk));
    return true;
  };
  let parsed;
  try {
    parsed = parseArgs(['--max-failure-rate', '1.5']);
  } finally {
    process.stderr.write = original;
  }
  // Backward compatible: 1.5 is still read as 1.5% -> ratio 0.015 (no throw).
  assert.equal(parsed.maxFailureRate, 0.015);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\[patina\] --max-failure-rate 1\.5 read as 1\.5% \(ratio 0\.015\)/);
  assert.match(lines[0], /Use a value <=1 for a ratio/);
});

test('--max-failure-rate values outside (1,2) do not warn (#508 G4)', () => {
  const original = process.stderr.write;
  const lines = [];
  process.stderr.write = (chunk) => {
    lines.push(String(chunk));
    return true;
  };
  let ratios;
  try {
    ratios = {
      // ratio form (<=1): no percent reinterpretation, no warning.
      quarter: parseArgs(['--max-failure-rate', '0.25']).maxFailureRate,
      // clear percent (>=2): unambiguous, no warning.
      twentyFive: parseArgs(['--max-failure-rate', '25']).maxFailureRate,
      twoPointFive: parseArgs(['--max-failure-rate', '2.5']).maxFailureRate,
    };
  } finally {
    process.stderr.write = original;
  }
  assert.equal(ratios.quarter, 0.25);
  assert.equal(ratios.twentyFive, 0.25);
  assert.equal(ratios.twoPointFive, 0.025);
  assert.deepEqual(lines, []);
});
