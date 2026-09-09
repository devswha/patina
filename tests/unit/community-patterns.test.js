import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { loadPatterns } from '../../src/loader.js';

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FILE = 'en-community-corporate-bizspeak.md';

// An on-disk installation from the retired manager, without importing that manager.
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'patina-community-retired-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const version = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).version;
  writeFileSync(join(root, 'package.json'), JSON.stringify({ type: 'module', version }));
  mkdirSync(join(root, 'patterns'));
  writeFileSync(join(root, 'patterns/en-base.md'), 'Built-in text');
  mkdirSync(join(root, 'custom/patterns'), { recursive: true });
  writeFileSync(join(root, 'custom/patterns/en-custom.md'), 'Hand-written text');
  const installed = join(root, 'custom/community-packs/en-corporate-bizspeak');
  mkdirSync(installed, { recursive: true });
  const files = {
    'pack.yaml': yaml.dump({
      name: 'en-corporate-bizspeak', version: '1.0.0', language: 'en',
      patterns: [FILE], compatibility: { min: version, maxExclusive: '999.0.0' },
      author: 'Test author', license: 'MIT',
    }),
    [FILE]: `---\npack: ${FILE.slice(0, -3)}\nlanguage: en\nversion: 1.0.0\npatterns: 1\n---\nLegacy pattern body`,
  };
  for (const [file, text] of Object.entries(files)) writeFileSync(join(installed, file), text);
  writeFileSync(join(installed, 'installed.json'), JSON.stringify({
    schemaVersion: 1, name: 'en-corporate-bizspeak',
    source: { owner: 'example', repo: 'packs', ref: 'main', directory: 'packs/en-corporate-bizspeak', commit: 'a'.repeat(40) },
    hashes: Object.fromEntries(Object.entries(files).map(([file, text]) => [file, createHash('sha256').update(text).digest('hex')])),
  }));
  return { root, installed };
}

// Include metadata to catch same-content rewrites; do not follow symlinks or
// include access times, since reading a file may legitimately update its atime.
function snapshot(path) {
  const stat = lstatSync(path);
  const metadata = { mode: stat.mode, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs };
  if (stat.isSymbolicLink()) return { ...metadata, target: readlinkSync(path) };
  if (stat.isDirectory()) return { ...metadata, entries: Object.fromEntries(readdirSync(path).sort().map((name) => [name, snapshot(join(path, name))])) };
  return { ...metadata, bytes: readFileSync(path).toString('base64') };
}

for (const state of ['valid', 'edited', 'malformed', 'symlinked']) {
  test(`loader ignores ${state} legacy community contents and leaves them intact`, (t) => {
    const { root, installed } = fixture(t);
    if (state === 'edited') writeFileSync(join(installed, FILE), 'User changes');
    if (state === 'malformed') writeFileSync(join(installed, 'installed.json'), '{invalid');
    if (state === 'symlinked') {
      rmSync(join(installed, FILE));
      symlinkSync(join(root, 'custom/patterns/en-custom.md'), join(installed, FILE));
    }
    const before = snapshot(root);
    const packs = loadPatterns(root, 'en');
    assert.deepEqual(packs.map(({ file, body }) => ({ file, body })), [
      { file: 'en-base.md', body: 'Built-in text' },
      { file: 'en-custom.md', body: 'Hand-written text' },
    ]);
    assert.deepEqual(loadPatterns(root, 'en', ['en-custom']).map((pack) => pack.file), ['en-base.md']);
    assert.deepEqual(snapshot(root), before);
  });
}

test('old pattern invocations reject without downloads, output or installation mutations', (t) => {
  const { root } = fixture(t);
  // Copy only runtime code so getRepoRoot() points at a disposable installation,
  // not the shared worktree. Dependencies stay real; no dispatcher/loader mocks.
  cpSync(join(REPO_ROOT, 'src'), join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'scripts'));
  cpSync(join(REPO_ROOT, 'scripts/prose-score.mjs'), join(root, 'scripts/prose-score.mjs'));
  symlinkSync(join(REPO_ROOT, 'node_modules'), join(root, 'node_modules'));
  writeFileSync(join(root, 'pattern'), 'A draft whose filename matches the retired command.');
  const invocations = [
    ['pattern'], ['pattern', 'help'], ['pattern', '--help'],
    ['pattern', 'list'], ['pattern', 'list', '--json'],
    ['pattern', 'install', 'en-corporate-bizspeak'],
    ['pattern', 'install', 'https://github.com/example/packs/tree/main/packs/en-corporate-bizspeak', '--json'],
    ['pattern', 'remove', 'en-corporate-bizspeak'],
    ['pattern', 'remove', 'en-corporate-bizspeak', '--json'],
    ['pattern', 'install', '--help'], ['pattern', 'list', '--help'], ['pattern', 'remove', '--help'],
  ];
  const before = snapshot(root);
  const child = spawnSync(process.execPath, ['--input-type=module', '--eval', `
    import { main } from './src/cli.js';
    import { PatinaCliError } from './src/errors.js';
    let fetches = 0;
    let outputs = 0;
    globalThis.fetch = () => { fetches++; throw new Error('unexpected fetch'); };
    console.log = () => { outputs++; };
    const results = [];
    for (const args of ${JSON.stringify(invocations)}) {
      try { await main(args); results.push({ rejected: false }); }
      catch (error) { results.push({ rejected: true, typed: error instanceof PatinaCliError, exitCode: error.exitCode }); }
    }
    process.stdout.write(JSON.stringify({ results, fetches, outputs }));
  `], {
    cwd: root, encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, HOME: root, PATH: '', NODE_OPTIONS: '' },
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stderr, '');
  assert.deepEqual(JSON.parse(child.stdout), {
    results: invocations.map(() => ({ rejected: true, typed: true, exitCode: 2 })),
    fetches: 0, outputs: 0,
  });
  assert.deepEqual(snapshot(root), before);
});
