#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const pkg = readJson('package.json');
const version = pkg.version;
const checks = [];

expect(pkg.private === false, 'package.json private must be false');
expect(pkg.bin?.patina === 'bin/patina.js', 'package.json bin.patina must point to bin/patina.js');
expect(pkg.bin?.['patina-cli'] === 'bin/patina.js', 'package.json bin.patina-cli must point to bin/patina.js');
expect(pkg.bin?.['patina-score'] === 'scripts/precommit-score.mjs', 'package.json bin.patina-score must point to scripts/precommit-score.mjs');
expect(existsSync(repoPath('bin/patina.js')), 'bin/patina.js must exist');
expect(readVersionField('SKILL.md') === version, 'SKILL.md version must match package.json');
expect(readVersionField('.patina.default.yaml') === version, '.patina.default.yaml version must match package.json');
expect(readFileSync(repoPath('README.md'), 'utf8').includes(`version: "${version}"`), 'README.md config example version must match package.json');
expect(new RegExp(`^## ${escapeRegex(version)} — \\d{4}-\\d{2}-\\d{2}`, 'm').test(readFileSync(repoPath('CHANGELOG.md'), 'utf8')), 'CHANGELOG.md must contain a release heading for package.json version');
const githubRef = process.env.GITHUB_REF;
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

if (checks.length) {
  console.error(checks.map((msg) => `- ${msg}`).join('\n'));
  process.exit(1);
}
console.log(`Release metadata OK for ${version}`);

function readJson(path) {
  return JSON.parse(readFileSync(repoPath(path), 'utf8'));
}

function readVersionField(path) {
  const text = readFileSync(repoPath(path), 'utf8');
  const match = text.match(/^version:\s*["']?([^"'\n]+)["']?/m);
  return match?.[1]?.trim();
}

function repoPath(path) {
  return resolve(REPO_ROOT, path);
}

function expect(condition, message) {
  if (!condition) checks.push(message);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
