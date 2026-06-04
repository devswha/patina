import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('precommit score exits non-zero when a Markdown file exceeds the gate', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'patina-precommit-'));
  writeFileSync(
    resolve(dir, 'hot.md'),
    'This innovative solution is pivotal. This innovative solution is pivotal. This innovative solution is pivotal.'
  );
  const result = spawnSync(
    process.execPath,
    [resolve(REPO_ROOT, 'scripts/precommit-score.mjs'), '--score-threshold', '0', 'hot.md'],
    { cwd: dir, encoding: 'utf8' }
  );
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /hot\.md/);
  assert.match(result.stderr, /exceeded gate 0/);
});

test('precommit score rejects removed --gate alias', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'patina-precommit-'));
  writeFileSync(resolve(dir, 'hot.md'), 'This innovative solution is pivotal.');
  const result = spawnSync(
    process.execPath,
    [resolve(REPO_ROOT, 'scripts/precommit-score.mjs'), '--gate', '30', 'hot.md'],
    { cwd: dir, encoding: 'utf8' }
  );
  assert.equal(result.status, 2, result.stdout + result.stderr);
  assert.match(result.stderr, /unknown option --gate/);
});
