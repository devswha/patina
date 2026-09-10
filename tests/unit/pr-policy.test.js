import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  collectPrPolicyReport,
  fetchPullRequest,
  parsePrPolicyArgs,
  parsePrSections,
  PR_POLICY,
  runPrPolicyCheck,
} from '../../scripts/check-pr-policy.mjs';

const TEMPLATE = readFileSync(new URL('../../.github/PULL_REQUEST_TEMPLATE.md', import.meta.url), 'utf8');
const REQUIRED = parsePrSections(TEMPLATE);

function bodyWithSections(missing = []) {
  return REQUIRED
    .filter((section) => !missing.includes(section))
    .map((section) => `## ${section}\n\nfilled\n`)
    .join('\n');
}

function pr(overrides = {}) {
  const files = overrides.files ?? [{ path: 'src/change.js', status: 'modified', additions: 120, deletions: 100 }];
  const listedFiles = Array.isArray(files) ? files : files?.nodes ?? [];
  return {
    number: 42,
    body: bodyWithSections(),
    baseRefName: 'dev',
    headRefName: 'bot/policy',
    additions: listedFiles.reduce((sum, file) => sum + (file.additions ?? 0), 0),
    deletions: listedFiles.reduce((sum, file) => sum + (file.deletions ?? 0), 0),
    changedFiles: listedFiles.length,
    files,
    labels: [],
    ...overrides,
  };
}

function hasWarning(report, pattern) {
  return report.warnings.some((warning) => pattern.test(warning));
}

function hasError(report, pattern) {
  return report.errors.some((error) => pattern.test(error));
}

test('offline report counts raw and reviewable additions plus deletions', () => {
  const report = collectPrPolicyReport(pr());
  assert.equal(report.valid, true);
  assert.equal(report.classification, 'standard');
  assert.deepEqual(report.raw, { additions: 120, deletions: 100, lines: 220, files: 1 });
  assert.deepEqual(report.reviewable, { additions: 120, deletions: 100, lines: 220, files: 1 });
  assert.deepEqual(report.excludedFiles, []);
  assert.deepEqual(report.missingSections, []);
  assert.deepEqual(report.warnings, []);
});

test('approved generated provenance excludes generated code but never product markdown or fixtures', () => {
  const generated = {
    path: 'build/catalog.json',
    status: 'modified',
    additions: 300,
    deletions: 100,
    generated: true,
    generatorProvenance: { approved: true, generator: 'scripts/build-catalog.mjs', command: 'npm run build' },
  };
  const productMarkdown = {
    path: 'README.md',
    status: 'modified',
    additions: 50,
    deletions: 25,
    generated: true,
    generatorProvenance: { approved: true, generator: 'scripts/docs.mjs', command: 'npm run docs' },
  };
  const handwrittenFixture = {
    path: 'tests/fixtures/expected.json',
    status: 'modified',
    additions: 12,
    deletions: 8,
    generated: true,
    handwritten: true,
    generatorProvenance: { approved: true, generator: 'scripts/fixtures.mjs', command: 'npm run fixtures' },
  };
  const report = collectPrPolicyReport(pr({
    files: [generated, productMarkdown, handwrittenFixture],
    additions: 362,
    deletions: 133,
    changedFiles: 3,
  }));
  assert.equal(report.valid, true);
  assert.equal(report.raw.lines, 495);
  assert.equal(report.reviewable.lines, 95);
  assert.equal(report.reviewable.files, 2);
  assert.equal(report.docsOnly, false);
  assert.deepEqual(report.excludedFiles, ['build/catalog.json']);
  assert.equal(report.files[1].exclusionReason, 'protected-product-or-handwritten-file');
  assert.equal(report.files[2].exclusionReason, 'protected-product-or-handwritten-file');
});

