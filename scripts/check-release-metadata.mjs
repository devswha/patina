#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';

const pkg = readJson('package.json');
const version = pkg.version;
const checks = [];

expect(pkg.private === false, 'package.json private must be false');
expect(pkg.bin?.patina === 'bin/patina.js', 'package.json bin.patina must point to bin/patina.js');
expect(pkg.bin?.['patina-score'] === 'scripts/precommit-score.mjs', 'package.json bin.patina-score must point to scripts/precommit-score.mjs');
expect(existsSync('bin/patina.js'), 'bin/patina.js must exist');
expect(readVersionField('SKILL.md') === version, 'SKILL.md version must match package.json');
expect(readVersionField('.patina.default.yaml') === version, '.patina.default.yaml version must match package.json');
expect(readFileSync('README.md', 'utf8').includes(`version: "${version}"`), 'README.md config example version must match package.json');
expect(new RegExp(`^## ${escapeRegex(version)} — \\d{4}-\\d{2}-\\d{2}`, 'm').test(readFileSync('CHANGELOG.md', 'utf8')), 'CHANGELOG.md must contain a release heading for package.json version');

const aliasPkg = readJson('packages/patina-humanizer/package.json');
expect(aliasPkg.name === 'patina-humanizer', 'alias package name must be patina-humanizer');
expect(aliasPkg.version === version, 'patina-humanizer version must match package.json');
expect(aliasPkg.dependencies?.['patina-cli'] === version, 'patina-humanizer must depend on exact patina-cli version');
expect(aliasPkg.bin?.['patina-humanizer'] === 'bin/patina-humanizer.js', 'patina-humanizer bin must point to bin/patina-humanizer.js');
expect(existsSync('packages/patina-humanizer/bin/patina-humanizer.js'), 'patina-humanizer bin file must exist');

if (checks.length) {
  console.error(checks.map((msg) => `- ${msg}`).join('\n'));
  process.exit(1);
}
console.log(`Release metadata OK for ${version}`);

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readVersionField(path) {
  const text = readFileSync(path, 'utf8');
  const match = text.match(/^version:\s*["']?([^"'\n]+)["']?/m);
  return match?.[1]?.trim();
}

function expect(condition, message) {
  if (!condition) checks.push(message);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
