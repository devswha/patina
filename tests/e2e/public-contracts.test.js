import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, it } from 'node:test';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BIN = resolve(REPO_ROOT, 'bin/patina.js');
const temporaryRoots = [];

afterEach(async () => {
  while (temporaryRoots.length) await rm(temporaryRoots.pop(), { recursive: true, force: true });
});

function runCli(args, { cwd, input = '' } = {}) {
  const env = {
    ...process.env,
    HOME: cwd,
    USERPROFILE: cwd,
    XDG_CONFIG_HOME: join(cwd, '.config'),
    PATINA_API_KEY: '',
    PATINA_API_KEY_FILE: '',
    PATINA_API_BASE: '',
    PATINA_MODEL: '',
  };
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', rejectPromise);
    child.once('close', (status) => resolvePromise({ status, stdout, stderr }));
    child.stdin.end(input);
  });
}

function assertInspectPayload(payload) {
  assert.equal(payload.schemaVersion, 1);
  assert.equal(typeof payload.language, 'string');
  assert.match(payload.sourceHash, /^[a-f0-9]{64}$/);
  assert.equal(payload.deterministicOnly, true);
  assert.equal(payload.offsetEncoding, 'utf-16');
  assert.equal(typeof payload.available, 'boolean');
  assert.ok(payload.score === null || Number.isFinite(payload.score));
  assert.ok(Array.isArray(payload.diagnostics));
  if (payload.available) {
    assert.equal(typeof payload.paragraphCount, 'number');
    assert.equal(typeof payload.diagnosticsTruncated, 'boolean');
  }
}

describe('public CLI contracts', () => {
  it('consumes inspect JSON and its documented success exit code', async () => {
    const root = await mkdtemp(join(tmpdir(), 'patina-public-contract-'));
    temporaryRoots.push(root);
    const input = 'A small service started in 2026 and serves a local team.\n';
    const inputPath = join(root, 'draft.txt');
    const configPath = join(root, 'config.yaml');
    await writeFile(inputPath, input);
    await writeFile(configPath, 'language: en\n');

    const result = await runCli([
      'inspect',
      '--lang', 'en',
      '--config', configPath,
      inputPath,
    ], { cwd: root });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, '');
    const payload = JSON.parse(result.stdout);
    assertInspectPayload(payload);
    assert.equal(payload.language, 'en');
    assert.equal(payload.sourceHash, createHash('sha256').update(input).digest('hex'));
    assert.equal(payload.deterministicOnly, true);
  });

  it('rejects a retired config key with the public input-error exit code', async () => {
    const root = await mkdtemp(join(tmpdir(), 'patina-retired-config-'));
    temporaryRoots.push(root);
    const inputPath = join(root, 'draft.txt');
    const configPath = join(root, 'retired.yaml');
    await writeFile(inputPath, 'A stable fixture sentence.\n');
    await writeFile(configPath, 'language: en\nprofile: blog\n');

    const result = await runCli([
      'inspect',
      '--config', configPath,
      inputPath,
    ], { cwd: root });

    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /config key ['"]profile['"] was removed/);
  });

  it('fails closed when a consumer receives a malformed inspect payload', () => {
    assert.throws(
      () => assertInspectPayload({
        schemaVersion: 1,
        language: 'en',
        sourceHash: '0'.repeat(64),
        deterministicOnly: true,
        offsetEncoding: 'utf-16',
        available: true,
        score: 0,
        paragraphCount: 1,
        diagnosticsTruncated: false,
        diagnostics: { not: 'an array' },
      }),
      /Array|array/,
    );
  });
});
