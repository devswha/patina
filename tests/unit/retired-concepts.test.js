import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LIFECYCLE_MARKER_PATH,
  REQUIRED_LIFECYCLE_ID,
  scanLifecycleRecord,
  scanLifecycleText,
  scanPaths,
  scanRoot,
  scanText,
} from '../../scripts/check-retired-concepts.mjs';

const retired = ['ouro', 'boros'].join('');
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
function relocateFirstMatch(source) {
  const lines = source.split('\n');
  const from = lines.findIndex((line) => line.toLowerCase().includes(retired));
  assert.notEqual(from, -1);
  const to = lines.findIndex((line, index) => index > from && !line.toLowerCase().includes(retired));
  assert.notEqual(to, -1);
  [lines[from], lines[to]] = [lines[to], lines[from]];
  return lines.join('\n');
}

const lifecycleMarker = '<!-- maintenance-lifecycle: npm-token-publishing; owner=repository-maintainer; review=2026-10-09; remove-after=root-and-alias-trusted-publishing-verified -->';

test('temporary publication lifecycle marker requires owner, review, and removal condition', () => {
  const clean = scanLifecycleText(`before\n${lifecycleMarker}\nafter\n`);
  assert.equal(clean.errors.length, 0);
  assert.equal(clean.records.length, 1);
  assert.equal(clean.records[0].id, REQUIRED_LIFECYCLE_ID);
  assert.equal(clean.records[0].owner, 'repository-maintainer');
  assert.equal(clean.records[0].review, '2026-10-09');
  assert.equal(clean.records[0]['remove-after'], 'root-and-alias-trusted-publishing-verified');

  const missing = scanLifecycleText(
    '<!-- maintenance-lifecycle: npm-token-publishing; owner=; review=; remove-after= -->'
  );
  assert.equal(missing.records.length, 1);
  assert.deepEqual(
    missing.errors.map((error) => error.field),
    ['owner', 'review', 'remove-after']
  );

  const malformedDate = scanLifecycleText(
    '<!-- maintenance-lifecycle: npm-token-publishing; owner=maintainer; review=next-month; remove-after=verified -->'
  );
  assert.ok(malformedDate.errors.some((error) => error.field === 'review'));
  const impossibleDate = scanLifecycleText(
    '<!-- maintenance-lifecycle: npm-token-publishing; owner=maintainer; review=2023-02-29; remove-after=verified -->'
  );
  assert.ok(impossibleDate.errors.some((error) => error.field === 'review'));

  const duplicateField = scanLifecycleText(
    '<!-- maintenance-lifecycle: npm-token-publishing; owner=maintainer; owner=another-maintainer; review=2026-10-09; remove-after=verified -->'
  );
  assert.ok(duplicateField.errors.some((error) => error.field === 'owner' && /duplicated/.test(error.reason)));

  const malformedField = scanLifecycleText(
    '<!-- maintenance-lifecycle: npm-token-publishing; owner; review=2026-10-09; remove-after=verified -->'
  );
  assert.ok(malformedField.errors.some((error) => error.segment === 'owner'));
  // The checker records lifecycle metadata; it never makes a date-based
  // deletion or pass decision.
});

