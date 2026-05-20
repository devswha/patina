import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const SCRIPT = resolve(REPO_ROOT, 'scripts/qa/pattern-overlap.js');

test('pattern overlap audit has documented owners for review-threshold pairs', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);

  const { rows } = JSON.parse(result.stdout);
  const reviewRows = rows.filter((row) => row.review);
  assert.ok(reviewRows.length > 0, 'fixture corpus should exercise at least one review-threshold pair');

  for (const row of reviewRows) {
    assert.equal(row.status, 'documented', `${row.a} ↔ ${row.b} must be documented`);
    assert.match(row.owner, /^[a-z]{2}-[a-z-]+:\d+$/, `${row.a} ↔ ${row.b} must name a canonical owner`);
  }
});
