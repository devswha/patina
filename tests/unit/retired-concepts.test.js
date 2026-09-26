import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanPaths, scanRoot, scanText } from '../../scripts/check-retired-concepts.mjs';

const retired = ['ouro', 'boros'].join('');
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('current references are forbidden case-insensitively', () => {
  const report = scanText(`Mode: ${retired.toUpperCase()}`, 'README.md');
  assert.equal(report.forbidden.length, 1);
  assert.equal(report.forbidden[0].line, 1);
});

test('clean text passes', () => {
  assert.deepEqual(scanText('Use --verify for meaning-floor checks.', 'docs/CLI.md'), {
    forbidden: [],
    allowed: [],
    error: null,
  });
});

test('changelog allows the term only in releases older than 7.0.0', () => {
  const path = 'CHANGELOG.md';
  const source = readFileSync(resolve(repoRoot, path), 'utf8');
  const report = scanText(source, path);
  assert.equal(report.error, null);
  assert.equal(report.forbidden.length, 0);
  assert.ok(report.allowed.length > 0);

  const current = source.replace(/^## 7\.0\.0.*$/m, (heading) => `${heading}\nCurrent ${retired} expansion`);
  assert.ok(scanText(current, path).forbidden.some((row) => row.text === `Current ${retired} expansion`));

  const prepended = `# Changelog\n\n## 99.0.0 — future\n\n${source}`;
  assert.equal(scanText(prepended, path).forbidden.length, 0, 'new entries above must not move the boundary');

  const malformed = source.replace(/^## 7\.0\.0\b/m, '## 7.0.1');
  assert.match(scanText(malformed, path).error, /7\.0\.0/);
});

test('scanPaths skips archives, binaries, and missing files', () => {
  const root = mkdtempSync(join(tmpdir(), 'patina-retired-scan-'));
  try {
    mkdirSync(resolve(root, '.gjc'), { recursive: true });
    writeFileSync(resolve(root, 'clean.txt'), 'clean text\n');
    writeFileSync(resolve(root, 'binary.bin'), Buffer.from([0, 1, 2]));
    writeFileSync(resolve(root, '.gjc/archive.md'), `${retired}\n`);
    const report = scanPaths(root, ['.gjc/archive.md', 'binary.bin', 'clean.txt', 'missing.txt']);
    assert.equal(report.scanned, 1);
    assert.equal(report.forbidden.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('scanRoot fails closed when tracked-file enumeration is unavailable', () => {
  const root = mkdtempSync(join(tmpdir(), 'patina-retired-git-'));
  try {
    assert.throws(() => scanRoot(root), /Unable to enumerate tracked content/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
