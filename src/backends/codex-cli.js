import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_BACKEND_TIMEOUT_MS, runInteractiveCommand } from './contract.js';
import { resolveLocalCliModel } from '../model-defaults.js';

export const name = 'codex-cli';
export const loginCommand = 'codex login';
export const installHint = 'Install it from https://github.com/openai/codex, then run `patina auth login codex-cli` again.';

export function isAvailable() {
  try {
    const result = spawnSync('codex', ['--version'], { stdio: 'ignore' });
    return result.status === 0;
  } catch {
    return false;
  }
}

export function isAuthenticated() {
  return existsSync(join(homedir(), '.codex', 'auth.json'));
}

export function authHint() {
  return `Run \`${loginCommand}\` to authenticate (uses your ChatGPT Plus account, no API key needed).`;
}

export function login(options = {}) {
  return runInteractiveCommand({
    backendName: name,
    command: 'codex',
    args: ['login'],
    notFoundHint: installHint,
    ...options,
  });
}

export async function invoke({ prompt, model, modelSource, signal, timeout = DEFAULT_BACKEND_TIMEOUT_MS } = {}) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('codex-cli backend: prompt must be a non-empty string');
  }
  throwIfAborted(signal);

  const cliModel = resolveLocalCliModel({ backendName: name, model, modelSource });

  // Run codex from a fresh temp directory with the read-only sandbox so that
  // a prompt-injection in user text cannot read the caller's repo or write
  // arbitrary files. The output file lives inside the same temp dir so codex
  // can still drop the last message there.
  const dir = mkdtempSync(join(tmpdir(), 'patina-codex-'));
  const outFile = join(dir, 'last-message.txt');

  return new Promise((resolve, reject) => {
    const proc = spawn('codex', [
      'exec',
      '--skip-git-repo-check',
      '--sandbox', 'read-only',
      '-C', dir,
      '--model', cliModel,
      '--output-last-message', outFile,
    ], { stdio: ['pipe', 'pipe', 'pipe'], cwd: dir });

    let stderr = '';
    proc.stderr.on('data', (chunk) => { stderr += chunk; });

    let settled = false;
    let cleanupSignal = () => {};
    const timer = setTimeout(() => {
      finishReject(new Error(`codex-cli backend: timed out after ${timeout}ms`), { kill: true });
    }, timeout);
    if (signal) {
      const onAbort = () => finishReject(abortError('codex-cli backend: aborted'), { kill: true });
      signal.addEventListener('abort', onAbort, { once: true });
      cleanupSignal = () => signal.removeEventListener('abort', onAbort);
    }

    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        finishReject(new Error('codex-cli backend: `codex` CLI not found. Install it from https://github.com/openai/codex'));
      } else {
        finishReject(new Error(`codex-cli backend: failed to spawn codex (${err.message})`));
      }
    });

    proc.on('close', (code) => {
      if (settled) return;
      if (code !== 0) {
        finishReject(new Error(`codex-cli backend: codex exited with code ${code}\n${stderr}`));
        return;
      }

      try {
        const content = readFileSync(outFile, 'utf8');
        finishResolve(content);
      } catch (err) {
        finishReject(new Error(`codex-cli backend: failed to read output file (${err.message})`));
      }
    });

    proc.stdin.write(prompt);
    proc.stdin.end();

    function cleanup() {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }

    function finishReject(err, { kill = false } = {}) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanupSignal();
      if (kill) proc.kill('SIGKILL');
      cleanup();
      reject(err);
    }

    function finishResolve(content) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanupSignal();
      cleanup();
      resolve(content);
    }
  });
}

function abortError(message) {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError('codex-cli backend: aborted');
}
