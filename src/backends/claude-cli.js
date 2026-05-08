import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export const name = 'claude-cli';

export function isAvailable() {
  try {
    const result = spawnSync('claude', ['--version'], { stdio: 'ignore' });
    return result.status === 0;
  } catch {
    return false;
  }
}

export function isAuthenticated() {
  // Claude Code stores OAuth tokens in ~/.claude/.credentials.json after the
  // first interactive login. The path is consistent across platforms when the
  // CLI is installed via the standard installer.
  return existsSync(join(homedir(), '.claude', '.credentials.json'));
}

export function authHint() {
  return 'Run `claude` once interactively and follow the OAuth prompt to authenticate (uses your Claude subscription, no API key needed).';
}

export async function invoke({ prompt, timeout = 180000 } = {}) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('claude-cli backend: prompt must be a non-empty string');
  }

  // Spawn from a fresh temp directory so a prompt-injection in user text
  // cannot read or write inside the caller's repo. claude -p prints to
  // stdout, so no output file plumbing is needed (unlike codex-cli).
  const dir = mkdtempSync(join(tmpdir(), 'patina-claude-'));

  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['-p'], { stdio: ['pipe', 'pipe', 'pipe'], cwd: dir });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', (chunk) => { stderr += chunk; });

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      cleanup();
      reject(new Error(`claude-cli backend: timed out after ${timeout}ms`));
    }, timeout);

    proc.on('error', (err) => {
      clearTimeout(timer);
      cleanup();
      if (err.code === 'ENOENT') {
        reject(new Error('claude-cli backend: `claude` CLI not found. Install Claude Code first.'));
      } else {
        reject(new Error(`claude-cli backend: failed to spawn claude (${err.message})`));
      }
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      cleanup();
      if (code !== 0) {
        reject(new Error(`claude-cli backend: claude exited with code ${code}\n${stderr}`));
        return;
      }
      resolve(stdout);
    });

    proc.stdin.write(prompt);
    proc.stdin.end();

    function cleanup() {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }
  });
}
