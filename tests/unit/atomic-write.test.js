import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { writeAtomicUtf8 } from '../../src/atomic-write.js';

const tempDirs = [];

function makeTempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function tempNames(dir) {
  return readdirSync(dir).filter((name) => name.startsWith('.patina-') && name.endsWith('.tmp'));
}

after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

test('writeAtomicUtf8: writes content and leaves no temp file behind', () => {
  const dir = mkdtempSync(join(tmpdir(), 'patina-atomic-'));
  try {
    const dest = join(dir, 'out.xliff');
    writeAtomicUtf8(dest, 'hello <ko> & 안녕');
    assert.equal(readFileSync(dest, 'utf8'), 'hello <ko> & 안녕');
    const leftover = readdirSync(dir).filter((f) => f.startsWith('.patina-') && f.endsWith('.tmp'));
    assert.deepEqual(leftover, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeAtomicUtf8: failure (bad dir) throws and leaves no output at destination', () => {
  const dest = join(tmpdir(), 'no-such-dir-patina', 'nested', 'out.xliff');
  assert.throws(() => writeAtomicUtf8(dest, 'x'));
  assert.equal(existsSync(dest), false);
});

// ---------- resolveBatchOutputPath ----------

test('writeAtomicUtf8: rename onto an existing directory fails, cleans temp, leaves dest intact', () => {
  const dir = mkdtempSync(join(tmpdir(), 'patina-atomic-'));
  try {
    const destDir = join(dir, 'occupied'); // an existing directory at the dest path
    mkdirSync(destDir);
    assert.throws(() => writeAtomicUtf8(destDir, 'x')); // rename(file -> dir) fails
    assert.equal(existsSync(destDir), true); // existing dest untouched
    const leftover = readdirSync(dir).filter((f) => f.startsWith('.patina-') && f.endsWith('.tmp'));
    assert.deepEqual(leftover, [], 'temp file must be cleaned up after rename failure');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('writeAtomicUtf8: write then overwrite preserves exact unicode/newline/CRLF content and no temp remains', () => {
  const dir = makeTempDir('patina-atomic-ok-');
  const dest = join(dir, 'out.xliff');
  const first = 'line1\r\n한글 😀\n';
  const second = 'replacement\r\n中文 😇\nlast';
  assert.equal(writeAtomicUtf8(dest, first), dest);
  assert.equal(readFileSync(dest, 'utf8'), first);
  assert.deepEqual(tempNames(dir), []);
  assert.equal(writeAtomicUtf8(dest, second), dest);
  assert.equal(readFileSync(dest, 'utf8'), second);
  assert.deepEqual(tempNames(dir), []);
});

test('writeAtomicUtf8: missing parent throws without destination or temp leftovers in existing dir', () => {
  const dir = makeTempDir('patina-atomic-fail-');
  const missingParent = join(dir, 'missing');
  const dest = join(missingParent, 'out.xliff');
  assert.throws(() => writeAtomicUtf8(dest, 'partial?'), /ENOENT/);
  assert.equal(existsSync(dest), false);
  assert.deepEqual(tempNames(dir), []);
  assert.equal(existsSync(missingParent), false);
});
