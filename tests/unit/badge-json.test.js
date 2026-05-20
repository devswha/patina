import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  badgeBand,
  buildBadge,
  formatBadgeScore,
  parseArgs,
  toShieldsEndpoint,
} from '../../scripts/badge-json.mjs';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

test('badgeBand maps max score to Shields colors', () => {
  assert.deepEqual(badgeBand(30), { text: 'human-ish', color: 'brightgreen' });
  assert.deepEqual(badgeBand(31), { text: 'mixed', color: 'yellow' });
  assert.deepEqual(badgeBand(50), { text: 'mixed', color: 'yellow' });
  assert.deepEqual(badgeBand(51), { text: 'ai-like', color: 'red' });
});

test('toShieldsEndpoint formats a valid Shields endpoint payload', () => {
  assert.deepEqual(toShieldsEndpoint({ maxScore: 18.4 }), {
    schemaVersion: 1,
    label: 'patina',
    message: '18% · human-ish',
    color: 'brightgreen',
  });
  assert.equal(formatBadgeScore(18.6), '19%');
});

test('parseArgs defaults to README and validates numeric options', () => {
  assert.deepEqual(parseArgs([]).files, ['README.md']);
  assert.throws(() => parseArgs(['--gate', '101']), /--gate expects/);
  assert.throws(() => parseArgs(['--max-files', '0']), /--max-files expects/);
});

test('buildBadge derives its number from scoreFiles summary maxScore', () => {
  const dir = mkdtempSync(resolve(tmpdir(), 'patina-badge-'));
  writeFileSync(resolve(dir, 'clean.md'), 'Plain note. One sentence with no packaged language.');
  writeFileSync(resolve(dir, 'hot.md'), 'This innovative solution is pivotal. This innovative solution is pivotal.');

  const badge = buildBadge(['clean.md', 'hot.md'], { cwd: dir, gate: 30 });
  assert.equal(badge.schemaVersion, 1);
  assert.equal(badge.label, 'patina');
  assert.match(badge.message, /^\d+% · /);
  assert.equal(badge.color, 'red');
});

test('CLI prints parseable Shields JSON', () => {
  const result = spawnSync(process.execPath, ['scripts/badge-json.mjs', 'README.md'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.label, 'patina');
  assert.match(payload.message, /^\d+% · (human-ish|mixed|ai-like)$/);
  assert.match(payload.color, /^(brightgreen|yellow|red)$/);
});