test('explicit generator approval may accompany a generator identifier string', () => {
  const report = collectPrPolicyReport(pr({
    files: [{
      path: 'build/index.js',
      status: 'modified',
      additions: 20,
      deletions: 10,
      generated: true,
      generator: 'scripts/build.mjs',
      generatorApproved: true,
    }],
    additions: 20,
    deletions: 10,
  }));
  assert.equal(report.valid, true);
  assert.deepEqual(report.excludedFiles, ['build/index.js']);
  assert.equal(report.reviewable.lines, 0);
});

test('generated files without explicit approved provenance fail closed and remain reviewable', () => {
  const report = collectPrPolicyReport(pr({
    files: [{
      path: 'docs/generated.md',
      status: 'modified',
      additions: 20,
      deletions: 10,
      generated: true,
      generator: 'scripts/generate-docs.mjs',
    }],
    additions: 20,
    deletions: 10,
  }));
  assert.equal(report.valid, false);
  assert.equal(report.classification, 'inconclusive');
  assert.equal(report.status, 'inconclusive');
  assert.equal(report.docsOnly, false);
  assert.equal(report.reviewable.lines, 30);
  assert.equal(report.excludedFiles.length, 0);
  assert.ok(hasError(report, /approved generator provenance/));
});

test('approved generator provenance cannot hide incomplete file metadata', () => {
  const report = collectPrPolicyReport(pr({
    files: [{
      path: 'build/catalog.json',
      status: 'mystery',
      additions: 20,
      deletions: 10,
      generated: true,
      generatorProvenance: { approved: true, generator: 'scripts/build.mjs' },
    }],
    additions: 20,
    deletions: 10,
  }));
  assert.equal(report.valid, false);
  assert.equal(report.excludedFiles.length, 0);
  assert.equal(report.reviewable.lines, 30);
});

test('one invalid file disables every generated exclusion in an inconclusive report', () => {
  const report = collectPrPolicyReport(pr({
    files: [
      {
        path: 'build/catalog.json',
        status: 'modified',
        additions: 20,
        deletions: 10,
        generated: true,
        generatorProvenance: { approved: true, generator: 'scripts/build.mjs' },
      },
      { path: 'README.md', status: 'mystery', additions: 5, deletions: 0 },
    ],
    additions: 25,
    deletions: 10,
    changedFiles: 2,
  }));
  assert.equal(report.valid, false);
  assert.deepEqual(report.excludedFiles, []);
  assert.equal(report.reviewable.lines, 35);
});

test('missing file list uses known raw totals and changedFiles for conservative warning accounting', () => {
  const report = collectPrPolicyReport(pr({
    files: undefined,
    additions: 900,
    deletions: 150,
    changedFiles: 20,
  }));
  assert.equal(report.valid, false);
  assert.equal(report.status, 'inconclusive');
  assert.equal(report.fileMetadataComplete, false);
  assert.deepEqual(report.raw, { additions: 900, deletions: 150, lines: 1050, files: 20 });
  assert.deepEqual(report.reviewable, { additions: 900, deletions: 150, lines: 1050, files: 20 });
  assert.ok(hasWarning(report, /above the 200-400-line target/));
  assert.ok(hasWarning(report, /exceeds the 600-line review warning threshold/));
  assert.ok(hasWarning(report, /exceeds the 15-file review warning threshold/));
  assert.deepEqual(report.excludedFiles, []);
  assert.equal(report.docsOnly, false);
});

test('truncated file list does not undercount known raw totals', () => {
  const report = collectPrPolicyReport(pr({
    files: {
      nodes: [{ path: 'src/partial.js', status: 'modified', additions: 4, deletions: 2 }],
      pageInfo: { hasNextPage: true },
    },
    additions: 700,
    deletions: 100,
    changedFiles: 18,
  }));
  assert.equal(report.valid, false);
  assert.equal(report.status, 'inconclusive');
  assert.equal(report.reviewableLines, 800);
  assert.equal(report.reviewableFiles, 18);
  assert.ok(hasError(report, /another page/));
  assert.ok(hasWarning(report, /600-line review warning threshold/));
  assert.deepEqual(report.excludedFiles, []);
  assert.equal(report.docsOnly, false);
});

