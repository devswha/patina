import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import {
  collectReleaseMetadataErrors,
  runReleaseMetadataCheck,
} from '../../scripts/check-release-metadata.mjs';

const VERSION = '6.3.1';
const README_FILES = ['README.md', 'README_KR.md', 'README_ZH.md', 'README_JA.md'];
const README_CATALOGS = {
  'README.md': '**184 patterns** | 37 rewrite-capable + 9 score-only viral-hook per language (46 each across KO/EN/ZH/JA)',
  'README_KR.md': '**184개 패턴** | 언어별 재작성 가능 37개 + 스코어 전용 바이럴 훅 9개(KO/EN/ZH/JA 각각 46개)',
  'README_ZH.md': '**184 条模式** | 每种语言 37 条可改写模式 + 9 条仅评分的病毒式钩子模式（KO/EN/ZH/JA 各 46 条）',
  'README_JA.md': '**184 パターン** | 各言語 37 個の書き換え可能パターン + 9 個のスコア専用 viral-hook（KO/EN/ZH/JA 各 46 個）',
};

function writeFixtureFile(root, path, content) {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'patina-release-metadata-'));
  const pkg = {
    name: 'patina-cli',
    version: VERSION,
    private: false,
    bin: {
      patina: 'bin/patina.js',
      'patina-cli': 'bin/patina.js',
      'patina-score': 'scripts/precommit-score.mjs',
    },
  };
  writeFixtureFile(root, 'package.json', JSON.stringify(pkg));
  writeFixtureFile(root, 'package-lock.json', JSON.stringify({
    name: pkg.name,
    version: pkg.version,
    packages: { '': { name: pkg.name, version: pkg.version } },
  }));
  writeFixtureFile(root, 'bin/patina.js', '');
  writeFixtureFile(root, 'SKILL.md', `version: ${VERSION}\n`);
  writeFixtureFile(root, '.patina.default.yaml', `version: ${VERSION}\n`);
  writeFixtureFile(root, 'CHANGELOG.md', `## ${VERSION} — 2026-07-15\n`);
  for (const path of README_FILES) {
    writeFixtureFile(root, path, `![Version](https://img.shields.io/badge/version-${VERSION}-blue)\nversion: "${VERSION}"\n${README_CATALOGS[path]}\n`);
  }
  writeFixtureFile(root, 'packages/patina-humanizer/package.json', JSON.stringify({
    name: 'patina-humanizer',
    version: VERSION,
    dependencies: { 'patina-cli': VERSION },
    bin: { 'patina-humanizer': 'bin/patina-humanizer.js' },
  }));
  writeFixtureFile(root, 'packages/patina-humanizer/bin/patina-humanizer.js', '');
  writeFixtureFile(root, '.claude-plugin/plugin.json', JSON.stringify({ name: 'patina', version: VERSION }));
  writeFixtureFile(root, '.claude-plugin/marketplace.json', JSON.stringify({
    plugins: [{ name: 'patina', version: VERSION }],
  }));
  return root;
}

function withFixture(callback) {
  const root = createFixture();
  try {
    callback(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function readJson(root, path) {
  return JSON.parse(readFileSync(join(root, path), 'utf8'));
}

test('collector passes the current repository', () => {
  const result = collectReleaseMetadataErrors();
  assert.deepEqual(result.errors, []);
  assert.equal(result.version, VERSION);
});

test('runner reports success without exiting the importing process', () => {
  let output = '';
  const exitCode = runReleaseMetadataCheck({
    stdout: { write: (text) => { output += text; } },
    stderr: { write: () => assert.fail('unexpected release-check error') },
  });
  assert.equal(exitCode, 0);
  assert.equal(output, `Release metadata OK for ${VERSION}\n`);
});

for (const { label, mutate, message } of [
  {
    label: 'lockfile top-level name',
    mutate: (root) => updateLockfile(root, (lockfile) => { lockfile.name = 'wrong-name'; }),
    message: 'package-lock.json top-level name must match package.json',
  },
  {
    label: 'lockfile top-level version',
    mutate: (root) => updateLockfile(root, (lockfile) => { lockfile.version = '0.0.0'; }),
    message: 'package-lock.json top-level version must match package.json',
  },
  {
    label: 'lockfile root package name',
    mutate: (root) => updateLockfile(root, (lockfile) => { lockfile.packages[''].name = 'wrong-name'; }),
    message: 'package-lock.json packages[""] name must match package.json',
  },
  {
    label: 'lockfile root package version',
    mutate: (root) => updateLockfile(root, (lockfile) => { lockfile.packages[''].version = '0.0.0'; }),
    message: 'package-lock.json packages[""] version must match package.json',
  },
]) {
  test(`collector rejects ${label} drift`, () => {
    withFixture((root) => {
      mutate(root);
      assert.deepEqual(collectReleaseMetadataErrors({ repoRoot: root }).errors, [message]);
    });
  });
}

for (const path of README_FILES) {
  test(`collector rejects ${path} badge drift`, () => {
    withFixture((root) => {
      writeFixtureFile(root, path, `![Version](https://img.shields.io/badge/version-0.0.0-blue)\nversion: "${VERSION}"\n${README_CATALOGS[path]}\n`);
      assert.deepEqual(collectReleaseMetadataErrors({ repoRoot: root }).errors, [`${path} version badge must match package.json`]);
    });
  });

  test(`collector rejects ${path} config example drift`, () => {
    withFixture((root) => {
      writeFixtureFile(root, path, `![Version](https://img.shields.io/badge/version-${VERSION}-blue)\nversion: "0.0.0"\n${README_CATALOGS[path]}\n`);
      assert.deepEqual(collectReleaseMetadataErrors({ repoRoot: root }).errors, [`${path} config example version must match package.json`]);
    });
  });
  test(`collector rejects ${path} catalog total drift`, () => {
    withFixture((root) => {
      updateReadme(root, path, (readme) => readme.replace('184', '168'));
      assert.deepEqual(collectReleaseMetadataErrors({ repoRoot: root }).errors, [`${path} catalog must match the canonical 184-pattern breakdown`]);
    });
  });

  test(`collector rejects ${path} catalog breakdown drift`, () => {
    withFixture((root) => {
      updateReadme(root, path, (readme) => readme.replace('37', '33'));
      assert.deepEqual(collectReleaseMetadataErrors({ repoRoot: root }).errors, [`${path} catalog must match the canonical 184-pattern breakdown`]);
    });
  });
}

test('collector rejects a mismatched release tag', () => {
  withFixture((root) => {
    const result = collectReleaseMetadataErrors({
      repoRoot: root,
      env: { GITHUB_REF: 'refs/tags/v0.0.0' },
    });
    assert.deepEqual(result.errors, ['GITHUB_REF tag refs/tags/v0.0.0 must equal refs/tags/v6.3.1']);
  });
});
test('collector accepts a matching release tag', () => {
  withFixture((root) => {
    const result = collectReleaseMetadataErrors({
      repoRoot: root,
      env: { GITHUB_REF: `refs/tags/v${VERSION}` },
    });
    assert.deepEqual(result.errors, []);
  });
});

function updateLockfile(root, mutate) {
  const path = 'package-lock.json';
  const lockfile = readJson(root, path);
  mutate(lockfile);
  writeFixtureFile(root, path, JSON.stringify(lockfile));
}
function updateReadme(root, path, mutate) {
  writeFixtureFile(root, path, mutate(readFileSync(join(root, path), 'utf8')));
}
