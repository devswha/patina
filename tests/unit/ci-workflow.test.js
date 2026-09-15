import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const WORKFLOW_PATH = resolve(REPO_ROOT, '.github/workflows/test.yml');

function loadWorkflow() {
  return yaml.load(readFileSync(WORKFLOW_PATH, 'utf8'));
}

function executableLines(job) {
  return job.steps
    .filter((step) => typeof step.run === 'string')
    .flatMap((step) => step.run.split('\n'))
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function assertExecutableLine(job, expected, label) {
  assert.ok(executableLines(job).includes(expected), `${label} must execute ${expected}`);
}

// These are YAML configuration contracts, not a simulation of hosted-runner cancellation.
test('CI workflow YAML configuration contracts: least privilege, bounds, and PR-only cancellation', () => {
  const workflow = loadWorkflow();
  const group = workflow.concurrency?.group;

  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(
    group,
    '${{ github.workflow }}-${{ github.event_name }}-${{ github.ref }}-${{ github.event.pull_request.number || github.run_id }}',
    'workflow concurrency group must isolate workflow, event, ref, PR, and non-PR run',
  );
  assert.equal(
    workflow.concurrency['cancel-in-progress'],
    '${{ github.event_name == \'pull_request\' }}',
    'only pull-request runs may cancel an in-progress run',
  );

  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    assert.equal(job['timeout-minutes'], 15, `${jobName} must have a 15-minute timeout`);
    assert.equal(job.permissions, undefined, `${jobName} must inherit read-only workflow permissions`);
  }

  const lintSetup = workflow.jobs.lint.steps.find((step) => step.uses === 'actions/setup-node@v6');
  assert.equal(lintSetup?.with?.['node-version'], 24, 'lint must run on the Node 24 CI host');
});

test('CI workflow YAML configuration contracts retain protected checks, matrix, and gates', () => {
  const workflow = loadWorkflow();
  const events = workflow.on;
  const jobs = workflow.jobs;

  assert.deepEqual(events.push.branches, ['main', 'dev']);
  assert.deepEqual(events.pull_request.branches, ['main', 'dev']);
  for (const [eventName, eventConfig] of Object.entries(events)) {
    if (!eventConfig || typeof eventConfig !== 'object') continue;
    assert.equal(eventConfig.paths, undefined, `${eventName} must not add path filters`);
    assert.equal(eventConfig['paths-ignore'], undefined, `${eventName} must not add path filters`);
  }
  assert.ok(Object.prototype.hasOwnProperty.call(events, 'workflow_dispatch'));
  assert.deepEqual(Object.keys(jobs).sort(), ['lint', 'quality', 'test']);
  assert.equal(jobs.lint.name, undefined, 'lint check identity must remain the job id');
  assert.equal(jobs.quality.name, undefined, 'quality check identity must remain the job id');

  const matrix = jobs.test.strategy.matrix['node-version'];
  assert.deepEqual(matrix, ['18.1.0', 20, 22, 'lts/*']);
  assert.equal(jobs.test.strategy['fail-fast'], false);
  assert.equal(jobs.test.name, undefined, 'protected matrix check names must remain undisguised');
  assert.deepEqual(
    ['lint', 'quality', ...matrix.map((version) => `test (${version})`)].sort(),
    ['lint', 'quality', 'test (18.1.0)', 'test (20)', 'test (22)', 'test (lts/*)'].sort(),
    'required branch-protection check names must remain present',
  );

  assertExecutableLine(jobs.lint, 'npm ci', 'lint');
  assertExecutableLine(jobs.lint, 'npm run lint', 'lint');
  assertExecutableLine(jobs.test, 'npm ci', 'test');
  assertExecutableLine(jobs.test, 'npm test', 'test');
  assertExecutableLine(jobs.test, 'npm run lint:syntax', 'Node 18.1.0 smoke test');
  assertExecutableLine(jobs.test, 'npm run benchmark', 'Node 18.1.0 smoke test');
  assertExecutableLine(jobs.test, 'node tests/quality/scorer-benchmark.mjs', 'Node 18.1.0 smoke test');

  assert.deepEqual(
    jobs.test.steps
      .filter((step) => step.if !== undefined)
      .map((step) => [step.name, step.if]),
    [
      ['Run tests', "matrix.node-version != '18.1.0'"],
      ['Run minimum Node smoke', "matrix.node-version == '18.1.0'"],
    ],
    'only the existing matrix branch conditions may guard steps',
  );

  for (const [jobName, job] of Object.entries(jobs)) {
    assert.equal(job.if, undefined, `${jobName} must not be conditionally skipped`);
    assert.equal(job['continue-on-error'], undefined, `${jobName} must not ignore failures`);
    for (const step of job.steps) {
      assert.equal(step['continue-on-error'], undefined, `${jobName}/${step.name ?? step.uses} must not ignore failures`);
      if (step.if === undefined) continue;
      assert.equal(jobName, 'test', `${jobName}/${step.name ?? step.uses} has an unsupported condition`);
      assert.ok(
        step.name === 'Run tests' || step.name === 'Run minimum Node smoke',
        `${jobName}/${step.name ?? step.uses} has an unsupported condition`,
      );
    }
  }

  for (const gate of [
    'npm ci',
    'npm run release:check',
    'npm run check:no-private-assets',
    'npm run lint:syntax',
    'npm run benchmark:report',
    'npm run benchmark:compare',
    'npm run dogfood',
  ]) {
    assertExecutableLine(jobs.quality, gate, 'quality');
  }

  const driftCheck = jobs.quality.steps.find((step) => step.name === 'Benchmark report drift check');
  assert.equal(driftCheck?.run?.trim(), [
    `git diff --exit-code -I '"generatedAt":' -I '"benchmarkGeneratedAt":' -I 'Generated at:' -I '"nodeVersion":' -I '^- Node: ' -- docs/benchmarks || {`,
    "  echo '::error::docs/benchmarks is stale. Run `npm run benchmark:report && npm run benchmark:compare` and commit the result.'",
    '  exit 1',
    '}',
  ].join('\n'), 'benchmark drift must retain its failing exit path');
});
