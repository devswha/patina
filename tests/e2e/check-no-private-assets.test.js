import { describe, it } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const GATE_SCRIPT = resolve(REPO_ROOT, 'scripts/check-no-private-assets.mjs');

function runGateScript() {
  return spawnSync(process.execPath, [GATE_SCRIPT], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

describe('leak gate (end to end): real npm pack + git enumeration', () => {
  it('passes on the clean public repo', { timeout: 120000 }, () => {
    const result = runGateScript();
    assert.strictEqual(result.status, 0, `gate should pass on a clean repo:\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /leak gate OK/);
  });

  it('fails when a private asset is planted inside a published directory', { timeout: 120000 }, () => {
    // `src/` is wholesale-included via package.json `files[]`, so npm pack will
    // enumerate this file even though it is never git-tracked.
    const planted = resolve(REPO_ROOT, 'src/__leak_probe__.private.js');
    writeFileSync(planted, '// planted leak-gate probe fixture; the test removes it.\n');
    try {
      const result = runGateScript();
      assert.strictEqual(result.status, 1, 'gate must fail when a private asset is packable');
      assert.match(result.stderr, /leak gate FAILED/);
      assert.match(result.stderr, /__leak_probe__\.private\.js/);
      assert.match(result.stderr, /\*\*\/\*\.private\.\*/);
    } finally {
      rmSync(planted, { force: true });
    }
    assert.ok(!existsSync(planted), 'planted fixture must be cleaned up');
  });
});
