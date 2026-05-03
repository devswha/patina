import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const name = 'codex-cli';

export function isAvailable() {
  try {
    const result = spawnSync('codex', ['--version'], { stdio: 'ignore' });
    return result.status === 0;
  } catch {
    return false;
  }
}

export async function invoke({ prompt, timeout = 180000 } = {}) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('codex-cli backend: prompt must be a non-empty string');
  }

  const dir = mkdtempSync(join(tmpdir(), 'patina-codex-'));
  const outFile = join(dir, 'last-message.txt');

  return new Promise((resolve, reject) => {
    const proc = spawn('codex', [
      'exec',
      '--skip-git-repo-check',
      '--output-last-message', outFile,
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk; });

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      cleanup();
      reject(new Error(`codex-cli backend: timed out after ${timeout}ms`));
    }, timeout);

    proc.on('error', (err) => {
      clearTimeout(timer);
      cleanup();
      if (err.code === 'ENOENT') {
        reject(new Error('codex-cli backend: `codex` CLI not found. Install it from https://github.com/openai/codex'));
      } else {
        reject(new Error(`codex-cli backend: failed to spawn codex (${err.message})`));
      }
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        cleanup();
        reject(new Error(`codex-cli backend: codex exited with code ${code}\n${stderr}`));
        return;
      }

      try {
        const content = readFileSync(outFile, 'utf8');
        cleanup();
        resolve(content);
      } catch (err) {
        cleanup();
        reject(new Error(`codex-cli backend: failed to read output file (${err.message})`));
      }
    });

    proc.stdin.write(prompt);
    proc.stdin.end();

    function cleanup() {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  });
}

