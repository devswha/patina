import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as nodeTest } from 'node:test';

// install.sh/uninstall.sh and every fixture shim are POSIX shell (/bin/sh,
// extensionless shebang PATH shims); QA.md declares the installer POSIX-only.
// None of it can run on win32, so every test in this file registers as
// skipped there — absent coverage, not a pass.
const test = process.platform === 'win32'
  ? (name, ..._rest) => nodeTest(name, { skip: 'POSIX-only installer fixtures (/bin/sh, shebang PATH shims)' }, () => {})
  : nodeTest;

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
  for (const name of ['git', 'awk', 'dirname', 'mkdir', 'ln', 'cp', 'mv', 'rm']) {
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
  cpSync(join(ROOT, '.cursor/rules/patina.mdc'), join(repo, '.cursor/rules/patina.mdc'));
  cpSync(join(ROOT, 'AGENTS.md'), join(repo, 'AGENTS.md'));
  cpSync(join(ROOT, 'SKILL.md'), join(repo, 'SKILL.md'));
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
  const uninstall = (overrides = {}) => run('/bin/sh', [join(ROOT, 'uninstall.sh')], {
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
  return { home, repo, checkout, env, git, ref, install, uninstall, npmCalls, cliCalls, seed, prepare };
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
  const cursorRule = join(f.home, '.cursor/rules/patina.mdc');
  assert.equal(lstatSync(cursorRule).isSymbolicLink(), false);
  const productAdapter = readFileSync(cursorRule, 'utf8');
  assert.match(productAdapter, /^---\ndescription: Apply Patina product instructions when humanizing text\.\nalwaysApply: false\n---\n/);
  assert.match(productAdapter, /<!-- patina-cursor-product-adapter -->/);
  assert.doesNotMatch(productAdapter, /AGENTS\.md/);
  const canonicalPath = productAdapter.match(/^- Canonical product instructions: "([^"]+)"$/m)?.[1];
  const skillDirectory = productAdapter.match(/^- Patina skill directory: "([^"]+)"$/m)?.[1];
  const helperPath = productAdapter.match(/^- CLI-first helper: `node "([^"]+)" --input/m)?.[1];
  assert.equal(canonicalPath, join(f.checkout, 'SKILL.md'));
  assert.equal(skillDirectory, f.checkout);
  assert.equal(helperPath, join(f.checkout, 'bin/patina-skill.js'));
  const canonicalSkill = readFileSync(canonicalPath, 'utf8');
  const body = text => text.replace(/^---\n[\s\S]*?\n---\n/, '');
  assert.ok(productAdapter.includes(`Canonical product instructions: "${join(f.checkout, 'SKILL.md')}"`));
  assert.ok(productAdapter.includes(`Patina skill directory: "${f.checkout}"`));
  assert.ok(productAdapter.includes(`CLI-first helper: \`node "${join(f.checkout, 'bin/patina-skill.js')}" --input <source-file> ...\``));
  assert.equal(existsSync(canonicalPath), true);
  assert.equal(existsSync(helperPath), true);
  assert.equal(productAdapter.endsWith(body(canonicalSkill)), true);
  assert.match(readFileSync(join(f.checkout, '.cursor/rules/patina.mdc'), 'utf8'), /@AGENTS\.md/);
});

test('Cursor install and uninstall use the product adapter from the actual checkout', t => {
  const f = fixture(t);
  const flags = Object.fromEntries(AGENTS.map(name => [`INSTALL_${name}`, String(name === 'CURSOR')]));
  successful(f, f.install({ ...flags, PATINA_REF: f.ref }));
  const cursorRule = join(f.home, '.cursor/rules/patina.mdc');
  assert.equal(lstatSync(cursorRule).isSymbolicLink(), false);
  assert.equal(readFileSync(join(f.checkout, 'SKILL.md'), 'utf8'), readFileSync(join(f.repo, 'SKILL.md'), 'utf8'));
  assert.equal(readFileSync(cursorRule, 'utf8').includes(readFileSync(join(f.checkout, 'AGENTS.md'), 'utf8')), false);
  const uninstall = f.uninstall({ UNINSTALL_CLAUDE: 'true', UNINSTALL_CODEX: 'false', UNINSTALL_OPCODE: 'false' });
  assert.equal(uninstall.status, 0, uninstall.stdout + uninstall.stderr);
  assert.equal(existsSync(cursorRule), false);
  assert.equal(existsSync(f.checkout), false);
});

for (const targetKind of ['file', 'directory']) {
  test(`Cursor installation preserves an unowned ${targetKind} target`, t => {
    const f = fixture(t);
    const target = join(f.home, '.cursor/rules/patina.mdc');
    mkdirSync(dirname(target), { recursive: true });
    if (targetKind === 'file') {
      writeFileSync(target, 'user-owned Cursor rule\n');
    } else {
      mkdirSync(target);
      writeFileSync(join(target, 'keep.txt'), 'user-owned directory\n');
    }
    const flags = Object.fromEntries(AGENTS.map(name => [`INSTALL_${name}`, String(name === 'CURSOR')]));
    const result = f.install({ ...flags, PATINA_REF: f.ref });
    assert.notEqual(result.status, 0, result.stdout + result.stderr);
    assert.match(`${result.stdout}\n${result.stderr}`, /Cursor target exists but was not installed by patina/);
    if (targetKind === 'file') {
      assert.equal(readFileSync(target, 'utf8'), 'user-owned Cursor rule\n');
    } else {
      assert.equal(readFileSync(join(target, 'keep.txt'), 'utf8'), 'user-owned directory\n');
    }
  });
}