test('inconclusive file metadata retains the larger reported or listed file count', () => {
  const files = Array.from({ length: 16 }, (_, index) => ({
    path: `src/partial-${index}.js`,
    status: 'modified',
    additions: 10,
    deletions: 0,
  }));
  const report = collectPrPolicyReport(pr({
    files: {
      nodes: files,
      pageInfo: { hasNextPage: true },
    },
    additions: 160,
    deletions: 0,
    changedFiles: 15,
  }));
  assert.equal(report.valid, false);
  assert.equal(report.status, 'inconclusive');
  assert.equal(report.raw.files, 16);
  assert.equal(report.reviewableFiles, 16);
  assert.ok(hasWarning(report, /15-file review warning threshold \(16 files\)/));
  assert.equal(report.docsOnly, false);
});

test('incomplete file list with missing raw totals remains unknown rather than zero', () => {
  const report = collectPrPolicyReport(pr({
    files: undefined,
    additions: undefined,
    deletions: undefined,
    changedFiles: 20,
  }));
  assert.equal(report.valid, false);
  assert.equal(report.status, 'inconclusive');
  assert.equal(report.rawAdditions, null);
  assert.equal(report.rawDeletions, null);
  assert.equal(report.rawLines, null);
  assert.equal(report.reviewableAdditions, null);
  assert.equal(report.reviewableDeletions, null);
  assert.equal(report.reviewableLines, null);
  assert.equal(report.reviewableFiles, 20);
  assert.notEqual(report.reviewableLines, 0);
  assert.deepEqual(report.excludedFiles, []);
  assert.equal(report.docsOnly, false);
});

test('only a non-product documentation path is docs-only', () => {
  const report = collectPrPolicyReport(pr({
    files: [{ path: '.github/contributing.txt', status: 'modified', additions: 120, deletions: 100 }],
    additions: 120,
    deletions: 100,
  }));
  assert.equal(report.valid, true);
  assert.equal(report.docsOnly, true);
  assert.equal(report.classification, 'docs-only');
});

test('unknown file roles do not get a docs-only shortcut', () => {
  const report = collectPrPolicyReport(pr({
    files: [{ path: 'docs/generated.js', status: 'modified', additions: 120, deletions: 100 }],
    additions: 120,
    deletions: 100,
  }));
  assert.equal(report.valid, true);
  assert.equal(report.docsOnly, false);
  assert.equal(report.classification, 'standard');
});

for (const [label, mutate, expected] of [
  [
    'unknown status',
    (value) => ({ ...value, files: [{ path: 'README.md', status: 'mystery', additions: 10, deletions: 0 }], additions: 10, deletions: 0 }),
    /status is unknown/,
  ],
  [
    'rename status',
    (value) => ({ ...value, files: [{ path: 'README.md', status: 'renamed', additions: 10, deletions: 0 }], additions: 10, deletions: 0 }),
    /rename metadata is unsupported/,
  ],
  [
    'rename source path',
    (value) => ({ ...value, files: [{ path: 'README.md', previousFilename: 'README-old.md', status: 'modified', additions: 10, deletions: 0 }], additions: 10, deletions: 0 }),
    /rename metadata is unsupported/,
  ],
  [
    'unknown path',
    (value) => ({ ...value, files: [{ path: null, status: 'modified', additions: 10, deletions: 0 }], additions: 10, deletions: 0 }),
    /path metadata is missing or unsafe/,
  ],
  [
    'missing file metadata',
    (value) => ({ ...value, files: undefined, changedFiles: undefined }),
    /file metadata is missing or malformed/,
  ],
  [
    'paginated metadata',
    (value) => ({ ...value, pagination: { hasNextPage: true } }),
    /another page/,
  ],
  [
    'truncated metadata',
    (value) => ({ ...value, filesTruncated: true }),
    /truncated or incomplete/,
  ],
  [
    'unknown pagination metadata',
    (value) => ({ ...value, filesTruncated: 'sometimes' }),
    /metadata is unknown/,
  ],
]) {
  test(`invalid ${label} never becomes docs-only`, () => {
    const report = collectPrPolicyReport(mutate(pr({
      files: [{ path: 'docs/README.md', status: 'modified', additions: 10, deletions: 0 }],
      additions: 10,
      deletions: 0,
    })));
    assert.equal(report.valid, false);
    assert.equal(report.classification, 'inconclusive');
    assert.equal(report.status, 'inconclusive');
    assert.equal(report.docsOnly, false);
    assert.ok(hasError(report, expected));
  });
}

