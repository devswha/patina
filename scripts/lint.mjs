#!/usr/bin/env node
// No-dependency lint smoke for CI: syntax-check every committed JS/MJS file.

import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const ROOTS = ['bin', 'scripts', 'src', 'tests', 'playground', 'packages'];
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

const files = ROOTS.flatMap((dir) => walk(resolve(REPO_ROOT, dir))).sort();
let failed = false;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    failed = true;
    console.error(`node --check failed: ${relative(REPO_ROOT, file)}`);
    if (result.stdout) console.error(result.stdout.trim());
    if (result.stderr) console.error(result.stderr.trim());
  }
}

if (failed) process.exitCode = 1;
else console.log(`Syntax OK (${files.length} files)`);
