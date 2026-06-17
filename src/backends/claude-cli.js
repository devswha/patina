import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_BACKEND_TIMEOUT_MS, runInteractiveCommand, stageCliImages } from './contract.js';
import { resolveLocalCliModel } from '../model-defaults.js';

export const name = 'claude-cli';
export const supportsImages = true;
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

export async function invoke({ prompt, model, modelSource, signal, timeout = DEFAULT_BACKEND_TIMEOUT_MS, images } = {}) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('claude-cli backend: prompt must be a non-empty string');
  }
  throwIfAborted(signal);

  const cliModel = resolveLocalCliModel({ backendName: name, model, modelSource });

  // Spawn from a fresh temp directory so a prompt-injection in user text
  // cannot read or write inside the caller's repo. claude -p prints to
  // stdout, so no output file plumbing is needed (unlike codex-cli).
  const dir = mkdtempSync(join(tmpdir(), 'patina-claude-'));

  // Vision input: images are staged INTO the temp cwd — claude's in-cwd Read
  // tool is auto-allowed in print mode, while paths outside cwd would be
  // permission-denied (and granting them would weaken the containment above).
  let effectivePrompt = prompt;
  if (Array.isArray(images) && images.length > 0) {
    try {
      const staged = stageCliImages(dir, images);
      effectivePrompt = `${prompt}\n\nAttached image file(s) in the working directory: ${staged.map((f) => `./${f}`).join(', ')} — read them before answering.`;
    } catch (err) {
      // Runs before the Promise's cleanup; remove the temp dir and surface a
      // backend-shaped error instead of leaking it and escaping a raw fs error (#446).
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
      throw new Error(`claude-cli backend: failed to stage image input (${err.message})`);
    }
  }

  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['-p', '--model', cliModel], { stdio: ['pipe', 'pipe', 'pipe'], cwd: dir });

    let stdout = '';
    let stderr = '';
    // Decode with a streaming UTF-8 decoder so multi-byte CJK characters split
    // across pipe-read boundaries are not corrupted into U+FFFD.
    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');
    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', (chunk) => { stderr += chunk; });

    let settled = false;
    let cleanupSignal = () => {};
    // A non-finite timeout means "no timeout" — without this guard Node clamps
    // setTimeout(fn, Infinity) to 1ms and the child is SIGKILLed ~immediately (#527 H13).
    const timer = Number.isFinite(timeout)
      ? setTimeout(() => {
        finishReject(new Error(`claude-cli backend: timed out after ${timeout}ms`), { kill: true });
      }, timeout)
      : null;
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

    proc.on('close', (code, sig) => {
      if (settled) return;
      if (code !== 0) {
        // Signal death (OOM kill, external SIGTERM) yields code===null (#446).
        const how = code === null && sig ? `terminated by ${sig}` : `exited with code ${code}`;
        finishReject(new Error(`claude-cli backend: claude ${how}\n${stderr}`));
        return;
      }
      finishResolve(stdout);
    });

    // A child that exits before draining a large prompt makes the buffered
    // stdin write fail with EPIPE; without a handler that becomes an unhandled
    // 'error' event that crashes the process. Ignore EPIPE (the 'close' handler
    // surfaces the real exit code + stderr); reject on anything else.
    proc.stdin.on('error', (err) => {
      if (err && err.code !== 'EPIPE') {
        finishReject(new Error(`claude-cli backend: stdin error (${err.message})`), { kill: true });
      }
    });
    proc.stdin.write(effectivePrompt);
    proc.stdin.end();

    function cleanup() {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    }

    function finishReject(err, { kill = false } = {}) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanupSignal();
      // SIGKILL reaches only the direct child; grandchildren (workers/ripgrep/MCP)
      // are not in a killable group and may briefly outlive it — accepted leak (#446).
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