test('Cursor installation updates an owned generated rule from the refreshed checkout', t => {
  const f = fixture(t, { npm: false });
  f.seed();
  f.prepare();
  const flags = Object.fromEntries(AGENTS.map(name => [`INSTALL_${name}`, String(name === 'CURSOR')]));
  successful(f, f.install({ ...flags, PATINA_REF: f.ref }));
  const target = join(f.home, '.cursor/rules/patina.mdc');
  const previous = readFileSync(target, 'utf8');
  const updatedSkill = `${readFileSync(join(f.repo, 'SKILL.md'), 'utf8')}\nUpdated checkout product instruction.\n`;
  writeFileSync(join(f.repo, 'SKILL.md'), updatedSkill);
  f.git('add', 'SKILL.md');
  f.git('commit', '-qm', 'update product skill fixture');
  const next = f.git('rev-parse', 'HEAD');
  successful(f, f.install({ ...flags, PATINA_REF: next }));
  const current = readFileSync(target, 'utf8');
  assert.notEqual(current, previous);
  assert.match(current, /Updated checkout product instruction/);
  assert.ok(current.includes(`Canonical product instructions: "${join(f.checkout, 'SKILL.md')}"`));
  assert.equal(f.git('-C', f.checkout, 'rev-parse', 'HEAD'), next);
});

test('uninstall preserves an unowned Cursor rule', t => {
  const f = fixture(t, { node: false, npm: false });
  const target = join(f.home, '.cursor/rules/patina.mdc');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, 'user-owned Cursor rule\n');
  const result = f.uninstall({ UNINSTALL_CLAUDE: 'false', UNINSTALL_CODEX: 'false', UNINSTALL_OPCODE: 'false' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(readFileSync(target, 'utf8'), 'user-owned Cursor rule\n');
});

for (const symlinkKind of ['live', 'dangling']) {
  test(`Cursor install and uninstall preserve an unowned ${symlinkKind} symlink`, t => {
    const f = fixture(t);
    const target = join(f.home, '.cursor/rules/patina.mdc');
    const linkTarget = join(f.home, symlinkKind === 'live' ? 'user-owned-rule.md' : 'missing-user-owned-rule.md');
    const targetBytes = 'user-owned Cursor rule through symlink\n';
    mkdirSync(dirname(target), { recursive: true });
    if (symlinkKind === 'live') writeFileSync(linkTarget, targetBytes);
    symlinkSync(linkTarget, target);
    const linkBefore = readlinkSync(target);

    const installFlags = Object.fromEntries(AGENTS.map(name => [`INSTALL_${name}`, String(name === 'CURSOR')]));
    const installed = f.install({ ...installFlags, PATINA_REF: f.ref });
    assert.notEqual(installed.status, 0, installed.stdout + installed.stderr);
    assert.match(`${installed.stdout}\n${installed.stderr}`, /Cursor target exists but was not installed by patina/);
    assert.equal(lstatSync(target).isSymbolicLink(), true);
    assert.equal(readlinkSync(target), linkBefore);
    if (symlinkKind === 'live') {
      assert.equal(readFileSync(linkTarget, 'utf8'), targetBytes);
    } else {
      assert.equal(existsSync(linkTarget), false);
    }

    const uninstalled = f.uninstall({ UNINSTALL_CLAUDE: 'false', UNINSTALL_CODEX: 'false', UNINSTALL_OPCODE: 'false' });
    assert.equal(uninstalled.status, 0, uninstalled.stdout + uninstalled.stderr);
    assert.equal(lstatSync(target).isSymbolicLink(), true);
    assert.equal(readlinkSync(target), linkBefore);
    if (symlinkKind === 'live') {
      assert.equal(readFileSync(linkTarget, 'utf8'), targetBytes);
    } else {
      assert.equal(existsSync(linkTarget), false);
    }
  });
}

test('Cursor installation fails when the checkout has no canonical SKILL.md', t => {
  const f = fixture(t);
  f.git('rm', 'SKILL.md');
  f.git('commit', '-qm', 'remove product skill fixture');
  const flags = Object.fromEntries(AGENTS.map(name => [`INSTALL_${name}`, String(name === 'CURSOR')]));
  const result = f.install({ ...flags, PATINA_REF: f.git('rev-parse', 'HEAD') });
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  assert.match(`${result.stdout}\n${result.stderr}`, /Cursor product instructions not found/);
  assert.equal(existsSync(join(f.checkout, 'SKILL.md')), false);
  assert.equal(existsSync(join(f.home, '.cursor/rules/patina.mdc')), false);
});

for (const agent of AGENTS) {
  test(`${agent}-only installation does not require another enabled agent`, t => {
    const f = fixture(t);
    const flags = Object.fromEntries(AGENTS.map(name => [`INSTALL_${name}`, String(name === agent)]));
    successful(f, f.install({ ...flags, PATINA_REF: f.ref }));
    assert.deepEqual(f.npmCalls(), [`${f.checkout}\t${CI_ARGS}`]);
    assert.equal(existsSync(join(f.home, '.codex/skills/patina')), agent === 'CODEX');
    assert.equal(existsSync(join(f.home, '.cursor/rules/patina.mdc')), agent === 'CURSOR');
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
