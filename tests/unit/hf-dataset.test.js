import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DATASET_FILES, exportDataset, sha256 } from '../../scripts/export-hf-dataset.mjs';
import { publishDataset, readDatasetBundle } from '../../scripts/publish-hf-dataset.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
function fixtureRepository() {
  const root = mkdtempSync(join(tmpdir(), 'patina-hf-test-'));
  for (const path of ['LICENSE', 'package.json', 'docs/research/hf-fixture-license-review.json']) {
    mkdirSync(dirname(join(root, path)), { recursive: true }); cpSync(join(ROOT, path), join(root, path));
  }
  cpSync(join(ROOT, 'tests/fixtures/suspect-zones'), join(root, 'tests/fixtures/suspect-zones'), { recursive: true });
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'core.hooksPath=/dev/null', '-c', 'maintenance.auto=false', '-c', 'gc.auto=0', '-c', 'commit.gpgsign=false', '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init'); git('add', '.'); git('commit', '-m', 'fixture'); git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  return { root, git, output: join(root, 'export') };
}

test('export preserves all 53 reviewed fixtures, labels, licensing and provenance deterministically', () => {
  const f = fixtureRepository();
  try {
    const first = exportDataset({ repoRoot: f.root, output: f.output });
    assert.equal(first.manifest.rowCount, 53);
    assert.deepEqual(Object.fromEntries(Object.entries(first.manifest.languages).map(([lang, value]) => [lang, value.total])), { en: 15, ko: 14, zh: 12, ja: 12 });
    const original = readFileSync(join(f.output, 'data/test.jsonl'), 'utf8');
    exportDataset({ repoRoot: f.root, output: f.output });
    assert.equal(readFileSync(join(f.output, 'data/test.jsonl'), 'utf8'), original);
    const rows = original.trim().split('\n').map(JSON.parse);
    assert.equal(new Set(rows.map((row) => row.id)).size, 53);
    for (const row of rows) { assert.equal(row.license, 'MIT'); assert.equal(sha256(row.text), row.text_sha256); }
    assert.match(readFileSync(join(f.output, 'README.md'), 'utf8'), /do not certify who wrote/);
  } finally { rmSync(f.root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 }); }
});

test('unreviewed and uncommitted fixture changes cannot be exported', () => {
  const f = fixtureRepository();
  try {
    const reviewPath = join(f.root, 'docs/research/hf-fixture-license-review.json');
    const review = JSON.parse(readFileSync(reviewPath, 'utf8')); const row = review.entries[0];
    writeFileSync(join(f.root, row.path), readFileSync(join(f.root, row.path), 'utf8') + '\nNew content.\n');
    assert.throws(() => exportDataset({ repoRoot: f.root, output: f.output }), /changed after license review/);
    row.sha256 = sha256(readFileSync(join(f.root, row.path))); writeFileSync(reviewPath, JSON.stringify(review));
    assert.throws(() => exportDataset({ repoRoot: f.root, output: f.output }), /Uncommitted fixture/);
  } finally { rmSync(f.root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 }); }
});

test('exports do not overwrite unmanaged or edited output files', () => {
  const f = fixtureRepository();
  try {
    mkdirSync(f.output); writeFileSync(join(f.output, 'README.md'), 'user content');
    assert.throws(() => exportDataset({ repoRoot: f.root, output: f.output }), /not owned/);
    rmSync(f.output, { recursive: true }); exportDataset({ repoRoot: f.root, output: f.output });
    writeFileSync(join(f.output, 'README.md'), 'user edits');
    assert.throws(() => exportDataset({ repoRoot: f.root, output: f.output }), /edited/);
  } finally { rmSync(f.root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 }); }
});

test('dangling output symlinks cannot create files outside the export', () => {
  const f = fixtureRepository();
  try {
    mkdirSync(f.output); const outside = join(f.root, 'unrelated.txt');
    symlinkSync(outside, join(f.output, 'README.md'));
    assert.throws(() => exportDataset({ repoRoot: f.root, output: f.output }), /symlink/);
    assert.equal(existsSync(outside), false);
  } finally { rmSync(f.root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 }); }
});

