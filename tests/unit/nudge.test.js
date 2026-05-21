import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  FIRST_RUN_STAR_NUDGE,
  maybeShowFirstRunNudge,
  resolveNudgeStatePath,
  shouldShowFirstRunNudge,
} from '../../src/nudge.js';

function stderrStub({ isTTY = true } = {}) {
  const writes = [];
  return {
    stream: {
      isTTY,
      write: (text) => writes.push(text),
    },
    writes,
  };
}

function stdoutStub({ isTTY = true } = {}) {
  return { isTTY };
}

test('maybeShowFirstRunNudge writes one stderr line and honors the state marker', () => {
  const dir = mkdtempSync(join(tmpdir(), 'patina-nudge-'));
  try {
    const statePath = resolve(dir, 'state', 'patina', 'state.json');
    const { stream, writes } = stderrStub();
    const env = { HOME: dir };
    const parsed = { files: ['draft.md'], format: 'markdown' };
    const inputTexts = [{ path: 'draft.md', text: 'Hello.' }];

    assert.equal(maybeShowFirstRunNudge({ parsed, inputTexts, env, stderr: stream, stdout: stdoutStub(), stdinIsTTY: true, statePath }), true);
    assert.deepEqual(writes, [`${FIRST_RUN_STAR_NUDGE}\n`]);
    assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).firstRunStarNudgeShown, true);

    assert.equal(maybeShowFirstRunNudge({ parsed, inputTexts, env, stderr: stream, stdout: stdoutStub(), stdinIsTTY: true, statePath }), false);
    assert.equal(writes.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('first-run nudge suppresses CI, non-TTY, piped, batch, quiet, json, and opt-out runs', () => {
  const base = {
    parsed: { files: ['draft.md'], format: 'markdown' },
    inputTexts: [{ path: 'draft.md', text: 'Hello.' }],
    env: {},
    stderr: stderrStub().stream,
    stdout: stdoutStub(),
    stdinIsTTY: true,
    processObj: { exitCode: 0 },
  };

  assert.equal(shouldShowFirstRunNudge(base), true);
  assert.equal(shouldShowFirstRunNudge({ ...base, env: { CI: '1' } }), false);
  assert.equal(shouldShowFirstRunNudge({ ...base, env: { PATINA_NO_NUDGE: '1' } }), false);
  assert.equal(shouldShowFirstRunNudge({ ...base, stderr: stderrStub({ isTTY: false }).stream }), false);
  assert.equal(shouldShowFirstRunNudge({ ...base, stdout: stdoutStub({ isTTY: false }) }), false);
  assert.equal(shouldShowFirstRunNudge({ ...base, parsed: { files: [], format: 'markdown' }, inputTexts: [{ path: '-', text: 'Hello.' }], stdinIsTTY: false }), false);
  assert.equal(shouldShowFirstRunNudge({ ...base, parsed: { files: ['a.md'], format: 'markdown', batch: true } }), false);
  assert.equal(shouldShowFirstRunNudge({ ...base, parsed: { files: ['a.md'], format: 'markdown', quiet: true } }), false);
  assert.equal(shouldShowFirstRunNudge({ ...base, parsed: { files: ['a.md'], format: 'json' } }), false);
  assert.equal(shouldShowFirstRunNudge({ ...base, parsed: { files: ['a.md'], format: 'markdown', jsonLogs: true } }), false);
  assert.equal(shouldShowFirstRunNudge({ ...base, processObj: { exitCode: 3 } }), false);
});

test('resolveNudgeStatePath uses XDG state outside the working directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'patina-nudge-xdg-'));
  try {
    const path = resolveNudgeStatePath({ XDG_STATE_HOME: dir, HOME: process.cwd() });
    assert.equal(path, resolve(dir, 'patina', 'state.json'));
    assert.doesNotMatch(path, new RegExp(`^${process.cwd().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('maybeShowFirstRunNudge skips silently when the marker cannot be written', () => {
  const dir = mkdtempSync(join(tmpdir(), 'patina-nudge-blocked-'));
  try {
    const blocked = resolve(dir, 'blocked');
    writeFileSync(blocked, 'not a directory');
    const { stream, writes } = stderrStub();

    assert.equal(maybeShowFirstRunNudge({
      parsed: { files: ['draft.md'], format: 'markdown' },
      inputTexts: [{ path: 'draft.md', text: 'Hello.' }],
      env: { HOME: dir },
      stderr: stream,
      stdout: stdoutStub(),
      stdinIsTTY: true,
      statePath: resolve(blocked, 'state.json'),
    }), false);
    assert.deepEqual(writes, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('install.sh keeps the requested post-success star nudge and respects NO_COLOR', () => {
  const script = readFileSync('install.sh', 'utf8');
  assert.ok(script.includes('if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then'));
  assert.ok(script.includes('success "✓ patina installed."'));
  assert.ok(script.includes('info "  If it saves you edits, a star helps others find it → https://github.com/devswha/patina"'));
});
