import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';

import { probeCliAvailability, resolveCliSpawnCommand, spawnOwnedCliProcess } from '../../src/backends/contract.js';

const WIN_ENV = { PATH: 'C:\\tools;C:\\other', PATHEXT: '.COM;.EXE;.BAT;.CMD' };

// A lookup table double for the exists() seam: exact path set membership.
const withFiles = (files) => (candidate) => files.has(candidate);

test('resolveCliSpawnCommand is a no-op off win32', () => {
  for (const platform of ['linux', 'darwin']) {
    assert.deepEqual(
      resolveCliSpawnCommand('gemini', { platform, env: WIN_ENV, exists: () => true }),
      { command: 'gemini', batch: false }
    );
  }
});

test('resolveCliSpawnCommand on win32 spawns a real executable bare', () => {
  const exists = withFiles(new Set([join('C:\\tools', 'claude.EXE')]));
  assert.deepEqual(
    resolveCliSpawnCommand('claude', { platform: 'win32', env: WIN_ENV, exists }),
    { command: join('C:\\tools', 'claude.EXE'), batch: false }
  );
});

test('resolveCliSpawnCommand on win32 gives batch shims a shell', () => {
  const exists = withFiles(new Set([join('C:\\tools', 'gemini.CMD')]));
  assert.deepEqual(
    resolveCliSpawnCommand('gemini', { platform: 'win32', env: WIN_ENV, exists }),
    { command: join('C:\\tools', 'gemini.CMD'), batch: true }
  );
});

test('resolveCliSpawnCommand respects PATH order before PATHEXT order', () => {
  // First PATH dir wins even when a later dir has an earlier-PATHEXT match.
  const pathOrder = withFiles(new Set([join('C:\\other', 'x.EXE'), join('C:\\tools', 'x.CMD')]));
  assert.deepEqual(
    resolveCliSpawnCommand('x', { platform: 'win32', env: { ...WIN_ENV, PATH: 'C:\\tools;C:\\other' }, exists: pathOrder }),
    { command: join('C:\\tools', 'x.CMD'), batch: true }
  );
  // Within one dir, PATHEXT order wins: .EXE before .CMD.
  const extOrder = withFiles(new Set([join('C:\\tools', 'x.EXE'), join('C:\\tools', 'x.CMD')]));
  assert.deepEqual(
    resolveCliSpawnCommand('x', { platform: 'win32', env: WIN_ENV, exists: extOrder }),
    { command: join('C:\\tools', 'x.EXE'), batch: false }
  );
});

test('resolveCliSpawnCommand keeps the bare name when nothing is found', () => {
  assert.deepEqual(
    resolveCliSpawnCommand('missing', { platform: 'win32', env: WIN_ENV, exists: () => false }),
    { command: 'missing', batch: false }
  );
});

test('probeCliAvailability spawns a .cmd shim with a shell and reports status', () => {
  const seen = [];
  const spawnSyncImpl = (command, args, options) => {
    seen.push({ command, args, options });
    return { status: 0 };
  };
  const exists = withFiles(new Set([join('C:\\tools', 'gemini.CMD')]));
  assert.equal(probeCliAvailability('gemini', { platform: 'win32', env: WIN_ENV, exists, spawnSyncImpl }), true);
  const quote = (v) => `"${v}"`;
  const line = [join('C:\\tools', 'gemini.CMD'), '--version'].map(quote).join(' ');
  assert.deepEqual(seen, [{
    command: 'cmd.exe',
    args: ['/d', '/s', '/c', `"${line}"`],
    options: { stdio: 'ignore', windowsVerbatimArguments: true },
  }]);

  const fail = probeCliAvailability('gemini', {
    platform: 'win32', env: WIN_ENV, exists,
    spawnSyncImpl: () => ({ status: 1 }),
  });
  assert.equal(fail, false);
  const boom = probeCliAvailability('gemini', {
    platform: 'win32', env: WIN_ENV, exists,
    spawnSyncImpl: () => { throw new Error('EINVAL'); },
  });
  assert.equal(boom, false);
});

test('spawnOwnedCliProcess passes shell:true through for a .cmd-only CLI on win32', () => {
  // Uses the real env/exists seams: a .cmd fixture in a real temp PATH dir,
  // with only the platform injected — so this runs on any host OS.
  const dir = mkdtempSync(join(tmpdir(), 'patina-cli-spawn-'));
  const oldPath = process.env.PATH;
  let seen = null;
  const child = new EventEmitter();
  try {
    // Uppercase extension: the lookup tries PATHEXT spellings verbatim and a
    // case-sensitive host FS only matches the exact name.
    writeFileSync(join(dir, 'probe-cli.CMD'), '@echo off\r\n');
    // win32 PATH entries are ';'-separated regardless of the host running
    // this test — the resolver under test splits on ';' by design.
    process.env.PATH = `${dir};${oldPath || ''}`;
    const spawnImpl = (command, args, options) => {
      seen = { command, args, options };
      return child;
    };
    spawnOwnedCliProcess('probe-cli', ['--version'], { stdio: 'ignore' }, { platform: 'win32', spawnImpl });
    assert.equal(seen.command, 'cmd.exe');
    assert.deepEqual(seen.args, ['/d', '/s', '/c', `"${[`"${join(dir, 'probe-cli.CMD')}"`, '"--version"'].join(' ')}"`]);
    assert.equal(seen.options.windowsVerbatimArguments, true);
  } finally {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('spawnOwnedCliProcess keeps the bare name for unknown CLIs on win32', () => {
  let seen = null;
  const child = new EventEmitter();
  const spawnImpl = (command, args, options) => {
    seen = { command, args, options };
    return child;
  };
  spawnOwnedCliProcess('definitely-not-a-real-cli-xyz', [], {}, { platform: 'win32', spawnImpl });
  assert.equal(seen.command, 'definitely-not-a-real-cli-xyz');
  assert.equal(seen.options.windowsVerbatimArguments, undefined);
});