test('source version is read from the declared commit, not working-tree edits', () => {
  const f = fixtureRepository();
  try {
    const expected = JSON.parse(readFileSync(join(f.root, 'package.json'), 'utf8')).version;
    const pkg = JSON.parse(readFileSync(join(f.root, 'package.json'), 'utf8')); pkg.version = '99.99.99';
    writeFileSync(join(f.root, 'package.json'), JSON.stringify(pkg));
    const result = exportDataset({ repoRoot: f.root, output: f.output });
    assert.equal(result.manifest.sourceVersion, expected);
  } finally { rmSync(f.root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 }); }
});

test('bundle checks refuse tampering and path escapes; dry runs never use the network', async () => {
  const f = fixtureRepository();
  try {
    exportDataset({ repoRoot: f.root, output: f.output });
    const result = await publishDataset({ repoRoot: f.root, directory: f.output, repository: 'devswha/patina-suspect-zones', fetchImpl: () => assert.fail('dry-run network call') });
    assert.equal(result.dryRun, true); assert.deepEqual(result.files, DATASET_FILES);
    writeFileSync(join(f.output, 'data/test.jsonl'), 'private substitute');
    assert.throws(() => readDatasetBundle(f.output), /checksum/);
    rmSync(join(f.output, 'data/test.jsonl')); symlinkSync(join(f.root, 'LICENSE'), join(f.output, 'data/test.jsonl'));
    assert.throws(() => readDatasetBundle(f.output), /escaped/);
  } finally { rmSync(f.root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 }); }
});

test('publication validates owner, pins parent commit, and uploads only reviewed files', async () => {
  const f = fixtureRepository();
  try {
    exportDataset({ repoRoot: f.root, output: f.output });
    const old = '1'.repeat(40); const current = '2'.repeat(40); let created = false; let committed = false;
    const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
    const calls = [];
    const fetchImpl = async (url, options) => {
      calls.push({ url, options }); assert.ok(url.startsWith('https://huggingface.co/'));
      if (url.includes(`/resolve/${current}/`)) {
        assert.equal(options.headers.Authorization, undefined);
        const path = url.split(`/resolve/${current}/`)[1];
        return new Response(readFileSync(join(f.output, path)), { status: 200 });
      }
      if (url.endsWith('/api/whoami-v2')) return json({ name: 'devswha', orgs: [] });
      if (url.endsWith('/api/repos/create')) { created = true; assert.equal(JSON.parse(options.body).private, false); return json({}); }
      if (url.endsWith('/commit/main')) {
        const operations = options.body.trim().split('\n').map(JSON.parse);
        assert.equal(operations[0].value.parentCommit, old);
        assert.deepEqual(operations.slice(1).map((row) => row.value.path), DATASET_FILES);
        for (const operation of operations.slice(1)) assert.deepEqual(Buffer.from(operation.value.content, 'base64'), readFileSync(join(f.output, operation.value.path)));
        committed = true; return json({ commitOid: current });
      }
      return created ? json({ sha: committed ? current : old }) : json({}, 404);
    };
    const result = await publishDataset({ repoRoot: f.root, directory: f.output, repository: 'devswha/patina-suspect-zones', token: 'test-token', fetchImpl, dryRun: false });
    assert.equal(result.commit, current); assert.equal(result.rows, 53);
    assert.equal(calls.filter((call) => call.options.method === 'POST').length, 2);
    await assert.rejects(publishDataset({ repoRoot: f.root, directory: f.output, repository: 'someone-else/patina-suspect-zones', token: 'test-token', dryRun: false,
      fetchImpl: async () => json({ name: 'devswha', orgs: [] }) }), /namespace differs/);
  } finally { rmSync(f.root, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 }); }
});
