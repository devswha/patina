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

// Agent instructions and runtime workspaces are development-only. They are
// checked separately from the baseline private-asset patterns so the public
// root AGENTS.md can remain tracked without making any development guidance
// publishable.
const DEVELOPMENT_ONLY_GLOBS = Object.freeze([
  '**/AGENTS.md',
  '**/CLAUDE.md',
  '**/BOOTSTRAP.md',
  '**/IDENTITY.md',
  '**/USER.md',
  '**/MEMORY.md',
  '**/HEARTBEAT.md',
  '**/SOUL.md',
  '**/TOOLS.md',
  '**/memory/**',
  '**/.omc/**',
  '**/.omx/**',
  '**/.omo/**',
  '**/.openclaw/**',
  '**/.workclaw/**',
  '**/.claude/**',
  '**/.insane-review/**',
  '**/.gjc/**',
]);

// Keep package and git checks explicit: the package may never contain
// development-only instructions, while git tracking allows exactly the
// approved public root rule below.
export const PACKED_FORBIDDEN_GLOBS = Object.freeze([...FORBIDDEN_GLOBS, ...DEVELOPMENT_ONLY_GLOBS]);
export const TRACKED_FORBIDDEN_GLOBS = Object.freeze([...FORBIDDEN_GLOBS, ...DEVELOPMENT_ONLY_GLOBS]);
export const TRACKED_ALLOWED_PATHS = Object.freeze(['AGENTS.md']);

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
const PACKED_MATCHERS = PACKED_FORBIDDEN_GLOBS.map((glob) => ({ glob, re: globToRegExp(glob) }));
const TRACKED_MATCHERS = TRACKED_FORBIDDEN_GLOBS.map((glob) => ({ glob, re: globToRegExp(glob) }));

function normalizePath(path) {
  return String(path).replace(/\\/g, '/').replace(/^\.\//, '');
}

function matchersFor(globs) {
  if (globs === FORBIDDEN_GLOBS) return FORBIDDEN_MATCHERS;
  if (globs === PACKED_FORBIDDEN_GLOBS) return PACKED_MATCHERS;
  if (globs === TRACKED_FORBIDDEN_GLOBS) return TRACKED_MATCHERS;
  return globs.map((glob) => ({ glob, re: globToRegExp(glob) }));
}

/**
 * Return every forbidden match for a set of paths.
 *
 * @param {Iterable<string>} paths Relative POSIX-style paths to test.
 * @param {Array<string>} [globs=FORBIDDEN_GLOBS] Glob patterns to apply.
 * @param {Iterable<string>} [allowedPaths=[]] Exact normalized paths to skip.
 * @returns {Array<{path: string, pattern: string}>} One entry per matched path/pattern.
 * @example
 * matchForbidden(['corpus/ko.jsonl']); // [{ path: 'corpus/ko.jsonl', pattern: '**\/corpus/**' }]
 */
export function matchForbidden(paths, globs = FORBIDDEN_GLOBS, allowedPaths = []) {
  const matchers = matchersFor(globs);
  const allowed = new Set([...allowedPaths].map(normalizePath));
  const hits = [];
  for (const path of paths) {
    const normalized = normalizePath(path);
    if (allowed.has(normalized)) continue;
    const matcher = matchers.find((m) => m.re.test(normalized));
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
 * The packed list rejects development-only instructions and runtime workspaces.
 * The tracked list allows only the approved public root `AGENTS.md` exception.
 * @returns {{ok: boolean, violations: Array<{path: string, pattern: string, source: string}>, counts: {packed: number, tracked: number}}} Gate result.
 * @example
 * runGate({ packedFiles: ['src/index.js'], trackedFiles: ['src/index.js'] }).ok; // true
 */
export function runGate({ packedFiles = [], trackedFiles = [] } = {}) {
  const violations = [
    ...matchForbidden(packedFiles, PACKED_FORBIDDEN_GLOBS).map((hit) => ({ ...hit, source: 'package' })),
    ...matchForbidden(trackedFiles, TRACKED_FORBIDDEN_GLOBS, TRACKED_ALLOWED_PATHS).map((hit) => ({ ...hit, source: 'git' })),
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
 * @param {{spawn?: typeof spawnSync}} [options] Test seam for process spawning.
 * @returns {string[]} Repo-relative file paths.
 * @throws {Error} When `npm pack` fails or emits unparseable JSON.
 */
export function collectPackedFiles(cwd, prefix = '', { spawn = spawnSync } = {}) {
  const result = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) {
    const code = result.error.code ? ` (${result.error.code})` : '';
    const hint =
      result.error.code === 'ENOENT'
        ? ' npm executable not found on PATH — mixed WSL/Windows environments must put Linux npm ahead of /mnt/c/... Windows npm.'
        : '';
    throw new Error(`npm pack --dry-run could not start in ${cwd}${code}.${hint}`, { cause: result.error });
  }
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
    for (const glob of PACKED_FORBIDDEN_GLOBS) console.error(`  - ${glob}`);
    process.exit(1);
  }

  console.log(`\nPrivate-asset leak gate OK — 0 forbidden paths across ${packedFiles.length} packed + ${trackedFiles.length} tracked file(s).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