test('required sections come from the current PR template', () => {
  const missing = REQUIRED[0];
  const report = collectPrPolicyReport(pr({ body: bodyWithSections([missing]) }));
  assert.equal(report.valid, false);
  assert.equal(report.status, 'inconclusive');
  assert.deepEqual(report.requiredSections, REQUIRED);
  assert.deepEqual(report.missingSections, [missing]);
  assert.ok(hasError(report, new RegExp(`missing required section: ${missing}`)));
});

test('dev to main release aggregation is distinct and does not receive size warnings', () => {
  const files = Array.from({ length: 16 }, (_, index) => ({
    path: `src/change-${index}.js`,
    status: 'modified',
    additions: 50,
    deletions: 0,
  }));
  const report = collectPrPolicyReport(pr({
    baseRefName: 'main',
    headRefName: 'dev',
    files,
    additions: 800,
    deletions: 0,
    changedFiles: 16,
    labels: ['size-exception'],
  }));
  assert.equal(report.valid, true);
  assert.equal(report.releaseAggregation, true);
  assert.equal(report.classification, 'release-aggregation');
  assert.equal(report.reviewable.lines, 800);
  assert.deepEqual(report.warnings, []);
  assert.equal(report.sizeException.waived, false);
});

test('large reviewable changes warn on target, 600-line, and 15-file thresholds without auto waiver', () => {
  const files = Array.from({ length: 16 }, (_, index) => ({
    path: `src/change-${index}.js`,
    status: 'modified',
    additions: 40,
    deletions: 0,
  }));
  const report = collectPrPolicyReport(pr({
    files,
    additions: 640,
    deletions: 0,
    changedFiles: 16,
    labels: ['size-exception'],
  }));
  assert.equal(report.valid, true);
  assert.equal(report.warningMode, true);
  assert.equal(report.enforcement, 'warning');
  assert.equal(report.reviewable.lines, 640);
  assert.ok(hasWarning(report, /above the 200-400-line target/));
  assert.ok(hasWarning(report, /exceeds the 600-line review warning threshold/));
  assert.ok(hasWarning(report, /exceeds the 15-file review warning threshold/));
  assert.ok(hasWarning(report, /does not waive PR size warnings/));
  assert.equal(report.sizeException.waived, false);
});

test('live PR transport preserves multiple REST pages and rejects malformed pagination', () => {
  const first = { filename: 'src/first.js', status: 'added', additions: 2, deletions: 0 };
  const second = { filename: 'src/second.js', status: 'removed', additions: 0, deletions: 3 };
  const fetch = (pages) => fetchPullRequest({
    pr: 42,
    repo: 'devswha/patina',
    spawn: (_command, args) => ({
      status: 0,
      stdout: JSON.stringify(args[0] === 'pr'
        ? { ...pr(), additions: 2, deletions: 3, changedFiles: 2, files: undefined }
        : pages),
    }),
  });
  const fetched = fetch([[first], [second]]);
  assert.deepEqual(fetched.files, [first, second]);
  assert.equal(collectPrPolicyReport(fetched).valid, true);
  assert.throws(() => fetch({ files: [first] }), /non-array/);
  assert.throws(() => fetch([[first], second]), /mixed paginated/);
  assert.equal(collectPrPolicyReport(fetch([[first]])).valid, false);
});

