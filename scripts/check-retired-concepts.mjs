#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RETIRED_TERM = ['ouro', 'boros'].join('');
const ARCHIVE_PREFIXES = ['.gjc/', '.insane-review/'];
export const LIFECYCLE_MARKER_PATH = 'docs/integrations/release.md';
export const REQUIRED_LIFECYCLE_ID = 'npm-token-publishing';
const LIFECYCLE_MARKER_PREFIX = '<!-- maintenance-lifecycle:';
const REQUIRED_LIFECYCLE_FIELDS = ['owner', 'review', 'remove-after'];
const HISTORICAL_EXPECTATIONS = new Map([
  ['CHANGELOG.md', new Map([
    ['a1aa4b471c432c2582586204d20566967533254171fbbd790a9da36a81412086', [404]],
    ['d82c21439e957bf40f694b896d8eadd49a433fb66af9cca49495111604b69d75', [406]],
    ['83f5e36d2ba73ed824cfec62e9f8fb72e569f26f3ab6c42604d1ef34f5b98e9b', [421]],
    ['0e80229112d7d40105c64406604dbcd0312d5ae370ec871fa3258bb787af7bd1', [427]],
    ['0bd7e2489f54e1e87a3efaae8e38df5c1a2878fa438c5f13775fc24b551440c7', [447]],
    ['aa223b28b35c246b21ff99d20281bfa980bf01820845308948311c81e98a0de9', [452]],
    ['12016238717b99f22a55d26b490943b50f82aef4a7ab27b6d662a1cdc5094dda', [501]],
    ['af36a82757b517832706c84fc3d2b7dc93915243d8ce7b6ee80d65ecfdb6f31c', [510]],
    ['51baf38ef6a43340c026a25e627e1544c70fc2c1dd99da3500ff2f11d8732e56', [515]],
    ['61ff8778bd3e54e59a01636618c1de3c7d42659eb513a6385e71e161ec944c87', [525]],
    ['272cba65bd46320ff28f5344fb3844c4b4ba08a95064db0009efd6bc145c2557', [573]],
    ['45be57ebe8b5ba976d59551aef7c201a4205c4f86c1cf7952f15d3697b48d664', [576]],
    ['226653d656455e6c74f4ae6216209470f05942ec9c0a275d1639a44d09bd0385', [869]],
  ])],
]);

function fingerprint(text) {
  return createHash('sha256').update(text).digest('hex');
}

function parseLifecycleMarker(line, lineNumber, path) {
  const trimmed = line.trim();
  if (!trimmed.startsWith(LIFECYCLE_MARKER_PREFIX)) return null;
  if (!trimmed.endsWith('-->')) {
    return {
      record: null,
      markerId: null,
      errors: [{ path, line: lineNumber, reason: 'lifecycle marker is not closed with -->' }],
    };
  }
  const body = trimmed
    .slice(LIFECYCLE_MARKER_PREFIX.length, -3)
    .trim();
  const parts = body.split(';').map((part) => part.trim());
  const id = parts[0] || null;
  const errors = [];
  if (!body) {
    errors.push({ path, line: lineNumber, reason: 'lifecycle marker is empty' });
  }
  if (parts.some((part) => !part)) {
    errors.push({ path, line: lineNumber, reason: 'lifecycle marker contains an empty segment' });
  }
  if (!id || !/^[a-z][a-z0-9-]*$/.test(id)) {
    errors.push({ path, line: lineNumber, reason: 'lifecycle marker id is malformed' });
  }
  const fields = {};
  const seen = new Set();
  for (const part of parts.slice(1)) {
    const match = /^([a-z][a-z0-9-]*)=(.*)$/.exec(part);
    if (!match) {
      errors.push({
        path,
        line: lineNumber,
        segment: part,
        reason: 'lifecycle marker field segment must be key=value',
      });
      continue;
    }
    const [, key, rawValue] = match;
    const value = rawValue.trim();
    if (seen.has(key)) {
      errors.push({
        path,
        line: lineNumber,
        field: key,
        reason: `lifecycle marker field ${key} is duplicated`,
      });
      continue;
    }
    seen.add(key);
    if (!REQUIRED_LIFECYCLE_FIELDS.includes(key)) {
      errors.push({
        path,
        line: lineNumber,
        field: key,
        reason: `lifecycle marker field ${key} is not recognized`,
      });
      continue;
    }
    if (!value) {
      errors.push({
        path,
        line: lineNumber,
        field: key,
        reason: `lifecycle marker field ${key} must not be empty`,
      });
      continue;
    }
    fields[key] = value;
  }
  if (errors.length) return { record: null, markerId: id, errors };
  return {
    record: {
      id: id || null,
      ...fields,
      path,
      line: lineNumber,
    },
    markerId: id,
    errors: [],
  };
}

function validCalendarDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return day <= daysInMonth;
}

// This pilot intentionally checks one known temporary publication branch. It
// validates that the owner, review date, and removal condition are recorded;
// it never compares the review date with the clock or removes the branch.
export function scanLifecycleText(source, path = LIFECYCLE_MARKER_PATH) {
  const records = [];
  const errors = [];
  if (typeof source !== 'string') {
    return {
      records,
      errors: [{ path, reason: 'required lifecycle file is unavailable' }],
    };
  }

  const lines = source.split('\n');
  for (let index = 0; index < lines.length; index++) {
    const parsed = parseLifecycleMarker(lines[index], index + 1, path);
    if (!parsed) continue;
    if (parsed.errors.length) errors.push(...parsed.errors);
    if (parsed.record?.id === REQUIRED_LIFECYCLE_ID) records.push(parsed.record);
    if (parsed.markerId === REQUIRED_LIFECYCLE_ID && parsed.errors.length) {
      records.push({ id: REQUIRED_LIFECYCLE_ID, path, line: index + 1, malformed: true });
    }
  }

  if (records.length === 0) {
    errors.push({
      path,
      reason: `required lifecycle marker ${REQUIRED_LIFECYCLE_ID} is missing`,
    });
    return { records, errors };
  }
  const validRecords = records.filter((record) => !record.malformed);
  if (validRecords.length > 1) {
    errors.push({
      path,
      reason: `expected exactly one lifecycle marker ${REQUIRED_LIFECYCLE_ID}`,
      lines: validRecords.map((record) => record.line),
    });
  }

  const record = validRecords[0];
  if (!record) return { records, errors };
  for (const field of REQUIRED_LIFECYCLE_FIELDS) {
    if (typeof record[field] !== 'string' || !record[field]) {
      errors.push({
        path,
        line: record.line,
        field,
        reason: `lifecycle marker ${REQUIRED_LIFECYCLE_ID} is missing ${field}`,
      });
    }
  }
  if (record.review && !validCalendarDate(record.review)) {
    errors.push({
      path,
      line: record.line,
      field: 'review',
      reason: 'lifecycle review must be a valid calendar date in YYYY-MM-DD',
    });
  }
  return { records: validRecords, errors };
}

export function scanLifecycleRecord(root, files = [], scannedSources) {
  const normalizedFiles = files.map((file) => String(file).replaceAll('\\', '/'));
  if (!normalizedFiles.includes(LIFECYCLE_MARKER_PATH)) {
    return {
      records: [],
      errors: [{ path: LIFECYCLE_MARKER_PATH, reason: 'required lifecycle file is not tracked' }],
    };
  }
  if (scannedSources instanceof Map) {
    // A map from scanPaths is authoritative: an absent entry means the
    // required file was skipped or could not be read, so never reread disk.
    if (!scannedSources.has(LIFECYCLE_MARKER_PATH)) {
      return scanLifecycleText(null, LIFECYCLE_MARKER_PATH);
    }
    return scanLifecycleText(scannedSources.get(LIFECYCLE_MARKER_PATH), LIFECYCLE_MARKER_PATH);
  }
  const absolute = resolve(root, LIFECYCLE_MARKER_PATH);
  if (!existsSync(absolute)) {
    return scanLifecycleText(null, LIFECYCLE_MARKER_PATH);
  }
  try {
    return scanLifecycleText(readFileSync(absolute, 'utf8'), LIFECYCLE_MARKER_PATH);
  } catch {
    return scanLifecycleText(null, LIFECYCLE_MARKER_PATH);
  }
}

