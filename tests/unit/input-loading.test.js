import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadInputText, MAX_INPUT_BYTES } from '../../src/loader.js';
import { loadInputs } from '../../src/cli/input.js';
import { createBatchCircuitBreaker } from '../../src/cli/batch.js';
import { PatinaCliError } from '../../src/errors.js';

function withTmpDir(run) {
  const dir = mkdtempSync(join(tmpdir(), 'patina-input-'));
  try {
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── loadInputText: typed errors + size cap (#503, #508 G1) ───────────────────

test('loadInputText reads a normal file', () => {
  withTmpDir((dir) => {
    const file = join(dir, 'ok.md');
    writeFileSync(file, 'Hello, world.', 'utf8');
    assert.equal(loadInputText(file), 'Hello, world.');
  });
});

test('loadInputText maps a missing file to a typed inputError (exit 2)', () => {
  withTmpDir((dir) => {
    const missing = join(dir, 'nope.md');
    assert.throws(
      () => loadInputText(missing),
      (err) => {
        assert.ok(err instanceof PatinaCliError, 'is a PatinaCliError');
        assert.equal(err.exitCode, 2, 'exits with code 2, not generic 1');
        assert.match(err.message, /file not found/);
        assert.ok(err.message.includes(missing), 'names the offending path');
        return true;
      }
    );
  });
});

test('loadInputText maps a directory path to a typed EISDIR inputError (exit 2)', () => {
  withTmpDir((dir) => {
    assert.throws(
      () => loadInputText(dir),
      (err) => {
        assert.ok(err instanceof PatinaCliError);
        assert.equal(err.exitCode, 2);
        assert.match(err.message, /path is a directory/);
        return true;
      }
    );
  });
});

test('loadInputText rejects a file above the size cap with a typed inputError (exit 2)', () => {
  withTmpDir((dir) => {
    const file = join(dir, 'big.md');
    writeFileSync(file, 'this is more than four bytes', 'utf8');
    // Inject a tiny cap so the oversize branch runs deterministically without
    // materializing a 25 MB fixture.
    assert.throws(
      () => loadInputText(file, 4),
      (err) => {
        assert.ok(err instanceof PatinaCliError);
        assert.equal(err.exitCode, 2);
        assert.match(err.message, /too large/);
        return true;
      }
    );
    // The same file is fine under the real (generous) cap.
    assert.equal(loadInputText(file), 'this is more than four bytes');
  });
});

test('MAX_INPUT_BYTES is the documented 25 MB cap', () => {
  assert.equal(MAX_INPUT_BYTES, 25 * 1024 * 1024);
});

// ── loadInputs: batch collects read errors, single-file fails fast (#503) ────

test('loadInputs in batch mode collects a read error instead of aborting the loop', async () => {
  await withTmpDir(async (dir) => {
    const okA = join(dir, 'a.md');
    const missing = join(dir, 'missing.md');
    const okB = join(dir, 'b.md');
    writeFileSync(okA, 'A', 'utf8');
    writeFileSync(okB, 'B', 'utf8');

    const inputs = await loadInputs({ files: [okA, missing, okB], batch: true }, null);

    // All three files still produce an entry — the bad one did not abort the run.
    assert.equal(inputs.length, 3);

    assert.equal(inputs[0].text, 'A');
    assert.equal(inputs[0].readError, undefined);

    assert.equal(inputs[1].text, null);
    assert.ok(inputs[1].readError instanceof PatinaCliError);
    assert.equal(inputs[1].readError.exitCode, 2);
    assert.match(inputs[1].readError.message, /file not found/);

    assert.equal(inputs[2].text, 'B');
    assert.equal(inputs[2].readError, undefined);
  });
});

test('loadInputs in non-batch mode fails fast on the first unreadable file', async () => {
  await withTmpDir(async (dir) => {
    const okA = join(dir, 'a.md');
    const missing = join(dir, 'missing.md');
    const okB = join(dir, 'b.md');
    writeFileSync(okA, 'A', 'utf8');
    writeFileSync(okB, 'B', 'utf8');

    await assert.rejects(
      () => loadInputs({ files: [okA, missing, okB], batch: false }, null),
      (err) => {
        assert.ok(err instanceof PatinaCliError);
        assert.equal(err.exitCode, 2);
        assert.match(err.message, /file not found/);
        return true;
      }
    );
  });
});

// ── #503 end-to-end contract: read failures flow through the circuit breaker ─

test('a batch read failure counts against the budget and lets readable files process', async () => {
  await withTmpDir(async (dir) => {
    const okA = join(dir, 'a.md');
    const missing = join(dir, 'missing.md');
    const okB = join(dir, 'b.md');
    writeFileSync(okA, 'A', 'utf8');
    writeFileSync(okB, 'B', 'utf8');

    const parsed = { files: [okA, missing, okB], batch: true, maxFailures: 5, maxFailureRate: 1 };
    const inputs = await loadInputs(parsed, null);
    const breaker = createBatchCircuitBreaker({ parsed, total: inputs.length });

    // Mirror run.js's per-file loop: replay readError as a recorded failure.
    let processed = 0;
    for (const { readError } of inputs) {
      if (readError) {
        breaker.recordFailure({ path: 'x', err: readError });
        assert.equal(breaker.shouldStop(), false, 'one read failure under budget does not abort');
      } else {
        breaker.recordSuccess();
        processed++;
      }
    }

    assert.equal(processed, 2, 'both readable files were processed');
    assert.equal(breaker.failures.length, 1, 'exactly one failure recorded');
    assert.equal(breaker.shouldStop(), false);
  });
});

test('a batch read failure trips --max-failures 1 like any other per-file failure', async () => {
  await withTmpDir(async (dir) => {
    const okA = join(dir, 'a.md');
    const missing = join(dir, 'missing.md');
    writeFileSync(okA, 'A', 'utf8');

    const parsed = { files: [okA, missing], batch: true, maxFailures: 1 };
    const inputs = await loadInputs(parsed, null);
    const breaker = createBatchCircuitBreaker({ parsed, total: inputs.length });

    const failed = inputs.find((entry) => entry.readError);
    assert.ok(failed, 'missing file surfaced a readError entry');
    breaker.recordFailure({ path: failed.path, err: failed.readError });

    // The read failure now participates in the documented breaker contract
    // instead of crashing the run with a raw exit 1 (#503).
    assert.equal(breaker.shouldStop(), true);
    assert.match(breaker.toError().message, /max failures reached \(1\/1\)/);
  });
});
