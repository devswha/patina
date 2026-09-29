import { describe, it } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

function runGateScript(root = REPO_ROOT) {
  return spawnSync(process.execPath, [resolve(root, 'scripts/check-no-private-assets.mjs')], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.strictEqual(result.status, 0, result.stderr);
}

// Exercise the real allowlists and gate without planting files in a checkout
// that another test may be packaging concurrently.
function packageFixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'patina-leak-gate-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of ['src', 'scripts', 'packages/patina-humanizer/bin']) {
    mkdirSync(resolve(root, path), { recursive: true });
  }
  for (const path of ['package.json', 'packages/patina-humanizer/package.json', 'scripts/check-no-private-assets.mjs']) {
    copyFileSync(resolve(REPO_ROOT, path), resolve(root, path));
  }
  writeFileSync(resolve(root, 'SKILL.md'), '# Synthetic product fixture\n');
  writeFileSync(resolve(root, 'src/index.js'), 'export const fixture = true;\n');
  writeFileSync(resolve(root, 'packages/patina-humanizer/bin/patina-humanizer.js'), '#!/usr/bin/env node\n');
  git(root, ['init', '--quiet']);
  git(root, ['add', '--force', 'package.json', 'SKILL.md', 'src', 'scripts', 'packages']);
  return root;
}

describe('leak gate (end to end): real npm pack + git enumeration', () => {
  it('passes on the clean public repo', { timeout: 120000 }, () => {
    const result = runGateScript();
    assert.strictEqual(result.status, 0, `gate should pass on a clean repo:\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /leak gate OK/);
  });

  it('omits development instructions and credentials from the actual npm pack', { timeout: 120000 }, (t) => {
    const root = packageFixture(t);
    const filenames = ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.env.local', 'credentials.json', 'fixture.key', 'fixture.pem'];
    for (const filename of filenames) {
      writeFileSync(resolve(root, 'src', filename), 'synthetic private fixture\n', { flag: 'wx' });
    }
    const pack = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
      cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, shell: process.platform === 'win32',
    });
    assert.strictEqual(pack.status, 0, `npm pack should succeed:\n${pack.stdout}\n${pack.stderr}`);
    const packed = JSON.parse(pack.stdout)[0].files.map((file) => file.path);
    assert.ok(packed.includes('SKILL.md'), 'product SKILL.md must remain packaged');
    for (const filename of filenames) {
      assert.ok(!packed.includes(`src/${filename}`), `${filename} must stay out of the package`);
    }
    const gate = runGateScript(root);
    assert.strictEqual(gate.status, 0, `gate should pass when npm excludes the fixtures:\n${gate.stdout}\n${gate.stderr}`);

    git(root, ['add', '--force', 'src/GEMINI.md']);
    const tracked = runGateScript(root);
    assert.strictEqual(tracked.status, 1, 'git-tracked development rules must fail even when excluded from npm');
    assert.match(tracked.stderr, /\[git\] src\/GEMINI\.md/);
  });

  it('fails when a private asset is planted inside a published directory', { timeout: 120000 }, (t) => {
    const root = packageFixture(t);
    // `src/` is wholesale-included, so npm enumerates this untracked file.
    writeFileSync(resolve(root, 'src/__leak_probe__.private.js'), '// synthetic leak-gate probe\n', { flag: 'wx' });
    const result = runGateScript(root);
    assert.strictEqual(result.status, 1, 'gate must fail when a private asset is packable');
    assert.match(result.stderr, /leak gate FAILED/);
    assert.match(result.stderr, /__leak_probe__\.private\.js/);
    assert.match(result.stderr, /\*\*\/\*\.private\.\*/);
  });
});
