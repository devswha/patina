import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_BACKEND_TIMEOUT_MS,
  runInteractiveCommand,
  spawnOwnedCliProcess,
  stageCliImages,
} from './contract.js';
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

function credentialsPath() {
  // Claude Code stores OAuth tokens in ~/.claude/.credentials.json after the
  // first interactive login. The path is consistent across platforms when the
  // CLI is installed via the standard installer.
  return join(homedir(), '.claude', '.credentials.json');
}

/**
 * Classify the Claude Code credentials file without touching the network.
 *
 * Claude Code keeps the file after a logout or a failed token refresh but
 * blanks the tokens and sets `expiresAt` to 0, so file presence alone reported
 * an expired session as authenticated (observed 2026-09-10 during the P17b
 * pilot). A session is usable when the access token is live, or when a live
 * refresh token lets the CLI mint a new one. Only positive, finite, past
 * timestamps count as expired; 0 or a missing timestamp means "unknown", not
 * "expired". An unrecognised layout keeps the old presence semantics so other
 * credential stores are not misreported.
 *
 * @param {string} file Credentials file path.
 * @param {number} [now=Date.now()] Comparison time in epoch milliseconds.
 * @returns {'missing'|'unreadable'|'expired'|'ok'} Credential state.
 */
export function readClaudeCredentialState(file, now = Date.now()) {
  if (!existsSync(file)) return 'missing';
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return 'unreadable';
  }
  const oauth = parsed?.claudeAiOauth;
  if (!oauth || typeof oauth !== 'object') return 'ok';
  const live = (token, expiresAt) => typeof token === 'string' && token.trim() !== ''
    && !(Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt <= now);
  return live(oauth.accessToken, oauth.expiresAt) || live(oauth.refreshToken, oauth.refreshTokenExpiresAt)
    ? 'ok'
    : 'expired';
}

export function isAuthenticated() {
  return readClaudeCredentialState(credentialsPath()) === 'ok';
}

export function authHint() {
  const state = readClaudeCredentialState(credentialsPath());
  if (state === 'expired') {
    return `Claude Code session expired or logged out; run \`${loginCommand}\` again (uses your Claude subscription, no API key needed).`;
  }
  if (state === 'unreadable') {
    return `Claude Code credentials file is not valid JSON; run \`${loginCommand}\` to recreate it.`;
  }
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
  //
  // A rewrite or score is a pure text transform, so the built-in tool set is
  // emptied (`--tools ""`) and the user's configured MCP servers are skipped
  // (`--strict-mcp-config` with no --mcp-config): source text that contains
  // instructions gets no tool to act on, no third-party MCP process starts
  // per call, and the request carries no tool definitions. Only the image
  // route keeps the Read tool, which is how claude ingests staged files.
  let effectivePrompt = prompt;
  const hasImages = Array.isArray(images) && images.length > 0;
  const tools = hasImages ? 'Read' : '';
  if (hasImages) {
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
    const { proc, terminate, waitForClose } = spawnOwnedCliProcess(
      'claude',
      ['-p', '--model', cliModel, '--tools', tools, '--strict-mcp-config'],
      { stdio: ['pipe', 'pipe', 'pipe'], cwd: dir },
    );

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
      if (kill) terminate('SIGKILL');
      waitForClose().then(() => {
        cleanup();
        reject(err);
      });
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
