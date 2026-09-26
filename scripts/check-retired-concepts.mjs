#!/usr/bin/env node
// Fails when a retired concept name appears in tracked text. Release notes
// older than 7.0.0 may still name it, since they describe what shipped then.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RETIRED_TERM = ['ouro', 'boros'].join('');
const ARCHIVE_PREFIXES = ['.gjc/', '.insane-review/'];

/** Index of the first release heading older than 7.0.0, or an error. */
export function changelogHistoricalBoundary(lines) {
  const headings = lines
    .map((line, index) => (/^## \d+\.\d+\.\d+\b/.test(line) ? { line, index } : null))
    .filter(Boolean);
  const current = headings.filter(({ line }) => /^## 7\.0\.0\b/.test(line));
  if (current.length !== 1) return { start: Infinity, error: 'expected exactly one 7.0.0 release heading' };
  const next = headings.find(({ index }) => index > current[0].index);
  if (!next) return { start: Infinity, error: 'expected an earlier release section after 7.0.0' };
  return { start: next.index, error: null };
}

export function scanText(source, path) {
  const lines = String(source).split('\n');
  const boundary = path === 'CHANGELOG.md' ? changelogHistoricalBoundary(lines) : { start: Infinity, error: null };
  const forbidden = [];
  const allowed = [];
  lines.forEach((line, index) => {
    if (!line.toLowerCase().includes(RETIRED_TERM)) return;
    const match = { path, line: index + 1, text: line.trim() };
    (index >= boundary.start ? allowed : forbidden).push(match);
  });
  return { forbidden, allowed, error: boundary.error };
}

export function scanPaths(root, paths) {
  const forbidden = [];
  const allowed = [];
  const errors = [];
  let scanned = 0;
  for (const path of paths) {
    if (ARCHIVE_PREFIXES.some((prefix) => path.startsWith(prefix))) continue;
    const absolute = resolve(root, path);
    if (!existsSync(absolute)) continue;
    const bytes = readFileSync(absolute);
    if (bytes.includes(0)) continue;
    const result = scanText(bytes.toString('utf8'), path);
    scanned += 1;
    forbidden.push(...result.forbidden);
    allowed.push(...result.allowed);
    if (result.error) errors.push({ path, reason: result.error });
  }
  return { scanned, forbidden, allowed, errors };
}

function trackedFiles(root) {
  const result = spawnSync('git', ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message || result.stderr?.trim() || `git exited ${result.status}`;
    throw new Error(`Unable to enumerate tracked content: ${detail}`);
  }
  return result.stdout.split('\0').filter(Boolean).sort();
}

export function scanRoot(root) {
  const absoluteRoot = resolve(root);
  return scanPaths(absoluteRoot, trackedFiles(absoluteRoot));
}

function main(argv) {
  const report = scanRoot(argv.find((arg) => !arg.startsWith('-')) ?? process.cwd());
  process.stdout.write(`Scanned ${report.scanned} files; historical hits: ${report.allowed.length}; forbidden: ${report.forbidden.length}\n`);
  for (const match of report.forbidden) {
    process.stderr.write(`forbidden reference: ${match.path}:${match.line}: ${match.text}\n`);
  }
  for (const error of report.errors) process.stderr.write(`${error.path}: ${error.reason}\n`);
  return report.forbidden.length === 0 && report.errors.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
