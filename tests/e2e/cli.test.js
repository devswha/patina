import { describe, it } from 'node:test';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

describe('CLI Entry Point', () => {
  it('bin/patina.js should exist and be executable', async () => {
    const fs = await import('node:fs');
    const binPath = resolve(REPO_ROOT, 'bin/patina.js');
    const stats = fs.statSync(binPath);
    assert.ok(stats.isFile());
    assert.ok(stats.mode & 0o111, 'Should be executable');
  });
});
