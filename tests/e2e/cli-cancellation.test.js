import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { strict as assert } from 'node:assert';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');
const BIN = resolve(REPO_ROOT, 'bin/patina.js');

test('SIGINT cancels an in-flight HTTP backend request and exits 130', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'patina-sigint-'));
  const inputPath = join(dir, 'input.txt');
  writeFileSync(inputPath, 'This draft should wait on the mock backend.\n');

  let sawRequest;
  const requestSeen = new Promise((resolveRequest) => {
    sawRequest = resolveRequest;
  });
  const server = createServer((req) => {
    req.resume();
    sawRequest();
    // Keep the response open so SIGINT has an in-flight fetch to abort.
  });

  try {
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
    const port = server.address().port;
    const child = spawn(process.execPath, [
      BIN,
      '--lang', 'en',
      '--api-key', 'test-key',
      '--base-url', `http://127.0.0.1:${port}`,
      '--model', 'gpt-5',
      inputPath,
    ], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    await requestSeen;
    child.kill('SIGINT');

    const { code } = await new Promise((resolveClose) => {
      child.on('close', (closeCode, signal) => resolveClose({ code: closeCode, signal }));
    });

    assert.equal(code, 130);
    assert.equal(stdout, '');
    assert.match(stderr, /\[patina\] cancelling…/);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
    rmSync(dir, { recursive: true, force: true });
  }
}, { timeout: 10000 });
