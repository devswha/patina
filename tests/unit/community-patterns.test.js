import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
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

test('loader ignores legacy community contents and leaves them intact', (t) => {
  const { root } = fixture(t);
  const before = snapshot(root);
  const packs = loadPatterns(root, 'en');
  assert.deepEqual(packs.map(({ file, body }) => ({ file, body })), [
    { file: 'en-base.md', body: 'Built-in text' },
    { file: 'en-custom.md', body: 'Hand-written text' },
  ]);
  assert.deepEqual(loadPatterns(root, 'en', ['en-custom']).map((pack) => pack.file), ['en-base.md']);
  assert.deepEqual(snapshot(root), before);
});
