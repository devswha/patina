import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_BACKEND_TIMEOUT_MS, runInteractiveCommand } from './contract.js';

export const name = 'claude-cli';
export const loginCommand = 'claude auth login';
export const installHint = 'Install Claude Code first, then run `patina auth login claude-cli` again.';

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
  return `Run \`${loginCommand}\` and follow the OAuth prompt to authenticate (uses your Claude subscription, no API key needed).`;
}

export function login(options = {}) {
  return runInteractiveCommand({
    backendName: name,
    command: 'claude',
    args: ['auth', 'login'],
    notFoundHint: installHint,
    ...options,
  });
}

export async function invoke({ prompt, model, modelSource, signal, timeout = DEFAULT_BACKEND_TIMEOUT_MS, logger } = {}) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('claude-cli backend: prompt must be a non-empty string');
  }
  throwIfAborted(signal);

  // The claude-cli backend runs `claude -p`, which uses whatever model the
  // logged-in Claude Code session is configured with; it does not accept a
  // model override here. Warn (don't fail) when the user explicitly asked for
  // a model so a `--model X` is not a silent no-op. Forwarding the model to the
  // CLI is left as future work. Only fires for explicit models, not the
  // default/undefined path (modelSource 'default' or unset).
  if (model && modelSource && modelSource !== 'default') {
    logger?.warn?.('backend.model.ignored', {
      message: `[patina] claude-cli backend ignores --model (${model}); it uses your logged-in Claude Code model. Use --backend gemini-cli or the HTTP provider path to choose a model.`,
    });
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

    let settled = false;
    let cleanupSignal = () => {};
    const timer = setTimeout(() => {
      finishReject(new Error(`claude-cli backend: timed out after ${timeout}ms`), { kill: true });
    }, timeout);
    if (signal) {
      const onAbort = () => finishReject(abortError('claude-cli backend: aborted'), { kill: true });
      signal.addEventListener('abort', onAbort, { once: true });
      cleanupSignal = () => signal.removeEventListener('abort', onAbort);
    }

    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        finishReject(new Error('claude-cli backend: `claude` CLI not found. Install Claude Code first.'));
      } else {
        finishReject(new Error(`claude-cli backend: failed to spawn claude (${err.message})`));
      }
    });

    proc.on('close', (code) => {
      if (settled) return;
      if (code !== 0) {
        finishReject(new Error(`claude-cli backend: claude exited with code ${code}\n${stderr}`));
        return;
      }
      finishResolve(stdout);
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
  if (signal?.aborted) throw abortError('claude-cli backend: aborted');
}
