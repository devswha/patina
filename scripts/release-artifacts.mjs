#!/usr/bin/env node

/**
 * Build, verify, and (when explicitly requested) publish the npm release
 * artifacts.  This module deliberately treats a tarball as the release
 * boundary: source is packed once, that exact file is smoke-tested, and the
 * same file is the only input accepted by the publisher.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { compare as semverCompare, valid as semverValid } from 'semver';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MANIFEST_FILENAME = 'release-manifest.json';
export const ROOT_PACKAGE_NAME = 'patina-cli';
export const ALIAS_PACKAGE_NAME = 'patina-humanizer';
export const PACKAGE_ARTIFACTS = Object.freeze([
  Object.freeze({
    key: 'root',
    name: ROOT_PACKAGE_NAME,
    packageDir: '.',
  }),
  Object.freeze({
    key: 'alias',
    name: ALIAS_PACKAGE_NAME,
    packageDir: 'packages/patina-humanizer',
  }),
]);

const DEFAULT_NPM_COMMAND = process.env.NPM_COMMAND || (process.platform === 'win32' ? 'npm.cmd' : 'npm');
const DEFAULT_NPM_TIMEOUT_MS = 120_000;
const NPM_REGISTRY = 'https://registry.npmjs.org';

export class ReleaseArtifactError extends Error {
  constructor(message, code = 'ERR_RELEASE_ARTIFACT', details = undefined) {
    super(message);
    this.name = 'ReleaseArtifactError';
    this.code = code;
    this.details = details;
  }
}

export function parseSemver(value) {
  const normalized = semverValid(String(value ?? '').trim());
  if (!normalized) {
    throw new ReleaseArtifactError(`Invalid semantic version: ${value}`, 'ERR_INVALID_VERSION');
  }
  return normalized;
}

export function compareSemver(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  return semverCompare(a, b);
}

/**
 * Equal versions are allowed for idempotent reruns.  A lower version is
 * never allowed to promote a latest channel.
 */
export function canPromoteLatest({ candidateVersion, currentLatestVersion }) {
  if (!currentLatestVersion) return true;
  return compareSemver(candidateVersion, currentLatestVersion) >= 0;
}

/**
 * Decide how the GitHub Release job should handle a tag after its read-only
 * lookups complete.  An existing release is always edited in place so a
 * release-only rerun cannot change its latest marker.  New releases promote
 * latest only when the candidate is not older than the observed latest tag.
 */
export function decideGithubReleaseAction({
  candidateVersion,
  currentLatestVersion,
  existingRelease = false,
} = {}) {
  const candidate = parseSemver(candidateVersion);
  if (existingRelease) return 'edit';
  if (!currentLatestVersion || canPromoteLatest({
    candidateVersion: candidate,
    currentLatestVersion,
  })) {
    return 'create-latest';
  }
  return 'create-not-latest';
}

/**
 * Classify a GitHub API lookup without treating an operational failure as an
 * absent release.  The API may return a non-zero gh exit status for a 404;
 * that one explicit status is the only missing-release result accepted.
 */
export function classifyGithubReleaseLookup({ httpStatus, commandStatus = 0 } = {}) {
  const status = Number(httpStatus);
  const exitStatus = Number(commandStatus);
  if (status === 404) return 'absent';
  if (
    !Number.isInteger(status)
    || status < 200
    || status >= 300
    || !Number.isInteger(exitStatus)
    || exitStatus !== 0
  ) {
    throw new ReleaseArtifactError(
      'GitHub release lookup failed',
      'ERR_GITHUB_RELEASE_LOOKUP',
      { httpStatus, commandStatus }
    );
  }
  return 'present';
}

/** Extract the HTTP status emitted by `gh api --include`. */
export function parseGithubApiStatus(output) {
  const text = String(output ?? '').replace(/\r\n?/g, '\n');
  const statuses = [];
  for (const line of text.split('\n')) {
    const match = line.match(/^HTTP\/\S+\s+(\d{3})(?:\s|$)/);
    if (match) statuses.push(Number(match[1]));
  }
  if (statuses.length > 1) {
    throw new ReleaseArtifactError(
      'GitHub API response contained multiple HTTP status lines',
      'ERR_GITHUB_RELEASE_RESPONSE',
      { statuses }
    );
  }
  return statuses[0];
}

/** Parse the JSON body emitted by `gh api --include`. */
export function parseGithubApiJson(output) {
  const text = String(output ?? '').replace(/\r\n?/g, '\n');
  // Validate the status framing before extracting the body so redirects or
  // repeated response blocks cannot be mistaken for a successful payload.
  const status = parseGithubApiStatus(text);
  if (status === undefined || status < 200 || status >= 300) {
    throw new ReleaseArtifactError(
      'GitHub API response did not contain a successful HTTP status',
      'ERR_GITHUB_RELEASE_RESPONSE',
      { status }
    );
  }
  const separator = text.indexOf('\n\n');
  const body = separator >= 0
    ? text.slice(separator + 2).trim()
    : text.trim();
  if (!body) {
    throw new ReleaseArtifactError('GitHub API response did not contain a JSON body', 'ERR_GITHUB_RELEASE_RESPONSE');
  }
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new ReleaseArtifactError('GitHub API response was not valid JSON', 'ERR_GITHUB_RELEASE_RESPONSE', { cause: error });
  }
}

/** Normalize a GitHub release tag to the semantic version used by npm. */
export function parseGithubReleaseTag(value) {
  const tag = String(value ?? '').trim();
  if (!tag) {
    throw new ReleaseArtifactError('GitHub release response did not contain a tag', 'ERR_GITHUB_RELEASE_RESPONSE');
  }
  return parseSemver(tag.replace(/^v/, ''));
}

export function assertCanPromoteLatest({ candidateVersion, currentLatestVersion }) {
  if (!canPromoteLatest({ candidateVersion, currentLatestVersion })) {
    throw new ReleaseArtifactError(
      `Refusing to promote stale version ${candidateVersion}; current latest is ${currentLatestVersion}`,
      'ERR_STALE_LATEST',
      { candidateVersion, currentLatestVersion }
    );
  }
  return true;
}

