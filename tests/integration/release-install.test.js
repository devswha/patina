import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildReleaseArtifacts, verifyReleaseArtifacts, runLocalInstallSmoke } from '../../scripts/release-artifacts.mjs';

// Explicit registry-backed profile; excluded from the offline unit/e2e glob.
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
