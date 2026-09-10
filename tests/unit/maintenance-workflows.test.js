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
const DATASET_WORKFLOW_PATH = resolve(REPO_ROOT, '.github/workflows/publish-dataset.yml');

function readYaml(path) {
  return yaml.load(readFileSync(path, 'utf8'));
}

function readDatasetWorkflow() {
  return { workflow: readYaml(DATASET_WORKFLOW_PATH), source: readFileSync(DATASET_WORKFLOW_PATH, 'utf8') };
}

test('Dependabot keeps weekly ordinary updates bounded and unautomated', () => {
  const config = readYaml(DEPENDABOT_PATH);
  assert.equal(config.version, 2);
  assert.deepEqual(config.updates.map((update) => update['package-ecosystem']), ['npm', 'github-actions']);
  assert.equal(config.updates.length, 2);
  assert.equal(config.updates.reduce((total, update) => total + update['open-pull-requests-limit'], 0), 2);

  for (const update of config.updates) {
    assert.equal(update.directory, '/');
    assert.deepEqual(update.schedule, { interval: 'weekly' });
    assert.equal(update['open-pull-requests-limit'], 1);
    assert.equal(update['target-branch'], undefined);
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
});

test('dataset workflow holds publication, preserves production environment, and uses one immutable source', () => {
  const { workflow, source } = readDatasetWorkflow();
  const dispatch = workflow.on?.workflow_dispatch;
  const job = workflow.jobs?.dataset;
  const steps = job?.steps ?? [];
  const checkout = steps.find((step) => step.uses === 'actions/checkout@v6');
  const exportStep = steps.find((step) => step.name === 'Export hash-reviewed public fixtures');
  const sourceStep = steps.find((step) => step.name === 'Verify immutable export provenance');
  const upload = steps.find((step) => step.uses === 'actions/upload-artifact@v4');
  const publish = steps.find((step) => step.name === 'Publish reviewed main history');

  assert.equal(dispatch?.inputs?.publish?.type, 'boolean');
  assert.equal(dispatch?.inputs?.publish?.default, false);
  assert.equal(job?.environment, 'hf-dataset-production');
  assert.match(job?.if ?? '', /github\.repository == 'devswha\/patina'/);
  assert.match(job?.if ?? '', /github\.ref == 'refs\/heads\/main'/);
  assert.deepEqual(workflow.permissions, { contents: 'read' });

  assert.equal(checkout?.with?.ref, '${{ github.sha }}');
  assert.equal(checkout?.with?.['fetch-depth'], 0);
  assert.equal(exportStep?.run, 'node scripts/export-hf-dataset.mjs --output artifacts/hf-export');
  assert.equal(sourceStep?.id, 'source');
  assert.equal(sourceStep?.env?.DISPATCH_SHA, '${{ github.sha }}');
  assert.match(sourceStep?.run ?? '', /git rev-parse HEAD/);
  assert.match(sourceStep?.run ?? '', /source-manifest\.json/);
  assert.match(sourceStep?.run ?? '', /DISPATCH_SHA/);
  assert.match(sourceStep?.run ?? '', /GITHUB_OUTPUT/);

  assert.equal(upload?.with?.path, 'artifacts/hf-export');
  assert.equal(upload?.with?.['if-no-files-found'], 'error');
  assert.equal(publish?.if, 'inputs.publish == true');
  assert.equal(publish?.env?.SOURCE_COMMIT, '${{ steps.source.outputs.source_commit }}');
  assert.match(publish?.run ?? '', /git fetch origin main/);
  assert.match(publish?.run ?? '', /git merge-base --is-ancestor "\$SOURCE_COMMIT" origin\/main/);
  assert.match(publish?.run ?? '', /source-manifest\.json/);
  assert.match(publish?.run ?? '', /--directory artifacts\/hf-export/);

  assert.doesNotMatch(source, /ref:\s*main(?:\s|$)/);
  assert.doesNotMatch(source, /git\s+(?:switch|checkout)\b/);
});

test('dataset publication cannot be reached from a privileged pull-request checkout', () => {
  const { workflow, source } = readDatasetWorkflow();
  assert.equal(workflow.on?.pull_request, undefined);
  assert.equal(workflow.on?.pull_request_target, undefined);
  assert.equal(workflow.on?.push, undefined);
  assert.equal(workflow.on?.schedule, undefined);
  assert.doesNotMatch(source, /pull_request_target|github\.event\.pull_request\.head\.sha|refs\/pull\//);
  assert.doesNotMatch(source, /actions\/checkout@v6[\s\S]*ref:\s*main/);
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
