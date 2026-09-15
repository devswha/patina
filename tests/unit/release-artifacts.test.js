import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  buildReleaseArtifacts,
  ReleaseArtifactError,
  canPromoteLatest,
  classifyGithubReleaseLookup,
  compareSemver,
  createIntegrityManifest,
  decideGithubReleaseAction,
  hashBytes,
  main,
  parseGithubApiJson,
  parseGithubApiStatus,
  parseGithubReleaseTag,
  parseSemver,
  publishWithRecovery,
  createNpmTransport,
  runLocalInstallSmoke,
  verifyReleaseArtifacts,
} from '../../scripts/release-artifacts.mjs';

const ROOT = {
  key: 'root',
  name: 'patina-cli',
  file: 'patina-cli-8.6.0.tgz',
  size: 10,
  sha256: 'root-sha256',
  sha512: 'root-sha512',
  integrity: 'sha512-cm9vdC1zaGE1MTI=',
  files: [{ path: 'package.json', size: 100 }],
};
const ALIAS = {
  key: 'alias',
  name: 'patina-humanizer',
  file: 'patina-humanizer-8.6.0.tgz',
  size: 11,
  sha256: 'alias-sha256',
  sha512: 'alias-sha512',
  integrity: 'sha512-YWxpYXM=',
  files: [{ path: 'package.json', size: 100 }],
};

test('build refuses a nonempty caller output directory', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'patina-release-output-'));
  try {
    writeFileSync(join(outputDir, 'caller-owned.txt'), 'do not delete');
    assert.throws(
      () => buildReleaseArtifacts({ outputDir, sourceSHA: 'test-source-sha' }),
      (error) => error?.code === 'ERR_OUTPUT_DIR_NOT_EMPTY'
    );
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test('CLI rejects contradictory publish and dry-run modes', async () => {
  await assert.rejects(
    main(['--publish', '--dry-run'], { stdout: { write() {} } }),
    (error) => error?.code === 'ERR_USAGE'
  );
});

test('local smoke refuses a nonempty caller fixture directory', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'patina-release-output-'));
  const fixtureDir = mkdtempSync(join(tmpdir(), 'patina-release-fixture-'));
  try {
    writeFileSync(join(fixtureDir, 'caller-owned.txt'), 'do not delete');
    assert.throws(
      () => runLocalInstallSmoke({
        outputDir,
        fixtureDir,
        artifacts: [
          { ...ROOT, path: join(outputDir, ROOT.file) },
          { ...ALIAS, path: join(outputDir, ALIAS.file) },
        ],
      }),
      (error) => error?.code === 'ERR_SMOKE_DIR_NOT_EMPTY'
    );
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});

