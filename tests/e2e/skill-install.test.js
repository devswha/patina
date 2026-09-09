import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const AGENTS = ['CLAUDE', 'CODEX', 'CURSOR', 'OPCODE'];
const CI_ARGS = 'ci --omit=dev --no-audit --no-fund';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 30_000, ...options });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr);
  return result;
}

function fixture(t, { node = true, npm = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'patina-skill-install-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const home = join(dir, 'home with spaces');
  const repo = join(dir, 'origin');
  const path = join(dir, 'path');
  for (const target of [home, repo, path]) mkdirSync(target);
  const checkout = join(home, '.claude/skills/patina');
  const env = {
    HOME: home, PATH: path, NO_COLOR: '1', LC_ALL: 'C',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(dir, 'gitconfig'),
    GIT_TERMINAL_PROMPT: '0', GIT_ALLOW_PROTOCOL: 'file',
    FIXTURE_NODE_LOG: join(dir, 'node.log'), FIXTURE_NPM_LOG: join(dir, 'npm.log'),
    FIXTURE_DEPS: join(ROOT, 'node_modules'), FIXTURE_REAL_NODE: process.execPath,
  };
  for (const name of ['git', 'awk', 'dirname', 'mkdir', 'ln', 'cp']) {
    const binary = run('/bin/sh', ['-c', `command -v ${name}`]).stdout.trim();
    symlinkSync(binary, join(path, name));
  }
  if (node) writeFileSync(join(path, 'node'), `#!/bin/sh
printf '%s\t%s\n' "$1" "\${2:-}" >> "$FIXTURE_NODE_LOG"
if [ "$1" = '-e' ] && [ -n "\${FIXTURE_NODE_VERSION:-}" ]; then
  exec "$FIXTURE_REAL_NODE" -e "Object.defineProperty(process.versions, 'node', {value: '$FIXTURE_NODE_VERSION'}); $2"
fi
exec "$FIXTURE_REAL_NODE" "$@"
`, { mode: 0o755 });
  if (npm) writeFileSync(join(path, 'npm'), `#!/bin/sh
printf '%s\t%s\n' "$PWD" "$*" >> "$FIXTURE_NPM_LOG"
if [ "\${FIXTURE_NPM_EXIT:-0}" != 0 ]; then
  printf 'fixture dependency install failed\n' >&2
  exit "$FIXTURE_NPM_EXIT"
fi
if [ "\${FIXTURE_NPM_NOOP:-0}" = 1 ]; then exit 0; fi
mkdir -p node_modules
cp -R "$FIXTURE_DEPS/js-yaml" "$FIXTURE_DEPS/argparse" node_modules/
`, { mode: 0o755 });
  // Exercise the shipped CLI, not a version-only fake. Git transport and
  // dependency preparation are local fixtures; npm calls remain observable.
  for (const name of ['bin', 'src', 'scripts', 'package.json', 'package-lock.json']) {
    cpSync(join(ROOT, name), join(repo, name), { recursive: true });
  }
  mkdirSync(join(repo, '.cursor/rules'), { recursive: true });
  writeFileSync(join(repo, '.cursor/rules/patina.md'), 'fixture rules\n');
  writeFileSync(join(repo, 'SKILL.md'), 'fixture skill\n');
  const git = (...args) => {
    const result = run(join(path, 'git'), args, { cwd: repo, env });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '-q');
  git('config', 'user.name', 'Installer Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('add', '.');
  git('commit', '-qm', 'fixture');
  git('config', '--global', `url.file://${repo}.insteadOf`, 'https://github.com/devswha/patina.git');
  const ref = git('rev-parse', 'HEAD');
  const install = (overrides = {}) => run('/bin/sh', [join(ROOT, 'install.sh')], {
    cwd: dir, env: { ...env, ...overrides },
  });
  const lines = (file) => existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n') : [];
  const npmCalls = () => lines(env.FIXTURE_NPM_LOG);
  const cliCalls = () => lines(env.FIXTURE_NODE_LOG).filter(line => line === `${checkout}/bin/patina.js\t--version`);
  const seed = () => git('clone', '-q', `file://${repo}`, checkout);
  const prepare = () => {
    mkdirSync(join(checkout, 'node_modules'), { recursive: true });
    for (const name of ['js-yaml', 'argparse']) cpSync(join(ROOT, 'node_modules', name), join(checkout, 'node_modules', name), { recursive: true });
  };
  return { home, repo, checkout, env, git, ref, install, npmCalls, cliCalls, seed, prepare };
}

function successful(f, result) {
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(existsSync(join(f.checkout, 'SKILL.md')));
  assert.ok(f.cliCalls().length > 0, 'readiness must start the installed CLI');
  const version = run(process.execPath, [join(f.checkout, 'bin/patina.js'), '--version'], { env: f.env });
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim().split(' ').at(-1), JSON.parse(readFileSync(join(f.checkout, 'package.json'))).version);
  assert.deepEqual(readFileSync(join(f.checkout, 'package-lock.json')), readFileSync(join(f.repo, 'package-lock.json')));
  assert.equal(f.git('-C', f.checkout, 'status', '--porcelain', '--untracked-files=no'), '');
}

test('missing Node fails even when npm can prepare dependencies', t => {
  const f = fixture(t, { node: false });
  const result = f.install();
  assert.ok(existsSync(join(f.checkout, 'SKILL.md')));
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(f.npmCalls(), []);
});

test('missing npm fails when the installed CLI cannot start', t => {
  const f = fixture(t, { npm: false });
  const result = f.install();
  assert.ok(existsSync(join(f.checkout, 'SKILL.md')));
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.equal(f.cliCalls().length, 1);
});

test('failed runtime dependency installation is a nonzero installer failure', t => {
  const f = fixture(t);
  const result = f.install({ FIXTURE_NPM_EXIT: '23' });
  assert.ok(existsSync(join(f.checkout, 'SKILL.md')));
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(f.npmCalls(), [`${f.checkout}\t${CI_ARGS}`]);
  assert.equal(f.cliCalls().length, 1);
});

test('successful npm exit without working dependencies is not runtime readiness', t => {
  const f = fixture(t);
  const result = f.install({ FIXTURE_NPM_NOOP: '1' });
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.equal(f.cliCalls().length, 2);
});

test('a js-yaml package marker cannot bypass actual CLI startup', t => {
  const f = fixture(t, { npm: false });
  f.seed();
  mkdirSync(join(f.checkout, 'node_modules/js-yaml'), { recursive: true });
  writeFileSync(join(f.checkout, 'node_modules/js-yaml/package.json'), '{}');
  const result = f.install();
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.equal(f.cliCalls().length, 1);
});

for (const version of ['16.20.2', '18.0.0', '18.0.99']) {
  test(`Node ${version} is below the supported runtime minimum`, t => {
    const f = fixture(t);
    const result = f.install({ FIXTURE_NODE_VERSION: version });
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(f.npmCalls(), []);
    assert.equal(f.cliCalls().length, 0);
  });
}

for (const version of ['18.1.0', '18.20.0', '20.0.0']) {
  test(`Node ${version} is admitted and the prepared CLI still must start`, t => {
    const f = fixture(t);
    successful(f, f.install({ FIXTURE_NODE_VERSION: version }));
    assert.deepEqual(f.npmCalls(), [`${f.checkout}\t${CI_ARGS}`]);
    assert.equal(f.cliCalls().length, 2);
  });
}

test('all-agent install shares one pinned checkout and one runtime preparation', t => {
  const f = fixture(t);
  successful(f, f.install());
  assert.equal(f.git('-C', f.checkout, 'rev-parse', 'HEAD'), f.ref);
  assert.deepEqual(f.npmCalls(), [`${f.checkout}\t${CI_ARGS}`]);
  assert.equal(f.cliCalls().length, 2);
  assert.equal(readlinkSync(join(f.home, '.codex/skills/patina')), f.checkout);
  assert.equal(readlinkSync(join(f.home, '.config/opencode/skills/patina')), f.checkout);
  assert.equal(readlinkSync(join(f.home, '.cursor/rules/patina.md')), join(f.checkout, '.cursor/rules/patina.md'));
});

for (const agent of AGENTS) {
  test(`${agent}-only installation does not require another enabled agent`, t => {
    const f = fixture(t);
    const flags = Object.fromEntries(AGENTS.map(name => [`INSTALL_${name}`, String(name === agent)]));
    successful(f, f.install({ ...flags, PATINA_REF: f.ref }));
    assert.deepEqual(f.npmCalls(), [`${f.checkout}\t${CI_ARGS}`]);
    assert.equal(existsSync(join(f.home, '.codex/skills/patina')), agent === 'CODEX');
    assert.equal(existsSync(join(f.home, '.cursor/rules/patina.md')), agent === 'CURSOR');
    assert.equal(existsSync(join(f.home, '.config/opencode/skills/patina')), agent === 'OPCODE');
  });
}

test('a working runtime needs neither npm nor a global CLI link, including updates', t => {
  const f = fixture(t, { npm: false });
  f.seed();
  f.prepare();
  successful(f, f.install({ PATINA_REF: f.ref }));
  const pkg = JSON.parse(readFileSync(join(f.repo, 'package.json')));
  pkg.version = '99.0.0';
  writeFileSync(join(f.repo, 'package.json'), JSON.stringify(pkg));
  f.git('add', 'package.json');
  f.git('commit', '-qm', 'update fixture');
  const next = f.git('rev-parse', 'HEAD');
  successful(f, f.install({ PATINA_REF: next }));
  assert.equal(f.git('-C', f.checkout, 'rev-parse', 'HEAD'), next);
  assert.deepEqual(f.npmCalls(), []);
  assert.equal(f.cliCalls().length, 2);
  assert.equal(readlinkSync(join(f.home, '.codex/skills/patina')), f.checkout);
});

test('an updated checkout with broken CLI code fails even after dependency preparation', t => {
  const f = fixture(t);
  successful(f, f.install());
  const cli = readFileSync(join(f.repo, 'src/cli.js'), 'utf8');
  writeFileSync(join(f.repo, 'src/cli.js'), `import './missing-runtime-module.js';\n${cli}`);
  f.git('add', 'src/cli.js');
  f.git('commit', '-qm', 'broken runtime fixture');
  const result = f.install({ PATINA_REF: f.git('rev-parse', 'HEAD') });
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.equal(f.cliCalls().length, 4);
  assert.deepEqual(f.npmCalls(), Array(2).fill(`${f.checkout}\t${CI_ARGS}`));
});

test('an invalid pinned ref fails without preparing a different runtime', t => {
  const f = fixture(t);
  const result = f.install({ PATINA_REF: 'nonexistent-fixture-ref' });
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(f.npmCalls(), []);
  assert.equal(f.cliCalls().length, 0);
});

test('an existing non-repository directory is not overwritten', t => {
  const f = fixture(t);
  mkdirSync(f.checkout, { recursive: true });
  writeFileSync(join(f.checkout, 'keep'), 'untouched');
  const result = f.install();
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(join(f.checkout, 'keep'), 'utf8'), 'untouched');
  assert.deepEqual(f.npmCalls(), []);
});

test('disabling every agent performs no checkout or runtime preparation', t => {
  const f = fixture(t, { node: false, npm: false });
  const flags = Object.fromEntries(AGENTS.map(name => [`INSTALL_${name}`, 'false']));
  const result = f.install(flags);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(existsSync(f.checkout), false);
  assert.deepEqual(f.npmCalls(), []);
  assert.equal(f.cliCalls().length, 0);
});
