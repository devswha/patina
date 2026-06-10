import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_BACKEND_TIMEOUT_MS, runInteractiveCommand } from './contract.js';
import { resolveLocalCliModel } from '../model-defaults.js';

export const name = 'gemini-cli';
export const loginCommand = 'gemini';
export const installHint = 'Install Gemini CLI first, then run `patina auth login gemini-cli` again.';

export function isAvailable() {
  try {
    const result = spawnSync('gemini', ['--version'], { stdio: 'ignore' });
    return result.status === 0;
  } catch {
    return false;
  }
}

export function isAuthenticated() {
  // Two valid auth paths: OAuth (Code Assist) or API key. Either is enough
  // for `gemini -p` to run; checking both avoids false negatives.
  return (
    existsSync(join(homedir(), '.gemini', 'gemini-credentials.json')) ||
    !!process.env.GEMINI_API_KEY
  );
}

export function authHint() {
  if (process.env.GEMINI_API_KEY) {
    return 'Authenticated via GEMINI_API_KEY env var.';
  }
  return `Run \`${loginCommand}\` once interactively to log in via Google OAuth, or set GEMINI_API_KEY.`;
}

export function login(options = {}) {
  return runInteractiveCommand({
    backendName: name,
    command: 'gemini',
    args: [],
    notFoundHint: installHint,
    ...options,
  });
}

export async function invoke({ prompt, model, modelSource, signal, timeout = DEFAULT_BACKEND_TIMEOUT_MS } = {}) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('gemini-cli backend: prompt must be a non-empty string');
  }
  throwIfAborted(signal);

  // gemini -p '' reads the prompt from stdin (when -p arg is empty, stdin is
  // appended). --output-format text avoids JSON wrapping. Spawn from a temp
  // directory for the same prompt-injection containment reason as codex-cli;
  // --skip-trust is required because the temp dir isn't in gemini's trusted
  // workspace list (otherwise gemini exits 55).
  const dir = mkdtempSync(join(tmpdir(), 'patina-gemini-'));
  const cliModel = resolveLocalCliModel({ backendName: name, model, modelSource });
  const args = ['-p', '', '--output-format', 'text', '--skip-trust', '-m', cliModel];

  return new Promise((resolve, reject) => {
    const proc = spawn('gemini', args, { stdio: ['pipe', 'pipe', 'pipe'], cwd: dir });

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
    const timer = setTimeout(() => {
      finishReject(new Error(`gemini-cli backend: timed out after ${timeout}ms`), { kill: true });
    }, timeout);
    if (signal) {
      const onAbort = () => finishReject(abortError('gemini-cli backend: aborted'), { kill: true });
      signal.addEventListener('abort', onAbort, { once: true });
      cleanupSignal = () => signal.removeEventListener('abort', onAbort);
    }

    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        finishReject(new Error('gemini-cli backend: `gemini` CLI not found. Install Gemini CLI first.'));
      } else {
        finishReject(new Error(`gemini-cli backend: failed to spawn gemini (${err.message})`));
      }
    });

    proc.on('close', (code) => {
      if (settled) return;
      if (code !== 0) {
        finishReject(new Error(`gemini-cli backend: gemini exited with code ${code}\n${stderr}`));
        return;
      }
      finishResolve(stripGeminiNoise(stdout));
    });

    // A child that exits before draining a large prompt makes the buffered
    // stdin write fail with EPIPE; without a handler that becomes an unhandled
    // 'error' event that crashes the process. Ignore EPIPE (the 'close' handler
    // surfaces the real exit code + stderr); reject on anything else.
    proc.stdin.on('error', (err) => {
      if (err && err.code !== 'EPIPE') {
        finishReject(new Error(`gemini-cli backend: stdin error (${err.message})`));
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
  if (signal?.aborted) throw abortError('gemini-cli backend: aborted');
}

// Gemini CLI prepends benign warnings to stdout (e.g. "Ripgrep is not
// available. Falling back to GrepTool.", "MCP issues detected..."). They
// aren't part of the model's response, so strip leading lines that match
// known noise patterns before returning.
function stripGeminiNoise(text) {
  const lines = text.split(/\r?\n/);
  const noiseRe = /^(Warning:|Ripgrep is not available|MCP issues detected|Loaded cached credentials)/i;
  let i = 0;
  while (i < lines.length && (noiseRe.test(lines[i]) || lines[i].trim() === '')) {
    i++;
  }
  return lines.slice(i).join('\n');
}