test('release verification rejects symlinked manifest and tarball paths', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'patina-release-paths-'));
  const outsideDir = mkdtempSync(join(tmpdir(), 'patina-release-outside-'));
  try {
    const manifestPath = join(outputDir, 'release-manifest.json');
    writeFileSync(join(outsideDir, 'release-manifest.json'), '{}\n');
    symlinkSync(join(outsideDir, 'release-manifest.json'), manifestPath);
    assert.throws(
      () => verifyReleaseArtifacts({ outputDir, sourceSHA: 'unit-source-sha' }),
      (error) => error?.code === 'ERR_MANIFEST'
    );
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('integrity helpers produce both hashes and SRI', () => {
  const actual = hashBytes('release bytes');
  assert.equal(actual.sha256.length, 64);
  assert.equal(actual.sha512.length, 128);
  assert.match(actual.integrity, /^sha512-[A-Za-z0-9+/]+=*$/);
  const manifest = createIntegrityManifest({
    sourceSHA: 'abc123',
    version: '8.6.0',
    artifacts: [ROOT, ALIAS],
  });
  assert.equal(manifest.sourceSHA, 'abc123');
  assert.equal(manifest.version, '8.6.0');
  assert.deepEqual(Object.keys(manifest.packages).sort(), ['alias', 'root']);
  assert.equal(manifest.files.length, 2);
});

test('semantic version comparison handles numeric and prerelease ordering', () => {
  assert.equal(compareSemver('1.10.0', '1.9.0'), 1);
  assert.equal(compareSemver('2.0.0-rc.2', '2.0.0-rc.10'), -1);
  assert.equal(compareSemver('2.0.0', '2.0.0-rc.10'), 1);
  assert.equal(parseSemver('v8.6.0+build.1'), '8.6.0');
  assert.equal(canPromoteLatest({ candidateVersion: '8.5.0', currentLatestVersion: '8.6.0' }), false);
  assert.equal(canPromoteLatest({ candidateVersion: '8.6.0', currentLatestVersion: '8.6.0' }), true);
});

test('GitHub release action preserves existing releases and guards latest monotonicity', () => {
  assert.equal(decideGithubReleaseAction({
    candidateVersion: '8.6.0',
    currentLatestVersion: '8.7.0',
    existingRelease: true,
  }), 'edit');
  assert.equal(decideGithubReleaseAction({
    candidateVersion: '8.6.0',
    currentLatestVersion: '8.7.0',
  }), 'create-not-latest');
  assert.equal(decideGithubReleaseAction({
    candidateVersion: '8.7.0',
    currentLatestVersion: '8.7.0',
  }), 'create-latest');
  assert.equal(decideGithubReleaseAction({ candidateVersion: '8.8.0' }), 'create-latest');
  assert.throws(
    () => decideGithubReleaseAction({ candidateVersion: 'release-head' }),
    (error) => error?.code === 'ERR_INVALID_VERSION'
  );
});

test('GitHub API release lookups accept only explicit 404 as absence', () => {
  assert.equal(classifyGithubReleaseLookup({ httpStatus: 404, commandStatus: 1 }), 'absent');
  assert.equal(classifyGithubReleaseLookup({ httpStatus: 200, commandStatus: 0 }), 'present');
  for (const failure of [
    { httpStatus: undefined, commandStatus: 1 },
    { httpStatus: 401, commandStatus: 1 },
    { httpStatus: 500, commandStatus: 0 },
    { httpStatus: 200, commandStatus: 1 },
  ]) {
    assert.throws(
      () => classifyGithubReleaseLookup(failure),
      (error) => error?.code === 'ERR_GITHUB_RELEASE_LOOKUP'
    );
  }
});

test('GitHub API response helpers parse latest tag and reject malformed bodies', () => {
  const response = [
    'HTTP/2 200 OK',
    'content-type: application/json',
    '',
    JSON.stringify({ tag_name: 'v8.7.0' }),
  ].join('\n');
  assert.equal(parseGithubApiStatus(response), 200);
  assert.deepEqual(parseGithubApiJson(response), { tag_name: 'v8.7.0' });
  assert.equal(parseGithubReleaseTag('v8.7.0'), '8.7.0');
  assert.throws(
    () => parseGithubApiJson('HTTP/2 200 OK\n\nnot-json'),
    (error) => error?.code === 'ERR_GITHUB_RELEASE_RESPONSE'
  );
  assert.throws(
    () => parseGithubReleaseTag('latest'),
    (error) => error?.code === 'ERR_INVALID_VERSION'
  );

  const crlfResponse = [
    'HTTP/2 200 OK',
    'content-type: application/json',
    '',
    JSON.stringify({ tag_name: 'v8.8.0' }),
  ].join('\r\n');
  assert.equal(parseGithubApiStatus(crlfResponse), 200);
  assert.deepEqual(parseGithubApiJson(crlfResponse), { tag_name: 'v8.8.0' });
  assert.throws(
    () => parseGithubApiStatus([
      'HTTP/2 302 Found',
      '',
      'HTTP/2 200 OK',
      '',
      JSON.stringify({ tag_name: 'v8.8.0' }),
    ].join('\r\n')),
    (error) => error?.code === 'ERR_GITHUB_RELEASE_RESPONSE'
  );
});

test('root success and alias timeout retry only the alias', async () => {
  const registry = new Map();
  const calls = [];
  let aliasAttempts = 0;
  const transport = {
    async inspect({ name }) {
      return registry.get(name) || null;
    },
    async latest() {
      return null;
    },
    async publish({ name, artifact }) {
      calls.push(name);
      if (name === 'patina-humanizer' && aliasAttempts++ === 0) {
        const error = new Error('registry timeout');
        error.code = 'ETIMEDOUT';
        throw error;
      }
      registry.set(name, {
        integrity: artifact.integrity,
        sha256: artifact.sha256,
        sha512: artifact.sha512,
      });
    },
  };
  const result = await publishWithRecovery({
    version: '8.6.0',
    expectedVersion: '8.6.0',
    sourceSHA: 'unit-source-sha',
    artifacts: [ROOT, ALIAS],
    transport,
  });
  assert.deepEqual(result.states, { root: 'done', alias: 'done' });
  assert.deepEqual(result.attempts, { root: 1, alias: 2 });
  assert.deepEqual(result.retries, { root: 0, alias: 1 });
  assert.deepEqual(calls, ['patina-cli', 'patina-humanizer', 'patina-humanizer']);
});

test('timeout registry inspection fails closed on mismatched bytes', async () => {
  const registry = new Map();
  let aliasPublishAttempts = 0;
  const transport = {
    async inspect({ name }) {
      return registry.get(name) || null;
    },
    async latest() {
      return null;
    },
    async publish({ name, artifact }) {
      if (name === 'patina-cli') {
        registry.set(name, artifact);
        return;
      }
      if (aliasPublishAttempts++ > 0) return;
      const error = new Error('timeout');
      error.timedOut = true;
      throw error;
    },
  };
  let aliasInspections = 0;
  const originalInspect = transport.inspect;
  transport.inspect = async (request) => {
    if (request.name === 'patina-humanizer') {
      aliasInspections += 1;
      if (aliasInspections === 2) return { integrity: 'sha512-wrong' };
    }
    return originalInspect(request);
  };
  await assert.rejects(
    publishWithRecovery({
      version: '8.6.0',
      expectedVersion: '8.6.0',
      sourceSHA: 'unit-source-sha',
      artifacts: [ROOT, ALIAS],
      transport,
    }),
    (error) => error instanceof ReleaseArtifactError
      && error.code === 'ERR_REGISTRY_INTEGRITY_MISMATCH'
      && error.details?.states?.root === 'done'
      && error.details?.states?.alias === 'failed'
  );
});

test('timeout with exact registry integrity is treated as completed', async () => {
  let aliasInspections = 0;
  const transport = {
    async inspect({ name }) {
      if (name === 'patina-cli') {
        return {
          integrity: ROOT.integrity,
          sha256: ROOT.sha256,
          sha512: ROOT.sha512,
        };
      }
      aliasInspections += 1;
      if (aliasInspections === 2) {
        return {
          integrity: ALIAS.integrity,
          sha256: ALIAS.sha256,
          sha512: ALIAS.sha512,
        };
      }
      return null;
    },
    async latest() {
      return null;
    },
    async publish({ name }) {
      if (name === 'patina-cli') return;
      const error = new Error('request timeout');
      error.code = 'ETIMEDOUT';
      throw error;
    },
  };
  const result = await publishWithRecovery({
    version: '8.6.0',
    expectedVersion: '8.6.0',
    sourceSHA: 'unit-source-sha',
    artifacts: [ROOT, ALIAS],
    transport,
  });
  assert.deepEqual(result.states, { root: 'done', alias: 'done' });
  assert.equal(result.attempts.alias, 1);
});

test('an existing exact version is recognized as done without republishing', async () => {
  const calls = [];
  const transport = {
    async inspect({ name }) {
      const artifact = name === ROOT.name ? ROOT : ALIAS;
      return {
        integrity: artifact.integrity,
        sha256: artifact.sha256,
        sha512: artifact.sha512,
      };
    },
    async latest() {
      return null;
    },
    async publish(request) {
      calls.push(request.name);
    },
  };
  const result = await publishWithRecovery({
    version: '8.6.0',
    expectedVersion: '8.6.0',
    sourceSHA: 'unit-source-sha',
    artifacts: [ROOT, ALIAS],
    transport,
  });
  assert.deepEqual(result.states, { root: 'done', alias: 'done' });
  assert.deepEqual(calls, []);
});

test('stale versions cannot promote latest', async () => {
  let publishes = 0;
  await assert.rejects(
    publishWithRecovery({
      version: '8.5.0',
      expectedVersion: '8.5.0',
      sourceSHA: 'unit-source-sha',
      artifacts: [ROOT, ALIAS],
      transport: {
        async inspect() {
          return null;
        },
        async latest() {
          return '8.6.0';
        },
        async publish() {
          publishes += 1;
        },
      },
    }),
    (error) => error?.code === 'ERR_STALE_LATEST'
  );
  assert.equal(publishes, 0);
});

test('latest inspection is per package before each publish', async () => {
  const latestCalls = [];
  const published = [];
  const registry = new Map();
  const transport = {
    async inspect({ name }) {
      return registry.get(name) || null;
    },
    async latest({ name }) {
      latestCalls.push(name);
      return name === ROOT.name ? '8.6.0' : '8.5.0';
    },
    async publish({ name, artifact }) {
      published.push(name);
      registry.set(name, {
        integrity: artifact.integrity,
        sha256: artifact.sha256,
        sha512: artifact.sha512,
      });
    },
  };
  const result = await publishWithRecovery({
    version: '8.6.0',
    expectedVersion: '8.6.0',
    sourceSHA: 'unit-source-sha',
    artifacts: [ROOT, ALIAS],
    transport,
  });
  assert.deepEqual(result.states, { root: 'done', alias: 'done' });
  assert.deepEqual(latestCalls, [ROOT.name, ALIAS.name]);
  assert.deepEqual(published, [ROOT.name, ALIAS.name]);
});

test('npm transport maps wrapped exec timeout and passes a bounded timeout', async () => {
  const calls = [];
  const transport = createNpmTransport({
    npmTimeoutMs: 1234,
    command(_command, args, options) {
      calls.push({ args, timeout: options.timeout });
      if (args[0] === 'view') return 'null';
      const error = new Error('spawnSync npm ETIMEDOUT');
      error.signal = 'SIGTERM';
      error.killed = true;
      throw error;
    },
  });
  await assert.rejects(
    publishWithRecovery({
      version: '8.6.0',
      expectedVersion: '8.6.0',
      sourceSHA: 'unit-source-sha',
      artifacts: [ROOT, ALIAS],
      transport,
    }),
    (error) => error?.code === 'ERR_COMMAND_TIMEOUT'
      && error.details?.cause?.signal === 'SIGTERM'
      && error.details?.cause?.killed === true
  );
  assert.ok(calls.every(({ timeout }) => timeout === 1234));
});

test('npm E404 is the only missing-package response accepted by registry transport', async () => {
  const notFound = createNpmTransport({
    command(_command, args) {
      if (args[0] === 'view') {
        const error = new Error('registry response');
        error.code = 'E404';
        throw error;
      }
      return '';
    },
  });
  assert.equal(await notFound.inspect({ name: ROOT.name, version: '8.6.0' }), null);
  assert.equal(await notFound.latest({ name: ROOT.name }), null);

  const ambiguous = createNpmTransport({
    command() {
      throw new Error('package not found in local mirror');
    },
  });
  await assert.rejects(
    ambiguous.inspect({ name: ROOT.name, version: '8.6.0' }),
    (error) => error?.code === 'ERR_COMMAND'
  );
});

test('malformed latest inspection fails closed', async () => {
  await assert.rejects(
    publishWithRecovery({
      version: '8.6.0',
      expectedVersion: '8.6.0',
      sourceSHA: 'unit-source-sha',
      artifacts: [ROOT, ALIAS],
      transport: {
        async inspect() {
          return null;
        },
        async latest() {
          return {};
        },
        async publish() {
          assert.fail('malformed latest must prevent publish');
        },
      },
    }),
    (error) => error?.code === 'ERR_LATEST_RESPONSE'
  );
});

test('publication requires trusted source and expected version anchors', async () => {
  const transport = {
    async inspect() { return null; },
    async latest() { return null; },
    async publish() { assert.fail('missing anchors must fail before publish'); },
  };
  await assert.rejects(
    publishWithRecovery({ version: '8.6.0', expectedVersion: '8.6.0', artifacts: [ROOT, ALIAS], transport }),
    (error) => error?.code === 'ERR_SOURCE_SHA'
  );
  await assert.rejects(
    publishWithRecovery({ version: '8.6.0', sourceSHA: 'unit-source-sha', artifacts: [ROOT, ALIAS], transport }),
    (error) => error?.code === 'ERR_VERSION'
  );
  await assert.rejects(
    publishWithRecovery({
      version: '8.6.0',
      expectedVersion: '8.5.0',
      sourceSHA: 'unit-source-sha',
      artifacts: [ROOT, ALIAS],
      transport,
    }),
    (error) => error?.code === 'ERR_VERSION_MISMATCH'
  );
});

test('verification requires a trusted source anchor', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'patina-release-source-'));
  try {
    assert.throws(
      () => verifyReleaseArtifacts({ outputDir }),
      (error) => error?.code === 'ERR_SOURCE_SHA'
    );
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test('registry inspection failures preserve publication state details', async () => {
  let inspections = 0;
  await assert.rejects(
    publishWithRecovery({
      version: '8.6.0',
      expectedVersion: '8.6.0',
      sourceSHA: 'unit-source-sha',
      artifacts: [ROOT, ALIAS],
      transport: {
        async inspect() {
          inspections += 1;
          if (inspections === 1) return null;
          throw Object.assign(new Error('registry unavailable'), { code: 'ECONNRESET' });
        },
        async latest() { return null; },
        async publish() {},
      },
    }),
    (error) => error?.code === 'ECONNRESET'
      && error.details?.registryInspectionPhase === 'post-publish inspection'
      && error.details?.states?.root === 'failed'
      && error.details?.attempts?.root === 1
      && error.details?.retries?.root === 0
  );
});