export function changelogHistoricalBoundary(lines) {
  const releaseHeadings = lines
    .map((line, index) => (/^## \d+\.\d+\.\d+\b/.test(line) ? { line, index } : null))
    .filter(Boolean);
  const current = releaseHeadings.filter(({ line }) => /^## 7\.0\.0\b/.test(line));
  if (current.length !== 1) {
    return { start: Number.POSITIVE_INFINITY, error: 'expected exactly one 7.0.0 release heading' };
  }
  const next = releaseHeadings.find(({ index }) => index > current[0].index);
  if (!next) {
    return { start: Number.POSITIVE_INFINITY, error: 'expected an earlier release section after 7.0.0' };
  }
  return { start: next.index, error: null };
}

export function scanText(source, path) {
  const normalizedPath = String(path).replaceAll('\\', '/');
  const lines = String(source).split('\n');
  const expectations = HISTORICAL_EXPECTATIONS.get(normalizedPath);
  const boundary = normalizedPath === 'CHANGELOG.md'
    ? changelogHistoricalBoundary(lines)
    : { start: 0, error: null };
  const forbidden = [];
  const allowed = [];
  const historicalDrift = [];
  const historicalLines = new Map();

  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].toLowerCase().includes(RETIRED_TERM)) continue;
    const match = { path: normalizedPath, line: index + 1, text: lines[index].trim() };
    const hash = fingerprint(match.text);
    const inHistoricalRegion = expectations && !boundary.error && index >= boundary.start;
    if (!inHistoricalRegion) {
      forbidden.push(match);
      continue;
    }

    const actualLines = historicalLines.get(hash) ?? [];
    actualLines.push(match.line);
    historicalLines.set(hash, actualLines);
    const expectedLines = expectations.get(hash) ?? [];
    if (expectedLines.includes(match.line)) allowed.push(match);
    else forbidden.push(match);
  }

  if (boundary.error) {
    historicalDrift.push({ path: normalizedPath, reason: boundary.error });
  }
  if (expectations) {
    for (const [sha256, expectedLines] of expectations) {
      const actualLines = historicalLines.get(sha256) ?? [];
      if (
        actualLines.length !== expectedLines.length
        || actualLines.some((line, index) => line !== expectedLines[index])
      ) {
        historicalDrift.push({
          path: normalizedPath,
          sha256,
          expectedCount: expectedLines.length,
          actualCount: actualLines.length,
          expectedLines,
          actualLines,
          reason: 'approved historical occurrence is missing, changed, duplicated, or relocated',
        });
      }
    }
  }

  return { forbidden, allowed, historicalDrift };
}

