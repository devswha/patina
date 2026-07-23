#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const README_FILES = ['README.md', 'README_KR.md', 'README_ZH.md', 'README_JA.md'];
const README_CATALOGS = {
  'README.md': '**172 patterns** | 34 rewrite-capable + 9 score-only viral-hook per language (43 each across KO/EN/ZH/JA)',
  'README_KR.md': '**172개 패턴** | 언어별 재작성 가능 34개 + 스코어 전용 바이럴 훅 9개(KO/EN/ZH/JA 각각 43개)',
  'README_ZH.md': '**172 条模式** | 每种语言 34 条可改写模式 + 9 条仅评分的病毒式钩子模式（KO/EN/ZH/JA 各 43 条）',
  'README_JA.md': '**172 パターン** | 各言語 34 個の書き換え可能パターン + 9 個のスコア専用 viral-hook（KO/EN/ZH/JA 各 43 個）',
};

export function collectReleaseMetadataErrors({ repoRoot = REPO_ROOT, env = process.env } = {}) {
  const checks = [];
  const expect = (condition, message) => {
    if (!condition) checks.push(message);
  };
  const repoPath = (path) => resolve(repoRoot, path);
  const readJson = (path) => JSON.parse(readFileSync(repoPath(path), 'utf8'));
  const readVersionField = (path) => {
    const text = readFileSync(repoPath(path), 'utf8');
    const match = text.match(/^version:\s*["']?([^"'\n]+)["']?/m);
    return match?.[1]?.trim();
  };

  const pkg = readJson('package.json');
  const version = pkg.version;
  const lockfile = readJson('package-lock.json');

  expect(pkg.private === false, 'package.json private must be false');
  expect(pkg.bin?.patina === 'bin/patina.js', 'package.json bin.patina must point to bin/patina.js');
  expect(pkg.bin?.['patina-cli'] === 'bin/patina.js', 'package.json bin.patina-cli must point to bin/patina.js');
  expect(pkg.bin?.['patina-score'] === 'scripts/precommit-score.mjs', 'package.json bin.patina-score must point to scripts/precommit-score.mjs');
  expect(existsSync(repoPath('bin/patina.js')), 'bin/patina.js must exist');
  expect(lockfile.name === pkg.name, 'package-lock.json top-level name must match package.json');
  expect(lockfile.version === version, 'package-lock.json top-level version must match package.json');
  expect(lockfile.packages?.['']?.name === pkg.name, 'package-lock.json packages[""] name must match package.json');
  expect(lockfile.packages?.['']?.version === version, 'package-lock.json packages[""] version must match package.json');
  expect(readVersionField('SKILL.md') === version, 'SKILL.md version must match package.json');
  expect(readVersionField('.patina.default.yaml') === version, '.patina.default.yaml version must match package.json');

  for (const path of README_FILES) {
    const readme = readFileSync(repoPath(path), 'utf8');
    expect(readme.includes(`badge/version-${version}-blue`), `${path} version badge must match package.json`);
    expect(readme.includes(`version: "${version}"`), `${path} config example version must match package.json`);
    expect(readme.includes(README_CATALOGS[path]), `${path} catalog must match the canonical 172-pattern breakdown`);
  }

  expect(new RegExp(`^## ${escapeRegex(version)} — \\d{4}-\\d{2}-\\d{2}`, 'm').test(readFileSync(repoPath('CHANGELOG.md'), 'utf8')), 'CHANGELOG.md must contain a release heading for package.json version');
  const githubRef = env.GITHUB_REF;
  if (githubRef?.startsWith('refs/tags/')) {
    expect(githubRef === `refs/tags/v${version}`, `GITHUB_REF tag ${githubRef} must equal refs/tags/v${version}`);
  }

  const aliasPkg = readJson('packages/patina-humanizer/package.json');
  expect(aliasPkg.name === 'patina-humanizer', 'alias package name must be patina-humanizer');
  expect(aliasPkg.version === version, 'patina-humanizer version must match package.json');
  expect(aliasPkg.dependencies?.['patina-cli'] === version, 'patina-humanizer must depend on exact patina-cli version');
  expect(aliasPkg.bin?.['patina-humanizer'] === 'bin/patina-humanizer.js', 'patina-humanizer bin must point to bin/patina-humanizer.js');
  expect(existsSync(repoPath('packages/patina-humanizer/bin/patina-humanizer.js')), 'patina-humanizer bin file must exist');

  const pluginManifest = readJson('.claude-plugin/plugin.json');
  expect(pluginManifest.name === 'patina', '.claude-plugin/plugin.json name must be patina');
  expect(pluginManifest.version === version, '.claude-plugin/plugin.json version must match package.json');

  const marketplaceManifest = readJson('.claude-plugin/marketplace.json');
  const marketplacePlugin = marketplaceManifest.plugins?.find((entry) => entry.name === 'patina');
  expect(marketplacePlugin, '.claude-plugin/marketplace.json must list a patina plugin entry');
  expect(marketplacePlugin?.version === version, '.claude-plugin/marketplace.json patina plugin version must match package.json');

  return { errors: checks, version };
}

export function runReleaseMetadataCheck(options = {}) {
  const { stderr = process.stderr, stdout = process.stdout, ...collectorOptions } = options;
  const { errors, version } = collectReleaseMetadataErrors(collectorOptions);
  if (errors.length) {
    stderr.write(`${errors.map((message) => `- ${message}`).join('\n')}\n`);
    return 1;
  }
  stdout.write(`Release metadata OK for ${version}\n`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runReleaseMetadataCheck();
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