export function hashBytes(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const sha512 = createHash('sha512').update(bytes).digest('hex');
  return {
    sha256,
    sha512,
    integrity: `sha512-${Buffer.from(sha512, 'hex').toString('base64')}`,
    size: bytes.length,
  };
}

export function hashFile(path) {
  return hashBytes(readFileSync(path));
}

function packageManifest(repoRoot, packageDir) {
  const packagePath = resolve(repoRoot, packageDir, 'package.json');
  if (!existsSync(packagePath)) {
    throw new ReleaseArtifactError(`Missing package manifest: ${packagePath}`, 'ERR_PACKAGE_MANIFEST');
  }
  return {
    path: packagePath,
    value: JSON.parse(readFileSync(packagePath, 'utf8')),
  };
}

function ensureEmptyDirectory(path, code) {
  const absolute = resolve(path);
  const stat = lstatOrNull(absolute);
  if (stat) {
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new ReleaseArtifactError(`${absolute} must be a regular directory`, code, { path: absolute });
    }
    let entries;
    try {
      entries = readdirSync(absolute);
    } catch (error) {
      throw new ReleaseArtifactError(`Unable to inspect ${absolute}`, code, { cause: error });
    }
    if (entries.length > 0) {
      throw new ReleaseArtifactError(`${absolute} must be empty`, code, { path: absolute, entries });
    }
    return;
  }
  mkdirSync(absolute, { recursive: true });
  assertOutputDirectory(absolute, code);
}

function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function isWithinPath(root, candidate) {
  const child = relative(root, candidate);
  return child === '' || (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child));
}

function assertOutputDirectory(path, code = 'ERR_ARTIFACT_PATH') {
  const absolute = resolve(path);
  const stat = lstatOrNull(absolute);
  if (!stat || stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new ReleaseArtifactError(`${absolute} must be a regular directory`, code, { path: absolute });
  }
  let real;
  try {
    real = realpathSync(absolute);
  } catch (error) {
    throw new ReleaseArtifactError(`Unable to resolve ${absolute}`, code, { cause: error, path: absolute });
  }
  return { path: absolute, realpath: real };
}

function safeOutputPath(outputDir, requestedPath, code = 'ERR_ARTIFACT_PATH', label = 'artifact') {
  const root = resolve(outputDir);
  const candidate = resolve(requestedPath);
  if (!isWithinPath(root, candidate)) {
    throw new ReleaseArtifactError(`${label} path escapes output directory: ${requestedPath}`, code, {
      outputDir: root,
      path: candidate,
    });
  }
  return candidate;
}

function assertRegularOutputFile(outputDir, path, code, label) {
  const destination = assertOutputDirectory(outputDir, code);
  const absolute = safeOutputPath(destination.path, path, code, label);
  const stat = lstatOrNull(absolute);
  if (!stat || stat.isSymbolicLink() || !stat.isFile()) {
    throw new ReleaseArtifactError(`${label} must be a regular file: ${absolute}`, code, { path: absolute });
  }
  let real;
  try {
    real = realpathSync(absolute);
  } catch (error) {
    throw new ReleaseArtifactError(`Unable to resolve ${label}: ${absolute}`, code, { cause: error, path: absolute });
  }
  if (!isWithinPath(destination.realpath, real)) {
    throw new ReleaseArtifactError(`${label} realpath escapes output directory: ${absolute}`, code, {
      outputDir: destination.realpath,
      path: real,
    });
  }
  return absolute;
}

function resolveSourceSHA({ repoRoot, sourceSHA, env = process.env, command = execFileSync }) {
  const supplied = sourceSHA || env.GITHUB_SHA;
  if (supplied && String(supplied).trim()) return String(supplied).trim();
  try {
    return command('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    throw new ReleaseArtifactError(
      'sourceSHA is required outside a git checkout',
      'ERR_SOURCE_SHA',
      { cause: error }
    );
  }
}

function parseNpmPackOutput(output) {
  const text = String(output).trim();
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end < start) {
    throw new ReleaseArtifactError('npm pack did not return JSON metadata', 'ERR_PACK_OUTPUT', { output: text });
  }
  let parsed;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch (error) {
    throw new ReleaseArtifactError('Unable to parse npm pack metadata', 'ERR_PACK_OUTPUT', { cause: error, output: text });
  }
  if (!Array.isArray(parsed) || parsed.length !== 1 || typeof parsed[0] !== 'object') {
    throw new ReleaseArtifactError('npm pack returned unexpected metadata', 'ERR_PACK_OUTPUT', { output: parsed });
  }
  return parsed[0];
}

function safeArtifactPath(outputDir, filename) {
  if (!filename || basename(filename) !== filename || filename.includes('\0')) {
    throw new ReleaseArtifactError(`Unsafe artifact filename: ${filename}`, 'ERR_ARTIFACT_PATH');
  }
  return safeOutputPath(outputDir, resolve(outputDir, filename), 'ERR_ARTIFACT_PATH', 'Artifact');
}

function inspectOutputFile(outputDir, path, code, label) {
  return assertRegularOutputFile(outputDir, path, code, label);
}

function runCommand(command, args, options = {}, execute = execFileSync) {
  try {
    return execute(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      // .cmd shims on win32 cannot be spawned without a shell
      // (CVE-2024-27980).
      ...(command.endsWith('.cmd') ? { shell: true } : {}),
      ...options,
    });
  } catch (error) {
    const detail = error?.stderr ? `: ${String(error.stderr).trim()}` : '';
    throw new ReleaseArtifactError(
      `${command} ${args.join(' ')} failed${detail}`,
      isTimeoutError(error) ? 'ERR_COMMAND_TIMEOUT' : 'ERR_COMMAND',
      { cause: error, command, args, timedOut: isTimeoutError(error) }
    );
  }
}

function readTarJson(tarballPath, execute = execFileSync) {
  const output = runCommand(
    'tar',
    ['-xOf', tarballPath, 'package/package.json'],
    {},
    execute
  );
  try {
    return JSON.parse(output);
  } catch (error) {
    throw new ReleaseArtifactError(`Invalid package.json in ${tarballPath}`, 'ERR_TARBALL_MANIFEST', { cause: error });
  }
}

