import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEPENDABOT_PATH = resolve(REPO_ROOT, '.github/dependabot.yml');

function readYaml(path) {
  return yaml.load(readFileSync(path, 'utf8'));
}

test('Dependabot routes weekly version updates through dev, bounded and unautomated', () => {
  const config = readYaml(DEPENDABOT_PATH);
  assert.equal(config.version, 2);
  assert.deepEqual(config.updates.map((update) => update['package-ecosystem']), ['npm', 'github-actions']);
  assert.equal(config.updates.length, 2);
  assert.equal(config.updates.reduce((total, update) => total + update['open-pull-requests-limit'], 0), 2);

  for (const update of config.updates) {
    assert.equal(update.directory, '/');
    assert.deepEqual(update.schedule, { interval: 'weekly' });
    assert.equal(update['open-pull-requests-limit'], 1);
    assert.equal(update['target-branch'], 'dev');
    assert.equal(update['rebase-strategy'], undefined);
  }

  const npm = config.updates.find((update) => update['package-ecosystem'] === 'npm');
  assert.deepEqual(npm.groups, {
    devtools: {
      'dependency-type': 'development',
      'update-types': ['patch', 'minor'],
    },
  });
  assert.equal(config.automerge, undefined);
  assert.doesNotMatch(readFileSync(DEPENDABOT_PATH, 'utf8'), /auto[- ]?(?:merge|approve)|security[^\n]*(?:delay|ignore)/i);

  // No dependency is held right now: the @eslint/js hold was lifted with the
  // eslint 10 core migration in this change. The shape rule stays so a future
  // hold cannot quietly suppress anything below a major bump — patch, minor,
  // and security updates must keep arriving.
  for (const rule of npm.ignore ?? []) {
    assert.deepEqual(rule['update-types'], ['version-update:semver-major']);
    assert.deepEqual(Object.keys(rule).sort(), ['dependency-name', 'update-types']);
    assert.equal(typeof rule['dependency-name'], 'string');
  }
  assert.deepEqual(npm.ignore ?? [], []);
  assert.equal(config.updates.find((update) => update['package-ecosystem'] === 'github-actions').ignore, undefined);
});

test('release shell binds dispatch versions and rejects missing or moved tags before writes', { skip: process.platform === 'win32' && 'runs the workflow steps through bash and POSIX PATH shims' }, () => {
  const workflow = readYaml(resolve(REPO_ROOT, '.github/workflows/release.yml'));
  const verify = workflow.jobs.npm.steps.find(step => step.name === 'Verify downloaded release tarballs');
  const publish = workflow.jobs.npm.steps.find(step => step.name === 'Publish verified release tarballs with recovery');
  assert.equal(verify.env.RELEASE_VERSION, '${{ needs.verify.outputs.version }}');
  assert.equal(publish.env.RELEASE_VERSION, verify.env.RELEASE_VERSION);
  assert.equal(workflow.jobs.verify.outputs.version, '${{ steps.artifacts.outputs.version }}');
  const release = workflow.jobs['github-release'].steps.find(step => step.name === 'Create or update GitHub release without stale latest promotion');
  const directory = mkdtempSync(join(tmpdir(), 'patina-release-workflow-'));
  const log = join(directory, 'calls.jsonl');
  const executable = name => join(directory, name);
  const run = (script, extra = {}) => {
    writeFileSync(log, '');
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
      cwd: REPO_ROOT, encoding: 'utf8', timeout: 15000,
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, MOCK_LOG: log,
        GITHUB_REF: 'refs/tags/v8.6.0', GITHUB_REF_NAME: 'v8.6.0', GITHUB_SHA: 'a'.repeat(40),
        GITHUB_REPOSITORY: 'fixture/patina', RELEASE_VERSION: '8.6.0', ...extra },
    });
    assert.ifError(result.error);
    const calls = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    return { result, calls };
  };
  try {
    writeFileSync(executable('node'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'scripts/release-artifacts.mjs') {
  fs.appendFileSync(process.env.MOCK_LOG, JSON.stringify(args) + '\\n');
} else {
  const result = require('node:child_process').spawnSync(${JSON.stringify(process.execPath)}, args, { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
`, { mode: 0o755 });
    writeFileSync(executable('gh'), `#!${process.execPath}
const fs = require('node:fs'); const args = process.argv.slice(2);
fs.appendFileSync(process.env.MOCK_LOG, JSON.stringify(args) + '\\n');
if (args[0] !== 'api') process.exit(0);
const latest = args.at(-1).endsWith('/latest');
const status = latest || process.env.EXISTING === '1' ? 200 : 404;
process.stdout.write('HTTP/2.0 ' + status + ' Test\\r\\n\\r\\n' + JSON.stringify({tag_name:'v8.5.0'}));
process.exit(status === 404 ? 1 : 0);
`, { mode: 0o755 });
    writeFileSync(executable('git'), `#!${process.execPath}
const fs = require('node:fs'); const args = process.argv.slice(2);
fs.appendFileSync(process.env.MOCK_LOG, JSON.stringify(['git', ...args]) + '\\n');
if (args[0] === 'fetch') process.exit(process.env.TAG_STATE === 'missing' ? 1 : 0);
if (args[0] === 'rev-parse') process.stdout.write((process.env.TAG_STATE === 'moved' ? 'b'.repeat(40) : process.env.GITHUB_SHA) + '\\n');
`, { mode: 0o755 });

    const dispatch = run(verify.run, { GITHUB_REF: 'refs/heads/main', GITHUB_REF_NAME: 'main' });
    assert.equal(dispatch.result.status, 0, dispatch.result.stderr);
    assert.equal(dispatch.calls[0].at(-1), '8.6.0');
    const mismatch = run(verify.run, { GITHUB_REF_NAME: 'v8.5.0' });
    assert.notEqual(mismatch.result.status, 0);
    assert.equal(mismatch.calls.length, 0);

    for (const existing of ['0', '1']) {
      for (const tagState of ['matching', 'moved', 'missing']) {
        const { result, calls } = run(release.run, { EXISTING: existing, TAG_STATE: tagState });
        const writes = calls.filter(args => args[0] === 'release');
        if (tagState === 'matching') {
          assert.equal(result.status, 0, result.stderr);
          assert.equal(writes.length, 1);
          assert.equal(writes[0][1], existing === '1' ? 'edit' : 'create');
          if (existing === '0') assert.ok(writes[0].includes('--verify-tag'));
          assert.ok(calls.some(args => args[0] === 'git' && args[2] === 'refs/patina/release-check^{commit}'));
        } else {
          assert.notEqual(result.status, 0, tagState);
          assert.equal(writes.length, 0, tagState);
        }
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
