#!/usr/bin/env node
// @ts-check
// Type-check only JavaScript files that explicitly opt in with the TypeScript check directive.

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const ROOTS = ['bin', 'scripts', 'src', 'tests'];
const EXT_RE = /\.(?:js|mjs)$/;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const path = resolve(dir, entry);
    const st = statSync(path);
    if (st.isDirectory()) walk(path, out);
    else if (EXT_RE.test(entry)) out.push(path);
  }
  return out;
}

const files = ROOTS
  .flatMap((dir) => walk(resolve(REPO_ROOT, dir)))
  .filter((file) => /^\s*\/\/\s*@ts-check/m.test(readFileSync(file, 'utf8')))
  .sort();

if (files.length === 0) {
  console.log('Typecheck skipped: no // @ts-check JavaScript files found');
  process.exit(0);
}

console.log(`Typechecking ${files.length} // @ts-check JavaScript file(s)`);

const result = spawnSync(
  resolve(REPO_ROOT, 'node_modules/.bin/tsc'),
  [
    '--noEmit',
    '--allowJs',
    '--checkJs',
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    '--target',
    'ES2022',
    '--lib',
    'ES2022,DOM',
    '--skipLibCheck',
    '--types',
    'node',
    ...files.map((file) => relative(REPO_ROOT, file)),
  ],
  { cwd: REPO_ROOT, encoding: 'utf8' }
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
process.exit(result.status ?? 1);
