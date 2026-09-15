import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  buildReleaseArtifacts,
  verifyReleaseArtifacts,
  runLocalInstallSmoke,
} from '../../scripts/release-artifacts.mjs';

test('real root and alias tarballs install together and run both CLIs', { timeout: 120_000 }, () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'patina-release-artifacts-'));
  try {
    const built = buildReleaseArtifacts({
      outputDir,
      sourceSHA: 'e2e-source-sha',
    });
    const verified = verifyReleaseArtifacts({
      outputDir,
      sourceSHA: 'e2e-source-sha',
      expectedVersion: built.manifest.version,
    });
    const smoke = runLocalInstallSmoke({
      outputDir,
      artifacts: verified.artifacts,
    });
    assert.deepEqual(smoke.versions, {
      root: `patina ${built.manifest.version}`,
      alias: `patina ${built.manifest.version}`,
    });
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test('real tarball verification rejects bytes changed after the manifest', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'patina-release-tamper-'));
  try {
    const built = buildReleaseArtifacts({
      outputDir,
      sourceSHA: 'e2e-source-sha',
    });
    writeFileSync(built.artifacts[0].path, Buffer.concat([
      Buffer.from('tampered\n'),
      Buffer.from('not-the-release-tarball'),
    ]));
    assert.throws(
      () => verifyReleaseArtifacts({
        outputDir,
        sourceSHA: 'e2e-source-sha',
      }),
      (error) => error?.code === 'ERR_INTEGRITY_MISMATCH'
    );
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});

test('real tarball verification rejects a symlinked tarball outside the artifact root', () => {
  const outputDir = mkdtempSync(join(tmpdir(), 'patina-release-symlink-'));
  const outsideDir = mkdtempSync(join(tmpdir(), 'patina-release-symlink-target-'));
  try {
    const built = buildReleaseArtifacts({
      outputDir,
      sourceSHA: 'e2e-source-sha',
    });
    const artifact = built.artifacts[0];
    const outsidePath = join(outsideDir, artifact.file);
    rmSync(artifact.path);
    writeFileSync(outsidePath, 'outside artifact bytes');
    symlinkSync(outsidePath, artifact.path);
    assert.throws(
      () => verifyReleaseArtifacts({
        outputDir,
        sourceSHA: 'e2e-source-sha',
      }),
      (error) => error?.code === 'ERR_TARBALL'
    );
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});