function listTarEntries(tarballPath, execute = execFileSync) {
  const output = runCommand('tar', ['-tzf', tarballPath], {}, execute);
  return String(output)
    .split(/\r?\n/)
    .map((entry) => entry.trim().replace(/\/$/, ''))
    .filter(Boolean)
    .sort();
}

function normalizePackFiles(files) {
  return (files || [])
    .map((entry) => ({
      path: String(entry.path),
      size: Number(entry.size),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Build a manifest from pack metadata.  Kept public so tests and release
 * tooling can independently create an expected manifest without packing.
 */
export function createIntegrityManifest({ sourceSHA, version, artifacts }) {
  if (!sourceSHA) {
    throw new ReleaseArtifactError('sourceSHA is required for an integrity manifest', 'ERR_SOURCE_SHA');
  }
  if (!version) {
    throw new ReleaseArtifactError('version is required for an integrity manifest', 'ERR_VERSION');
  }
  const normalizedArtifacts = Array.isArray(artifacts)
    ? artifacts
    : Object.entries(artifacts || {}).map(([key, value]) => ({ key, ...value }));
  if (normalizedArtifacts.length !== PACKAGE_ARTIFACTS.length) {
    throw new ReleaseArtifactError('Both root and alias artifacts are required', 'ERR_ARTIFACT_SET');
  }
  const packages = {};
  const files = [];
  for (const artifact of normalizedArtifacts) {
    const key = artifact.key || (artifact.name === ROOT_PACKAGE_NAME ? 'root' : 'alias');
    const name = artifact.name || (key === 'root' ? ROOT_PACKAGE_NAME : ALIAS_PACKAGE_NAME);
    const file = artifact.file || artifact.tarball;
    if (!file || !artifact.sha256 || !artifact.sha512) {
      throw new ReleaseArtifactError(`Incomplete integrity metadata for ${name}`, 'ERR_ARTIFACT_METADATA');
    }
    const descriptor = {
      key,
      name,
      version: artifact.version || version,
      file: basename(file),
      size: Number(artifact.size),
      sha256: artifact.sha256,
      sha512: artifact.sha512,
      integrity: artifact.integrity || `sha512-${Buffer.from(artifact.sha512, 'hex').toString('base64')}`,
      files: normalizePackFiles(artifact.files),
    };
    packages[key] = descriptor;
    files.push({
      package: key,
      name,
      file: descriptor.file,
      size: descriptor.size,
      sha256: descriptor.sha256,
      sha512: descriptor.sha512,
    });
  }
  return {
    schemaVersion: 1,
    sourceSHA: String(sourceSHA),
    version: String(version),
    packages,
    files,
  };
}

function assertManifestShape(manifest) {
  if (!manifest || manifest.schemaVersion !== 1 || typeof manifest.sourceSHA !== 'string' || !manifest.version) {
    throw new ReleaseArtifactError('Invalid release integrity manifest', 'ERR_MANIFEST');
  }
  if (!manifest.packages || !manifest.packages.root || !manifest.packages.alias) {
    throw new ReleaseArtifactError('Release manifest must contain root and alias packages', 'ERR_MANIFEST');
  }
  if (!Array.isArray(manifest.files) || manifest.files.length !== 2) {
    throw new ReleaseArtifactError('Release manifest must list both tarballs', 'ERR_MANIFEST');
  }
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function writeReleaseManifest(outputDir, manifestPath, manifest) {
  const destination = assertOutputDirectory(outputDir, 'ERR_ARTIFACT_PATH');
  const target = safeOutputPath(destination.path, manifestPath, 'ERR_MANIFEST', 'Release manifest');
  if (lstatOrNull(target)) {
    throw new ReleaseArtifactError(`Release manifest already exists: ${target}`, 'ERR_MANIFEST');
  }
  try {
    writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  } catch (error) {
    throw new ReleaseArtifactError(`Unable to write release manifest: ${target}`, 'ERR_MANIFEST', { cause: error });
  }
}

/**
 * Pack both package directories exactly once.  npm pack intentionally runs
 * ordinary pack lifecycle hooks; `prepublishOnly` is a publish-only source
 * safety gate and is not bypassed globally or executed for tarball publish.
 */
export function buildReleaseArtifacts({
  repoRoot = REPO_ROOT,
  outputDir = join(repoRoot, '.release-artifacts'),
  sourceSHA,
  npmCommand = DEFAULT_NPM_COMMAND,
  npmTimeoutMs = DEFAULT_NPM_TIMEOUT_MS,
  command = execFileSync,
} = {}) {
  const root = resolve(repoRoot);
  const destination = resolve(outputDir);
  ensureEmptyDirectory(destination, 'ERR_OUTPUT_DIR_NOT_EMPTY');
  assertOutputDirectory(destination, 'ERR_OUTPUT_DIR_NOT_EMPTY');
  const resolvedSourceSHA = resolveSourceSHA({
    repoRoot: root,
    sourceSHA,
    command,
  });
  const manifests = PACKAGE_ARTIFACTS.map(({ key, name, packageDir }) => {
    const { value: pkg } = packageManifest(root, packageDir);
    if (pkg.name !== name) {
      throw new ReleaseArtifactError(`${packageDir}/package.json name must be ${name}`, 'ERR_PACKAGE_METADATA');
    }
    return { key, name, packageDir, pkg };
  });
  const rootVersion = manifests[0].pkg.version;
  if (!rootVersion || manifests.some(({ pkg }) => pkg.version !== rootVersion)) {
    throw new ReleaseArtifactError('Root and alias package versions must match', 'ERR_PACKAGE_METADATA');
  }
  if (manifests[1].pkg.dependencies?.[ROOT_PACKAGE_NAME] !== rootVersion) {
    throw new ReleaseArtifactError(
      `Alias dependency must be exact ${ROOT_PACKAGE_NAME}@${rootVersion}`,
      'ERR_ALIAS_DEPENDENCY'
    );
  }

  const artifacts = manifests.map(({ key, name, packageDir }) => {
    const packOutput = runCommand(
      npmCommand,
      ['pack', '--json', '--pack-destination', destination],
      { cwd: resolve(root, packageDir), timeout: npmTimeoutMs },
      command
    );
    const metadata = parseNpmPackOutput(packOutput);
    if (metadata.name !== name || metadata.version !== rootVersion) {
      throw new ReleaseArtifactError(`npm pack metadata mismatch for ${name}`, 'ERR_PACK_METADATA', { metadata });
    }
    const file = basename(metadata.filename);
    const path = safeArtifactPath(destination, file);
    if (!existsSync(path)) {
      throw new ReleaseArtifactError(`npm pack did not create ${path}`, 'ERR_PACK_OUTPUT');
    }
    inspectOutputFile(destination, path, 'ERR_PACK_OUTPUT', `${name} tarball`);
    const integrity = hashFile(path);
    return {
      key,
      name,
      version: metadata.version,
      file,
      path,
      ...integrity,
      files: metadata.files,
    };
  });
  const manifest = createIntegrityManifest({
    sourceSHA: resolvedSourceSHA,
    version: rootVersion,
    artifacts,
  });
  const manifestPath = safeOutputPath(destination, join(destination, MANIFEST_FILENAME), 'ERR_MANIFEST', 'Release manifest');
  writeReleaseManifest(destination, manifestPath, manifest);
  return {
    outputDir: destination,
    manifestPath,
    manifest,
    artifacts,
  };
}

function expectedPackageEntries(descriptor) {
  return descriptor.files.map(({ path }) => `package/${path}`).sort();
}

/**
 * Verify hashes and package metadata without packing source again.
 */
export function verifyReleaseArtifacts({
  repoRoot = REPO_ROOT,
  outputDir = join(repoRoot, '.release-artifacts'),
  manifestPath = join(outputDir, MANIFEST_FILENAME),
  sourceSHA,
  expectedVersion,
  command = execFileSync,
}) {
  const destination = resolve(outputDir);
  assertOutputDirectory(destination, 'ERR_ARTIFACT_PATH');
  if (!sourceSHA || !String(sourceSHA).trim()) {
    throw new ReleaseArtifactError('sourceSHA is required for release verification', 'ERR_SOURCE_SHA');
  }
  const manifestFile = safeOutputPath(destination, resolve(manifestPath), 'ERR_MANIFEST', 'Release manifest');
  if (!existsSync(manifestFile)) {
    throw new ReleaseArtifactError(`Missing release manifest: ${manifestFile}`, 'ERR_MANIFEST');
  }
  inspectOutputFile(destination, manifestFile, 'ERR_MANIFEST', 'Release manifest');
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  } catch (error) {
    throw new ReleaseArtifactError(`Unable to parse release manifest: ${manifestFile}`, 'ERR_MANIFEST', { cause: error });
  }
  assertManifestShape(manifest);
  const expectedSource = String(sourceSHA).trim();
  if (manifest.sourceSHA !== expectedSource) {
    throw new ReleaseArtifactError(
      `Manifest sourceSHA ${manifest.sourceSHA} does not match expected ${expectedSource}`,
      'ERR_SOURCE_SHA_MISMATCH'
    );
  }
  if (expectedVersion && parseSemver(manifest.version) !== parseSemver(expectedVersion)) {
    throw new ReleaseArtifactError(
      `Manifest version ${manifest.version} does not match expected ${expectedVersion}`,
      'ERR_VERSION_MISMATCH'
    );
  }

  const verified = [];
  for (const key of ['root', 'alias']) {
    const descriptor = manifest.packages[key];
    const expectedName = key === 'root' ? ROOT_PACKAGE_NAME : ALIAS_PACKAGE_NAME;
    if (
      !descriptor
      || !descriptor.file
      || descriptor.key !== key
      || descriptor.name !== expectedName
      || descriptor.version !== manifest.version
    ) {
      throw new ReleaseArtifactError(`Invalid ${key} package descriptor`, 'ERR_MANIFEST');
    }
    if (!Array.isArray(descriptor.files) || descriptor.files.some((entry) => !entry || typeof entry.path !== 'string')) {
      throw new ReleaseArtifactError(`Invalid ${key} package file list`, 'ERR_MANIFEST');
    }
    const listed = manifest.files.find((entry) => entry.package === key);
    if (
      !listed
      || listed.file !== descriptor.file
      || listed.sha256 !== descriptor.sha256
      || listed.sha512 !== descriptor.sha512
      || listed.size !== descriptor.size
    ) {
      throw new ReleaseArtifactError(`${key} manifest file summary mismatch`, 'ERR_MANIFEST');
    }
    const artifactPath = safeArtifactPath(destination, descriptor.file);
    if (!existsSync(artifactPath)) {
      throw new ReleaseArtifactError(`Missing ${key} tarball: ${artifactPath}`, 'ERR_TARBALL');
    }
    inspectOutputFile(destination, artifactPath, 'ERR_TARBALL', `${key} tarball`);
    const actual = hashFile(artifactPath);
    for (const hash of ['sha256', 'sha512', 'integrity']) {
      if (actual[hash] !== descriptor[hash]) {
        throw new ReleaseArtifactError(
          `${key} ${hash} mismatch for ${descriptor.file}`,
          'ERR_INTEGRITY_MISMATCH',
          { key, expected: descriptor[hash], actual: actual[hash] }
        );
      }
    }
    if (descriptor.size !== actual.size) {
      throw new ReleaseArtifactError(`${key} size mismatch for ${descriptor.file}`, 'ERR_INTEGRITY_MISMATCH');
    }
    const packageJson = readTarJson(artifactPath, command);
    if (packageJson.name !== descriptor.name || packageJson.version !== manifest.version) {
      throw new ReleaseArtifactError(`${key} tarball package metadata mismatch`, 'ERR_TARBALL_MANIFEST');
    }
    if (
      key === 'alias'
      && packageJson.dependencies?.[ROOT_PACKAGE_NAME] !== manifest.version
    ) {
      throw new ReleaseArtifactError(
        `Alias tarball must depend on exact ${ROOT_PACKAGE_NAME}@${manifest.version}`,
        'ERR_ALIAS_DEPENDENCY'
      );
    }
    const entries = listTarEntries(artifactPath, command);
    const expectedEntries = expectedPackageEntries(descriptor);
    if (entries.length !== expectedEntries.length || entries.some((entry, index) => entry !== expectedEntries[index])) {
      throw new ReleaseArtifactError(`${key} tarball file list differs from manifest`, 'ERR_FILE_LIST_MISMATCH');
    }
    verified.push({ ...descriptor, path: artifactPath, actual });
  }
  return { manifest, manifestPath: manifestFile, artifacts: verified };
}

function nodeScriptPath(prefix, packageName) {
  return join(prefix, 'node_modules', packageName, 'package.json');
}

function runInstallCommand({
  npmCommand,
  fixtureDir,
  cacheDir,
  npmrcPath,
  rootTarball,
  aliasTarball,
  npmTimeoutMs,
  command,
}) {
  const environment = {
    ...process.env,
    NPM_CONFIG_AUDIT: 'false',
    NPM_CONFIG_FUND: 'false',
    NPM_CONFIG_UPDATE_NOTIFIER: 'false',
    NPM_CONFIG_OFFLINE: 'false',
    NPM_CONFIG_PREFER_ONLINE: 'true',
    NPM_CONFIG_IGNORE_SCRIPTS: 'false',
    NPM_CONFIG_CACHE: cacheDir,
    NPM_CONFIG_USERCONFIG: npmrcPath,
  };
  runCommand(
    npmCommand,
    [
      'install',
      '--prefix',
      fixtureDir,
      '--no-audit',
      '--no-fund',
      '--prefer-online',
      '--package-lock=true',
      '--registry',
      NPM_REGISTRY,
      rootTarball,
      aliasTarball,
    ],
    {
      cwd: fixtureDir,
      env: environment,
      timeout: npmTimeoutMs,
    },
    command
  );
  // Reinstall from the generated lockfile so the smoke exercises the exact
  // local tarball resolutions, while only ordinary transitive dependencies
  // (currently js-yaml/argparse) may be fetched from the public registry.
  return runCommand(
    npmCommand,
    [
      'ci',
      '--prefix',
      fixtureDir,
      '--no-audit',
      '--no-fund',
      '--prefer-online',
      '--registry',
      NPM_REGISTRY,
    ],
    {
      cwd: fixtureDir,
      env: environment,
      timeout: npmTimeoutMs,
    },
    command
  );
}

/**
 * Install root.tgz and alias.tgz together into an empty fixture.  npm's
 * resolver must therefore satisfy the alias's exact patina-cli dependency
 * from the explicitly supplied root tarball; only transitive dependencies may
 * use the public registry, and the lockfile is checked for file resolutions.
 */
export function runLocalInstallSmoke({
  outputDir,
  artifacts,
  npmCommand = DEFAULT_NPM_COMMAND,
  npmTimeoutMs = DEFAULT_NPM_TIMEOUT_MS,
  command = execFileSync,
  fixtureDir,
  keepFixture = false,
} = {}) {
  const rootArtifact = artifacts?.find((artifact) => artifact.key === 'root');
  const aliasArtifact = artifacts?.find((artifact) => artifact.key === 'alias');
  if (!rootArtifact || !aliasArtifact) {
    throw new ReleaseArtifactError('Root and alias artifacts are required for install smoke', 'ERR_ARTIFACT_SET');
  }
  if (!outputDir) {
    throw new ReleaseArtifactError('outputDir is required for install smoke', 'ERR_ARTIFACT_SET');
  }
  const destination = resolve(outputDir);
  assertOutputDirectory(destination, 'ERR_ARTIFACT_PATH');
  const rootTarballPath = rootArtifact.path || join(destination, rootArtifact.file);
  const aliasTarballPath = aliasArtifact.path || join(destination, aliasArtifact.file);
  const fixture = fixtureDir
    ? resolve(fixtureDir)
    : mkdtempSync(join(tmpdir(), 'patina-release-smoke-'));
  const cacheDir = mkdtempSync(join(tmpdir(), 'patina-release-cache-'));
  const npmrcPath = join(cacheDir, '.npmrc');
  try {
    ensureEmptyDirectory(fixture, 'ERR_SMOKE_DIR_NOT_EMPTY');
    const rootTarball = inspectOutputFile(destination, rootTarballPath, 'ERR_TARBALL', 'root tarball');
    const aliasTarball = inspectOutputFile(destination, aliasTarballPath, 'ERR_TARBALL', 'alias tarball');
    writeFileSync(npmrcPath, `registry=${NPM_REGISTRY}\n`);
    writeJson(join(fixture, 'package.json'), {
      name: 'patina-release-smoke-fixture',
      version: '0.0.0',
      private: true,
    });
    runInstallCommand({
      npmCommand,
      fixtureDir: fixture,
      cacheDir,
      npmrcPath,
      rootTarball,
      aliasTarball,
      npmTimeoutMs,
      command,
    });
    const nodeModules = join(fixture, 'node_modules');
    const rootPackagePath = nodeScriptPath(fixture, ROOT_PACKAGE_NAME);
    const aliasPackagePath = nodeScriptPath(fixture, ALIAS_PACKAGE_NAME);
    if (!existsSync(rootPackagePath) || !existsSync(aliasPackagePath)) {
      throw new ReleaseArtifactError('Local install did not place both packages', 'ERR_INSTALL_SMOKE');
    }
    const rootPackage = JSON.parse(readFileSync(rootPackagePath, 'utf8'));
    const aliasPackage = JSON.parse(readFileSync(aliasPackagePath, 'utf8'));
    if (aliasPackage.dependencies?.[ROOT_PACKAGE_NAME] !== rootPackage.version) {
      throw new ReleaseArtifactError('Alias dependency is not exact root version', 'ERR_INSTALL_SMOKE');
    }
    const aliasRequire = createRequire(aliasPackagePath);
    const resolvedRootPackage = realpathSync(aliasRequire.resolve(`${ROOT_PACKAGE_NAME}/package.json`));
    if (resolvedRootPackage !== realpathSync(rootPackagePath)) {
      throw new ReleaseArtifactError(
        'Alias resolved patina-cli from a different installation than the supplied root tarball',
        'ERR_INSTALL_SMOKE'
      );
    }
    const lockfilePath = join(fixture, 'package-lock.json');
    if (!existsSync(lockfilePath)) {
      throw new ReleaseArtifactError('Local install did not produce a lockfile', 'ERR_INSTALL_SMOKE');
    }
    const lockfile = JSON.parse(readFileSync(lockfilePath, 'utf8'));
    const rootLock = lockfile.packages?.[`node_modules/${ROOT_PACKAGE_NAME}`];
    const aliasLock = lockfile.packages?.[`node_modules/${ALIAS_PACKAGE_NAME}`];
    if (
      !rootLock?.resolved?.startsWith('file:')
      || !aliasLock?.resolved?.startsWith('file:')
      || rootLock.integrity !== rootArtifact.integrity
      || aliasLock.integrity !== aliasArtifact.integrity
    ) {
      throw new ReleaseArtifactError('Install lockfile does not point at local tarballs', 'ERR_INSTALL_SMOKE');
    }
    const resolvedTarball = (lockEntry) => resolve(fixture, lockEntry.resolved.slice('file:'.length));
    if (
      realpathSync(resolvedTarball(rootLock)) !== realpathSync(rootTarball)
      || realpathSync(resolvedTarball(aliasLock)) !== realpathSync(aliasTarball)
    ) {
      throw new ReleaseArtifactError('Install lockfile points at a different local tarball', 'ERR_INSTALL_SMOKE');
    }
    const runCli = (packageName, binPath) => {
      const executable = join(nodeModules, packageName, binPath);
      const result = runCommand('node', [executable, '--version'], {}, command).trim();
      const expected = `patina ${rootPackage.version}`;
      if (result !== expected) {
        throw new ReleaseArtifactError(
          `${packageName} CLI smoke returned ${JSON.stringify(result)}, expected ${JSON.stringify(expected)}`,
          'ERR_INSTALL_SMOKE'
        );
      }
      return result;
    };
    const versions = {
      root: runCli(ROOT_PACKAGE_NAME, 'bin/patina.js'),
      alias: runCli(ALIAS_PACKAGE_NAME, 'bin/patina-humanizer.js'),
    };
    return {
      fixtureDir: fixture,
      rootTarball,
      aliasTarball,
      versions,
      lockfilePath,
    };
  } finally {
    if (!fixtureDir && !keepFixture) {
      rmSync(fixture, { recursive: true, force: true });
    }
    rmSync(cacheDir, { recursive: true, force: true });
  }
}

function registryRecordMatches(record, expected) {
  if (!record) return false;
  const integrity = record.integrity || record.dist?.integrity;
  const sha512 = record.sha512 || record.dist?.sha512;
  const sha256 = record.sha256 || record.dist?.sha256;
  return (
    (!expected.integrity || integrity === expected.integrity)
    // npm's registry exposes the SRI sha512 value, not a hexadecimal sha512
    // or sha256 field.  Compare those optional fields when a transport
    // provides them, while requiring the exact SRI integrity above.
    && (!sha512 || !expected.sha512 || sha512 === expected.sha512)
    && (!sha256 || !expected.sha256 || sha256 === expected.sha256)
  );
}

function isTimeoutError(error) {
  const candidates = [
    error,
    error?.details,
    error?.details?.cause,
    error?.cause,
  ].filter(Boolean);
  return candidates.some((candidate) => (
    candidate.timedOut === true
    || candidate.code === 'ERR_COMMAND_TIMEOUT'
    || candidate.code === 'ETIMEDOUT'
    || candidate.code === 'ESOCKETTIMEDOUT'
    || candidate.name === 'TimeoutError'
    || (candidate.killed === true && candidate.signal === 'SIGTERM')
    || /ETIMEDOUT|ESOCKETTIMEDOUT|timed?\s*out|timeout/i.test(String(candidate.message || ''))
  ));
}

function isNpmNotFoundError(error) {
  const candidates = [
    error,
    error?.details,
    error?.details?.cause,
    error?.cause,
  ].filter(Boolean);
  return candidates.some((candidate) => (
    candidate.code === 'E404'
    || candidate.statusCode === 404
    || candidate.status === 404
    || /\bE404\b/.test(String(candidate.message || ''))
    || /\bE404\b/.test(String(candidate.stderr || ''))
  ));
}

function isNpmConflictError(error) {
  const candidates = [
    error,
    error?.details,
    error?.details?.cause,
    error?.cause,
  ].filter(Boolean);
  return candidates.some((candidate) => (
    candidate.code === 'E409'
    || candidate.code === 'EPUBLISHCONFLICT'
    || candidate.statusCode === 409
    || candidate.status === 409
    || /\bE409\b/.test(String(candidate.stderr || ''))
  ));
}

async function sleep(milliseconds) {
  if (milliseconds > 0) await delay(milliseconds);
}

/**
 * Publish root and alias with per-package state and timeout recovery.  The
 * transport is injectable: `inspect({name, version})` must return null or a
 * registry record, and `publish({name, version, tarball, artifact})` uploads
 * the supplied tarball.  No retry occurs until a timed-out upload is checked
 * in the registry.
 */
export async function publishWithRecovery({
  version,
  expectedVersion,
  sourceSHA,
  artifacts,
  transport,
  maxAttempts = 2,
  retryDelayMs = 0,
} = {}) {
  if (!transport || typeof transport.inspect !== 'function' || typeof transport.publish !== 'function') {
    throw new ReleaseArtifactError('publish transport must provide inspect and publish', 'ERR_TRANSPORT');
  }
  const latestTransport = transport.latest || transport.inspectLatest;
  if (typeof latestTransport !== 'function') {
    throw new ReleaseArtifactError(
      'publish transport must provide latest or inspectLatest',
      'ERR_TRANSPORT'
    );
  }
  const normalizedVersion = parseSemver(version);
  if (!sourceSHA || !String(sourceSHA).trim()) {
    throw new ReleaseArtifactError('sourceSHA is required for publication', 'ERR_SOURCE_SHA');
  }
  if (!expectedVersion || !String(expectedVersion).trim()) {
    throw new ReleaseArtifactError('expectedVersion is required for publication', 'ERR_VERSION');
  }
  const normalizedExpectedVersion = parseSemver(expectedVersion);
  if (normalizedVersion !== normalizedExpectedVersion) {
    throw new ReleaseArtifactError(
      `Publication version ${normalizedVersion} does not match expected ${normalizedExpectedVersion}`,
      'ERR_VERSION_MISMATCH',
      { version: normalizedVersion, expectedVersion: normalizedExpectedVersion }
    );
  }
  const byKey = Array.isArray(artifacts)
    ? Object.fromEntries(artifacts.map((artifact) => [artifact.key, artifact]))
    : artifacts;
  if (!byKey?.root || !byKey?.alias) {
    throw new ReleaseArtifactError('Both root and alias artifacts are required for publication', 'ERR_ARTIFACT_SET');
  }
  const states = { root: 'pending', alias: 'pending' };
  const attempts = { root: 0, alias: 0 };
  const retries = { root: 0, alias: 0 };
  const markFailure = (key, error) => {
    states[key] = 'failed';
    if (error && typeof error === 'object') {
      error.details = {
        ...(error.details || {}),
        states: { ...states },
        attempts: { ...attempts },
        retries: { ...retries },
      };
    }
    return error;
  };
  const expected = (key) => ({
    integrity: byKey[key].integrity,
    sha256: byKey[key].sha256,
    sha512: byKey[key].sha512,
  });
  const packageName = (key) => byKey[key].name || (key === 'root' ? ROOT_PACKAGE_NAME : ALIAS_PACKAGE_NAME);
  const inspect = async (key) => {
    try {
      return await transport.inspect({
        name: packageName(key),
        version: normalizedVersion,
        key,
      });
    } catch (error) {
      if (isNpmNotFoundError(error)) return null;
      throw error;
    }
  };
  const inspectRecovery = async (key, phase) => {
    try {
      return await inspect(key);
    } catch (error) {
      const failure = error && typeof error === 'object'
        ? error
        : new ReleaseArtifactError(
          `${packageName(key)} registry inspection failed during ${phase}`,
          'ERR_REGISTRY_INSPECTION',
          { cause: error }
        );
      if (failure && typeof failure === 'object') {
        failure.details = {
          ...(failure.details || {}),
          registryInspectionPhase: phase,
        };
      }
      throw markFailure(key, failure);
    }
  };
  const inspectLatest = async (key) => {
    let result;
    try {
      result = await latestTransport({
        name: packageName(key),
        version: normalizedVersion,
        key,
      });
    } catch (error) {
      if (isNpmNotFoundError(error)) return null;
      throw error;
    }
    if (result == null || result === '') return null;
    if (typeof result === 'string') return parseSemver(result);
    const latest = result.version
      || result.latest
      || result.distTags?.latest
      || result['dist-tags']?.latest
      || result.dist?.['dist-tags']?.latest;
    if (latest == null || latest === '') {
      throw new ReleaseArtifactError(
        `Latest inspection returned no version for ${packageName(key)}`,
        'ERR_LATEST_RESPONSE',
        { key, result }
      );
    }
    return parseSemver(latest);
  };
  const confirm = async (key, record, phase) => {
    if (!record) return false;
    if (!registryRecordMatches(record, expected(key))) {
      throw markFailure(key, new ReleaseArtifactError(
        `${packageName(key)}@${version} exists with unexpected integrity during ${phase}`,
        'ERR_REGISTRY_INTEGRITY_MISMATCH',
        { key, expected: expected(key), observed: record }
      ));
    }
    states[key] = 'done';
    return true;
  };

  for (const key of ['root', 'alias']) {
    let existing;
    try {
      existing = await inspect(key);
    } catch (error) {
      throw markFailure(key, error);
    }
    if (await confirm(key, existing, 'initial inspection')) continue;

    let completed = false;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      attempts[key] = attempt;
      try {
        const currentLatest = await inspectLatest(key);
        if (currentLatest) {
          assertCanPromoteLatest({
            candidateVersion: normalizedVersion,
            currentLatestVersion: currentLatest,
          });
        }
      } catch (error) {
        throw markFailure(key, error);
      }
      try {
        await transport.publish({
          name: packageName(key),
          version: normalizedVersion,
          key,
          tarball: byKey[key].path || byKey[key].file,
          artifact: byKey[key],
        });
        const afterPublish = await inspectRecovery(key, 'post-publish inspection');
        if (!(await confirm(key, afterPublish, 'post-publish inspection'))) {
          throw new ReleaseArtifactError(
            `${packageName(key)} publish returned without an exact registry artifact`,
            'ERR_PUBLISH_UNCONFIRMED',
            { key }
          );
        }
        completed = true;
        break;
      } catch (error) {
        if (error?.details?.registryInspectionPhase || error?.code === 'ERR_REGISTRY_INTEGRITY_MISMATCH') throw error;
        if (isNpmConflictError(error)) {
          const afterConflict = await inspectRecovery(key, 'conflict inspection');
          if (await confirm(key, afterConflict, 'conflict inspection')) {
            completed = true;
            break;
          }
          throw markFailure(key, error);
        }
        if (!isTimeoutError(error)) {
          throw markFailure(key, error);
        }
        const afterTimeout = await inspectRecovery(key, 'timeout inspection');
        if (await confirm(key, afterTimeout, 'timeout inspection')) {
          completed = true;
          break;
        }
        if (attempt >= maxAttempts) {
          throw markFailure(key, error);
        }
        retries[key] += 1;
        await sleep(retryDelayMs);
        // A final inspection immediately before retry closes the race where a
        // registry became visible while the bounded delay elapsed.
        const beforeRetry = await inspectRecovery(key, 'pre-retry inspection');
        if (await confirm(key, beforeRetry, 'pre-retry inspection')) {
          completed = true;
          break;
        }
      }
    }
    if (!completed && states[key] !== 'done') {
      throw markFailure(
        key,
        new ReleaseArtifactError(`${packageName(key)} publication did not complete`, 'ERR_PUBLISH_UNCONFIRMED')
      );
    }
  }
  return { version: normalizedVersion, states, attempts, retries };
}

async function npmRegistryInspect({
  name,
  version,
  npmCommand = DEFAULT_NPM_COMMAND,
  npmTimeoutMs = DEFAULT_NPM_TIMEOUT_MS,
  command = execFileSync,
}) {
  try {
    const output = runCommand(
      npmCommand,
      ['view', `${name}@${version}`, 'dist', '--json', '--registry', NPM_REGISTRY],
      {
        env: {
          ...process.env,
          NPM_CONFIG_AUDIT: 'false',
          NPM_CONFIG_FUND: 'false',
          NPM_CONFIG_OFFLINE: 'false',
        },
        timeout: npmTimeoutMs,
      },
      command
    );
    if (!String(output).trim() || String(output).trim() === 'null') return null;
    const dist = JSON.parse(output);
    return dist ? { dist, integrity: dist.integrity, shasum: dist.shasum } : null;
  } catch (error) {
    // npm uses E404 for a missing version. Any other failure (including
    // auth/network) is a hard failure, not evidence that publication is safe.
    if (isNpmNotFoundError(error)) return null;
    throw error;
  }
}

async function npmRegistryLatest({
  name,
  npmCommand = DEFAULT_NPM_COMMAND,
  npmTimeoutMs = DEFAULT_NPM_TIMEOUT_MS,
  command = execFileSync,
}) {
  try {
    const output = runCommand(
      npmCommand,
      ['view', name, 'dist-tags.latest', '--json', '--registry', NPM_REGISTRY],
      {
        env: {
          ...process.env,
          NPM_CONFIG_AUDIT: 'false',
          NPM_CONFIG_FUND: 'false',
          NPM_CONFIG_OFFLINE: 'false',
        },
        timeout: npmTimeoutMs,
      },
      command
    );
    if (!String(output).trim() || String(output).trim() === 'null') return null;
    return JSON.parse(output);
  } catch (error) {
    // Only an explicit npm E404 means that this package has no latest tag.
    if (isNpmNotFoundError(error)) return null;
    throw error;
  }
}

async function npmRegistryPublish({
  tarball,
  npmCommand = DEFAULT_NPM_COMMAND,
  npmTimeoutMs = DEFAULT_NPM_TIMEOUT_MS,
  command = execFileSync,
}) {
  return runCommand(
    npmCommand,
    ['publish', tarball, '--access', 'public', '--provenance', '--registry', NPM_REGISTRY],
    {
      env: {
        ...process.env,
        NPM_CONFIG_AUDIT: 'false',
        NPM_CONFIG_FUND: 'false',
        NPM_CONFIG_OFFLINE: 'false',
      },
      timeout: npmTimeoutMs,
    },
    command
  );
}

export function createNpmTransport({
  npmCommand = DEFAULT_NPM_COMMAND,
  npmTimeoutMs = DEFAULT_NPM_TIMEOUT_MS,
  command = execFileSync,
} = {}) {
  return {
    inspect: (request) => npmRegistryInspect({ ...request, npmCommand, npmTimeoutMs, command }),
    latest: (request) => npmRegistryLatest({ ...request, npmCommand, npmTimeoutMs, command }),
    publish: (request) => npmRegistryPublish({ ...request, npmCommand, npmTimeoutMs, command }),
  };
}

function parseCli(argv) {
  const options = {
    outputDir: undefined,
    sourceSHA: undefined,
    version: undefined,
    verifyOnly: false,
    dryRun: false,
    publish: false,
    smoke: true,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--publish') options.publish = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--verify-only') options.verifyOnly = true;
    else if (arg === '--no-smoke') options.smoke = false;
    else if (arg === '--output-dir' || arg === '--artifacts-dir') options.outputDir = argv[++index];
    else if (arg === '--source-sha') options.sourceSHA = argv[++index];
    else if (arg === '--version') options.version = argv[++index];
    else throw new ReleaseArtifactError(`Unknown option: ${arg}`, 'ERR_USAGE');
  }
  return options;
}

function usage() {
  return [
    'Usage: node scripts/release-artifacts.mjs [options]',
    '',
    'Default: build, hash, verify, and locally install-smoke root and alias tarballs.',
    '  --verify-only              verify existing tarballs and manifest; never pack source',
    '  --dry-run                  explicit no-publish mode (the default)',
    '  --publish                  publish verified tarballs with timeout recovery',
    '  --output-dir <dir>         artifact directory (default .release-artifacts)',
    '  --source-sha <sha>         source commit recorded in the manifest',
    '  --version <version>        expected package version during verification',
    '  --no-smoke                  skip local install smoke (not for release verify)',
    '  --help                     show this help',
  ].join('\n');
}

export async function main(argv = process.argv.slice(2), {
  repoRoot = REPO_ROOT,
  env = process.env,
  npmCommand = DEFAULT_NPM_COMMAND,
  npmTimeoutMs = DEFAULT_NPM_TIMEOUT_MS,
  command = execFileSync,
  transport,
  stdout = process.stdout,
} = {}) {
  const options = parseCli(argv);
  if (options.help) {
    stdout.write(`${usage()}\n`);
    return 0;
  }
  if (options.publish && options.dryRun) {
    throw new ReleaseArtifactError('--publish and --dry-run cannot be combined', 'ERR_USAGE');
  }
  const outputDir = resolve(repoRoot, options.outputDir || '.release-artifacts');
  const sourceSHA = options.sourceSHA || env.GITHUB_SHA;
  let verified;
  if (options.verifyOnly || options.publish) {
    verified = verifyReleaseArtifacts({
      repoRoot,
      outputDir,
      sourceSHA,
      expectedVersion: options.version,
      command,
    });
  } else {
    const built = buildReleaseArtifacts({
      repoRoot,
      outputDir,
      sourceSHA,
      npmCommand,
      npmTimeoutMs,
      command,
    });
    verified = verifyReleaseArtifacts({
      repoRoot,
      outputDir,
      sourceSHA: built.manifest.sourceSHA,
      expectedVersion: options.version,
      command,
    });
    if (options.smoke) {
      runLocalInstallSmoke({
        outputDir,
        artifacts: verified.artifacts,
        npmCommand,
        npmTimeoutMs,
        command,
      });
    }
    stdout.write(`Verified ${built.manifest.version} release artifacts at ${outputDir}\n`);
  }
  if (options.publish) {
    const result = await publishWithRecovery({
      version: verified.manifest.version,
      expectedVersion: options.version,
      sourceSHA,
      artifacts: verified.artifacts,
      transport: transport || createNpmTransport({ npmCommand, npmTimeoutMs, command }),
    });
    stdout.write(`Published ${verified.manifest.version}: ${JSON.stringify(result.states)}\n`);
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  );
}
