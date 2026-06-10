#!/usr/bin/env node
// Private-asset leak gate.
//
// patina ships as a public package: it must contain ZERO private assets
// (reinforced corpora, reinforced lexicon/patterns, service code, API keys).
// This gate enumerates what would actually be published for BOTH npm packages
// (`patina-cli` and `packages/patina-humanizer`) via `npm pack --dry-run
// --json`, plus every git-tracked file, and fails if any path matches a
// forbidden pattern.
//
// `npm pack` is run with `--dry-run --ignore-scripts` so wiring this gate into
// `prepublishOnly` cannot recurse back into the publish lifecycle.

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// Forbidden path patterns (glob: `*` = one segment, `**` = any depth).
// All of these are intentionally absent from the public repo; a match means a
// private asset slipped into the open package or git history.
export const FORBIDDEN_GLOBS = Object.freeze([
  '**/*.private.*', // explicitly private-marked files
  '**/*.enhanced.*', // explicitly enhancement-marked files
  '**/*.reinforced.*', // explicitly reinforced-marked files
  '**/private/**', // any `private/` directory (corpus, keys, raw sources)
  '**/enhanced/**', // any `enhanced/` directory (reinforced assets)
  '**/reinforced/**', // any `reinforced/` directory (reinforced assets)
  '**/corpus/**', // private corpus directories
  'server/**', // private service/server implementation
]);

/**
 * Compile a path glob into an anchored RegExp.
 *
 * @param {string} glob Glob with `*` (single segment) and `**` (any depth) wildcards.
 * @returns {RegExp} Anchored matcher for POSIX-style relative paths.
 * @example
 * globToRegExp('**\/*.private.*').test('src/foo.private.js'); // true
 */
export function globToRegExp(glob) {
  let re = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          re += '(?:.*/)?'; // `**/` matches zero or more leading directories
        } else {
          re += '.*'; // trailing `**` matches anything, including slashes
        }
      } else {
        re += '[^/]*'; // `*` matches within a single path segment
      }
    } else if ('.+?^${}()|[]\\'.includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`${re}$`);
}

const FORBIDDEN_MATCHERS = FORBIDDEN_GLOBS.map((glob) => ({ glob, re: globToRegExp(glob) }));

/**
 * Return every forbidden match for a set of paths.
 *
 * @param {Iterable<string>} paths Relative POSIX-style paths to test.
 * @returns {Array<{path: string, pattern: string}>} One entry per matched path/pattern.
 * @example
 * matchForbidden(['corpus/ko.jsonl']); // [{ path: 'corpus/ko.jsonl', pattern: '**\/corpus/**' }]
 */
export function matchForbidden(paths) {
  const hits = [];
  for (const path of paths) {
    const normalized = String(path).replace(/\\/g, '/').replace(/^\.\//, '');
    const matcher = FORBIDDEN_MATCHERS.find((m) => m.re.test(normalized));
    if (matcher) hits.push({ path: normalized, pattern: matcher.glob });
  }
  return hits;
}

/**
 * Run the gate over already-collected file lists.
 *
 * @param {object} sources File lists to scan.
 * @param {string[]} [sources.packedFiles=[]] Files that npm would publish (repo-relative).
 * @param {string[]} [sources.trackedFiles=[]] Git-tracked files.
 * @returns {{ok: boolean, violations: Array<{path: string, pattern: string, source: string}>, counts: {packed: number, tracked: number}}} Gate result.
 * @example
 * runGate({ packedFiles: ['src/index.js'], trackedFiles: ['src/index.js'] }).ok; // true
 */
export function runGate({ packedFiles = [], trackedFiles = [] } = {}) {
  const violations = [
    ...matchForbidden(packedFiles).map((hit) => ({ ...hit, source: 'package' })),
    ...matchForbidden(trackedFiles).map((hit) => ({ ...hit, source: 'git' })),
  ];
  return {
    ok: violations.length === 0,
    violations,
    counts: { packed: packedFiles.length, tracked: trackedFiles.length },
  };
}

/**
 * Enumerate files npm would publish for a package without running lifecycle scripts.
 *
 * @param {string} cwd Package directory containing a package.json.
 * @param {string} [prefix=''] Repo-relative prefix to prepend to each file path.
 * @returns {string[]} Repo-relative file paths.
 * @throws {Error} When `npm pack` fails or emits unparseable JSON.
 */
export function collectPackedFiles(cwd, prefix = '') {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) {
    throw new Error(`npm pack --dry-run failed in ${cwd}:\n${result.stderr || result.stdout}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (err) {
    throw new Error(`could not parse npm pack JSON from ${cwd}: ${err.message}`);
  }
  const entry = Array.isArray(parsed) ? parsed[0] : parsed;
  const files = Array.isArray(entry?.files) ? entry.files : [];
  return files.map((f) => `${prefix}${typeof f === 'string' ? f : f.path}`);
}

/**
 * Enumerate git-tracked files under the repo root.
 *
 * @returns {string[]} Repo-relative tracked file paths.
 * @throws {Error} When `git ls-files` fails.
 */
export function collectTrackedFiles() {
  const result = spawnSync('git', ['ls-files'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) {
    throw new Error(`git ls-files failed:\n${result.stderr}`);
  }
  return result.stdout.split('\n').filter(Boolean);
}

function main() {
  const packages = [
    { name: 'patina-cli', cwd: REPO_ROOT, prefix: '' },
    {
      name: 'patina-humanizer',
      cwd: resolve(REPO_ROOT, 'packages/patina-humanizer'),
      prefix: 'packages/patina-humanizer/',
    },
  ];

  const packedFiles = [];
  for (const pkg of packages) {
    const files = collectPackedFiles(pkg.cwd, pkg.prefix);
    console.log(`Enumerated ${files.length} file(s) for ${pkg.name} (npm pack --dry-run)`);
    packedFiles.push(...files);
  }

  const trackedFiles = collectTrackedFiles();
  console.log(`Enumerated ${trackedFiles.length} git-tracked file(s)`);

  const { ok, violations } = runGate({ packedFiles, trackedFiles });
  if (!ok) {
    console.error(`\nPrivate-asset leak gate FAILED — ${violations.length} forbidden path(s):`);
    for (const v of violations) {
      console.error(`  - [${v.source}] ${v.path}  (matched ${v.pattern})`);
    }
    console.error('\nForbidden patterns:');
    for (const glob of FORBIDDEN_GLOBS) console.error(`  - ${glob}`);
    process.exit(1);
  }

  console.log(`\nPrivate-asset leak gate OK — 0 forbidden paths across ${packedFiles.length} packed + ${trackedFiles.length} tracked file(s).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