export function scanPaths(root, inputPaths, { requireHistoricalFiles = false, requireLifecycleRecords = false } = {}) {
  const absoluteRoot = resolve(root);
  const files = [...new Set(inputPaths.map((path) => String(path).replaceAll('\\', '/')))].sort();
  const forbidden = [];
  const allowed = [];
  const historicalDrift = [];
  const scannedSources = new Map();
  const scannedPaths = new Set();
  const filesSkipped = { archive: 0, missing: 0, binary: 0 };

  for (const path of files) {
    if (ARCHIVE_PREFIXES.some((prefix) => path.startsWith(prefix))) {
      filesSkipped.archive += 1;
      continue;
    }
    const absolute = resolve(absoluteRoot, path);
    if (!existsSync(absolute)) {
      filesSkipped.missing += 1;
      continue;
    }
    const bytes = readFileSync(absolute);
    if (bytes.includes(0)) {
      filesSkipped.binary += 1;
      continue;
    }
    const result = scanText(bytes.toString('utf8'), path);
    scannedPaths.add(path);
    if (path === LIFECYCLE_MARKER_PATH) scannedSources.set(path, bytes.toString('utf8'));
    forbidden.push(...result.forbidden);
    allowed.push(...result.allowed);
    historicalDrift.push(...result.historicalDrift);
  }

  if (requireHistoricalFiles) {
    for (const path of HISTORICAL_EXPECTATIONS.keys()) {
      if (!files.includes(path)) {
        historicalDrift.push({ path, reason: 'approved historical file is not tracked' });
      } else if (!scannedPaths.has(path)) {
        historicalDrift.push({ path, reason: 'approved historical file was not scanned as UTF-8 text' });
      }
    }
  }

  const lifecycle = requireLifecycleRecords
    ? scanLifecycleRecord(absoluteRoot, files, scannedSources)
    : { records: [], errors: [] };
  const skippedTotal = Object.values(filesSkipped).reduce((sum, count) => sum + count, 0);
  return {
    root: absoluteRoot,
    filesDiscovered: files.length,
    filesScanned: scannedPaths.size,
    filesSkipped: { ...filesSkipped, total: skippedTotal },
    allowedHits: allowed.length,
    forbiddenHits: forbidden.length,
    historicalDriftCount: historicalDrift.length,
    lifecycleRecordCount: lifecycle.records.length,
    lifecycleDriftCount: lifecycle.errors.length,
    forbidden,
    allowed,
    historicalDrift,
    lifecycleDrift: lifecycle.errors,
  };
}

export function scanRoot(root) {
  return scanPaths(root, discoverTrackedFiles(resolve(root)), {
    requireHistoricalFiles: true,
    requireLifecycleRecords: true,
  });
}

function discoverTrackedFiles(root) {
  const tracked = spawnSync('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    encoding: 'utf8',
  });
  if (tracked.error || tracked.status !== 0) {
    const detail = tracked.error?.message || tracked.stderr?.trim() || `git exited ${tracked.status}`;
    throw new Error(`Unable to enumerate tracked content: ${detail}`);
  }
  return tracked.stdout.split('\0').filter(Boolean).sort();
}

function formatMatch(match) {
  return `${match.path}:${match.line}: ${match.text}`;
}

function main(argv) {
  const json = argv.includes('--json');
  const rootArg = argv.find((arg) => !arg.startsWith('-')) ?? process.cwd();
  const report = scanRoot(rootArg);
  if (json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `Discovered ${report.filesDiscovered} files; scanned ${report.filesScanned}; skipped ${report.filesSkipped.total} under ${report.root}\n`
    );
    process.stdout.write(
      `Allowed historical hits: ${report.allowedHits}; forbidden current hits: ${report.forbiddenHits}; historical drift: ${report.historicalDriftCount}; lifecycle drift: ${report.lifecycleDriftCount}\n`
    );
    for (const match of report.allowed) process.stdout.write(`allowed historical: ${formatMatch(match)}\n`);
    for (const match of report.forbidden) process.stderr.write(`forbidden current reference: ${formatMatch(match)}\n`);
    for (const drift of report.historicalDrift) {
      process.stderr.write(`historical allowlist drift: ${drift.path}: ${drift.reason}\n`);
    }
    for (const drift of report.lifecycleDrift) {
      process.stderr.write(`lifecycle record drift: ${drift.path}: ${drift.reason}\n`);
    }
  }
  return report.forbidden.length === 0
    && report.historicalDrift.length === 0
    && report.lifecycleDrift.length === 0
    ? 0
    : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
