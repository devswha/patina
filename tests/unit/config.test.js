import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadConfig } from '../../src/config.js';

function tempWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'patina-config-'));
  const home = join(root, 'home');
  const project = join(root, 'project');
  mkdirSync(home);
  mkdirSync(project);
  return { root, home, project };
}

async function withEnv({ home, cwd }, fn) {
  const oldHome = process.env.HOME;
  const oldCwd = process.cwd();
  process.env.HOME = home;
  process.chdir(cwd);
  try {
    await fn();
  } finally {
    process.chdir(oldCwd);
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
  }
}

test('loadConfig: additive list keys union across default, global, and project config', async () => {
  const { root, home, project } = tempWorkspace();
  const defaultPath = join(root, 'default.yaml');
  writeFileSync(defaultPath, `
blocklist: [default-term, shared]
allowlist: [safe]
skip-patterns: [ko-filler]
max-models: [claude, gemini]
nested:
  blocklist: [nested-default]
`);
  writeFileSync(join(home, '.patina.yaml'), `
blocklist: [global-term, shared]
allowlist: [safe, global-safe]
skip-patterns: [ko-style]
max-models: [codex]
nested:
  blocklist: [nested-global]
`);
  writeFileSync(join(project, '.patina.yaml'), `
blocklist: [project-term]
allowlist: [project-safe]
skip-patterns: [ko-style, ko-content]
max-models: [gemini]
nested:
  blocklist: [nested-project]
`);

  await withEnv({ home, cwd: project }, async () => {
    const config = loadConfig(defaultPath);
    assert.deepEqual(config.blocklist, ['default-term', 'shared', 'global-term', 'project-term']);
    assert.deepEqual(config.allowlist, ['safe', 'global-safe', 'project-safe']);
    assert.deepEqual(config['skip-patterns'], ['ko-filler', 'ko-style', 'ko-content']);
    assert.deepEqual(config['max-models'], ['gemini']);
    assert.deepEqual(config.nested.blocklist, ['nested-default', 'nested-global', 'nested-project']);
  });
});

test('loadConfig: non-additive arrays replace so exact model/provider lists remain controllable', async () => {
  const { root, home, project } = tempWorkspace();
  const defaultPath = join(root, 'default.yaml');
  writeFileSync(defaultPath, 'patterns: [ko-content, ko-style]\nmax-models: [claude, gemini]\n');
  writeFileSync(join(home, '.patina.yaml'), 'patterns: [en-content]\nmax-models: [codex]\n');

  await withEnv({ home, cwd: project }, async () => {
    const config = loadConfig(defaultPath);
    assert.deepEqual(config.patterns, ['en-content']);
    assert.deepEqual(config['max-models'], ['codex']);
  });
});