test('root lifecycle pilot checks the tracked release policy path only', () => {
  const root = mkdtempSync(join(tmpdir(), 'patina-lifecycle-scan-'));
  try {
    mkdirSync(resolve(root, 'docs/integrations'), { recursive: true });
    writeFileSync(resolve(root, LIFECYCLE_MARKER_PATH), lifecycleMarker);
    const files = [LIFECYCLE_MARKER_PATH];
    const report = scanLifecycleRecord(root, files, new Map([
      [LIFECYCLE_MARKER_PATH, lifecycleMarker],
    ]));
    assert.equal(report.errors.length, 0);
    assert.equal(report.records.length, 1);

    const missing = scanLifecycleRecord(root, files, new Map([
      [LIFECYCLE_MARKER_PATH, '<!-- maintenance-lifecycle: npm-token-publishing; owner=maintainer -->'],
    ]));
    assert.ok(missing.errors.some((error) => error.field === 'review'));

    writeFileSync(resolve(root, LIFECYCLE_MARKER_PATH), Buffer.from(`${lifecycleMarker}\n\0`, 'utf8'));
    const binary = scanPaths(root, files, { requireLifecycleRecords: true });
    assert.equal(binary.filesSkipped.binary, 1);
    assert.equal(binary.lifecycleRecordCount, 0);
    assert.ok(binary.lifecycleDrift.some((error) => /unavailable/.test(error.reason)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


test('current product references are forbidden case-insensitively', () => {
  const report = scanText(`Mode: ${retired.toUpperCase()}`, 'README.md');
  assert.equal(report.forbidden.length, 1);
  assert.equal(report.allowed.length, 0);
  assert.equal(report.historicalDrift.length, 0);
  assert.equal(report.forbidden[0].line, 1);
});

test('clean current product text passes', () => {
  const report = scanText('Use --verify for meaning-floor checks.', 'docs/CLI.md');
  assert.deepEqual(report, { forbidden: [], allowed: [], historicalDrift: [] });
});

test('changelog uses the exact 7.0.0 boundary and pinned historical occurrences', () => {
  const path = 'CHANGELOG.md';
  const source = readFileSync(resolve(repoRoot, path), 'utf8');
  const report = scanText(source, path);
  assert.equal(report.forbidden.length, 0);
  assert.equal(report.allowed.length, 13);
  assert.equal(report.historicalDrift.length, 0);

  const currentExpansion = source.replace(
    /^## 7\.0\.0.*$/m,
    (heading) => `${heading}\nCurrent ${retired} expansion`
  );
  const currentExpansionReport = scanText(currentExpansion, path);
  assert.ok(currentExpansionReport.forbidden.some((row) => row.text === `Current ${retired} expansion`));
  assert.ok(currentExpansionReport.historicalDrift.length > 0);

  const historicalExpansion = `${source}\n## 0.0.0 — historical fixture\nHistorical ${retired} expansion\n`;
  assert.equal(scanText(historicalExpansion, path).forbidden.length, 1);

  const approvedLine = source.split('\n').find((line) => line.toLowerCase().includes(retired));
  const changed = source.replace(approvedLine, `${approvedLine} changed`);
  const changedReport = scanText(changed, path);
  assert.equal(changedReport.forbidden.length, 1);
  assert.ok(changedReport.historicalDrift.some((row) => row.actualCount === 0));

  const missing = source.replace(`${approvedLine}\n`, '');
  assert.ok(scanText(missing, path).historicalDrift.some((row) => row.actualCount === 0));
  const relocated = scanText(relocateFirstMatch(source), path);
  assert.equal(relocated.forbidden.length, 1);
  assert.ok(relocated.historicalDrift.some((row) => row.actualLines?.length === 1));


  const malformed = source.replace(/^## 7\.0\.0\b/m, '## 7.0.1');
  assert.ok(scanText(malformed, path).historicalDrift.some((row) => /7\.0\.0/.test(row.reason)));
});

test('scanPaths reports only files actually scanned and names every skip reason', () => {
  const root = mkdtempSync(join(tmpdir(), 'patina-retired-scan-'));
  try {
    mkdirSync(resolve(root, '.gjc'), { recursive: true });
    writeFileSync(resolve(root, 'clean.txt'), 'clean text\n');
    writeFileSync(resolve(root, 'binary.bin'), Buffer.from([0, 1, 2]));
    writeFileSync(resolve(root, '.gjc/archive.md'), 'archived text\n');
    const report = scanPaths(root, [
      '.gjc/archive.md',
      'binary.bin',
      'clean.txt',
      'missing.txt',
    ]);
    assert.equal(report.filesDiscovered, 4);
    assert.equal(report.filesScanned, 1);
    assert.deepEqual(report.filesSkipped, { archive: 1, missing: 1, binary: 1, total: 3 });
    assert.equal(report.allowedHits, 0);
    assert.equal(report.forbiddenHits, 0);
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