test('CLI input stays offline and gh is used only for an explicit --pr request', () => {
  const fixture = pr();
  let output = '';
  assert.equal(runPrPolicyCheck({ pullRequest: fixture, json: true, stdout: { write: (text) => { output += text; } }, spawn: () => assert.fail('gh must not run for fixture input') }), 0);
  const parsed = JSON.parse(output);
  assert.equal(parsed.raw.lines, 220);

  let calls = 0;
  const fetched = fetchPullRequest({
    pr: 42,
    repoRoot: process.cwd(),
    repo: 'devswha/patina',
    spawn: (command, args) => {
      calls += 1;
      assert.equal(command, 'gh');
      if (calls === 1) {
        assert.deepEqual(args.slice(0, 3), ['pr', 'view', '42']);
        assert.deepEqual(args.slice(-2), ['--repo', 'devswha/patina']);
        const { files: _files, ...scalar } = fixture;
        return { status: 0, stdout: JSON.stringify(scalar), stderr: '' };
      }
      assert.deepEqual(args, [
        'api',
        'repos/devswha/patina/pulls/42/files?per_page=100',
        '--paginate',
        '--slurp',
      ]);
      return {
        status: 0,
        stdout: JSON.stringify([[{
          filename: 'src/change.js',
          status: 'modified',
          additions: 120,
          deletions: 100,
        }]]),
        stderr: '',
      };
    },
  });
  assert.deepEqual(fetched, {
    ...fixture,
    files: [{
      filename: 'src/change.js',
      status: 'modified',
      additions: 120,
      deletions: 100,
    }],
  });
  assert.equal(calls, 2);
});

test('PR parser rejects option-like and non-positive/non-integer identifiers', () => {
  for (const value of ['', '--web', '0', '-1', '1.5', 'abc', '9007199254740992']) {
    assert.throws(() => parsePrPolicyArgs([`--pr=${value}`]), /positive integer PR number/);
  }
  assert.throws(() => parsePrPolicyArgs(['--pr', '--web']), /positive integer PR number/);
});

test('exported PR fetch rejects invalid identifiers before spawning gh', () => {
  let spawned = false;
  for (const value of ['', '--web', '0', '-1', '1.5', 'abc', '9007199254740992']) {
    assert.throws(() => fetchPullRequest({
      pr: value,
      spawn: () => {
        spawned = true;
        return { status: 0, stdout: '{}', stderr: '' };
      },
    }), /positive integer PR number/);
  }
  assert.equal(spawned, false);
});

test('invalid offline metadata is inconclusive and exits non-zero without becoming a blocker policy', () => {
  let output = '';
  const exitCode = runPrPolicyCheck({
    pullRequest: pr({
      files: [{ path: 'docs/README.md', status: 'renamed', additions: 10, deletions: 0 }],
      additions: 10,
      deletions: 0,
    }),
    stdout: { write: (text) => { output += text; } },
  });
  assert.equal(exitCode, 1);
  assert.match(output, /inconclusive/);
  assert.doesNotMatch(output, /docs-only/);
});

test('CLI argument parser supports offline fixture and explicit PR modes', () => {
  assert.deepEqual(parsePrPolicyArgs(['--input', 'fixture.json', '--json']), {
    inputPath: 'fixture.json',
    json: true,
  });
  assert.deepEqual(parsePrPolicyArgs(['--pr=123', '--repo', 'devswha/patina']), {
    pr: '123',
    repo: 'devswha/patina',
  });
  assert.throws(() => parsePrPolicyArgs(['--pr', '123', '--input', 'fixture.json']), /cannot be used together/);
});

assert.equal(PR_POLICY.targetMinLines, 200);
assert.equal(PR_POLICY.targetMaxLines, 400);
