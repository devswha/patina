import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_BACKEND_TIMEOUT_MS,
  runInteractiveCommand,
  spawnOwnedCliProcess,
  stageCliImages,
} from './contract.js';
import { resolveLocalCliModel } from '../model-defaults.js';

export const name = 'gemini-cli';
export const supportsImages = true;
export const loginCommand = 'gemini';
export const installHint = 'Install Gemini CLI first, then run `patina auth login gemini-cli` again.';

// `--allowed-mcp-server-names` is an allowlist; naming one server that cannot
// exist is how the CLI expresses "no MCP servers".
const NO_MCP_SERVERS = '__patina_no_mcp__';

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
    !!process.env.GEMINI_API_KEY?.trim()
  );
}

export function authHint() {
  if (process.env.GEMINI_API_KEY?.trim()) {
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

export async function invoke({ prompt, model, modelSource, signal, timeout = DEFAULT_BACKEND_TIMEOUT_MS, images } = {}) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('gemini-cli backend: prompt must be a non-empty string');
  }
  throwIfAborted(signal);

  // gemini -p '' reads the prompt from stdin (when -p arg is empty, stdin is
  // appended). --output-format text avoids JSON wrapping. Spawn from a temp
  // directory for the same prompt-injection containment reason as codex-cli;
  // --skip-trust is required because the temp dir isn't in gemini's trusted
  // workspace list (otherwise gemini exits 55).
  //
  // MCP servers are disabled by allowing only a name that cannot exist. A
  // rewrite or score is a pure text transform with no tool need, while the
  // user's configured MCP servers are arbitrary third-party processes the CLI
  // starts on every invocation: they add startup cost, log "MCP issues
  // detected" noise into stdout, and a wedged server can hang the call until
  // the backend timeout (observed 2026-07-27: one scoring call sat for the
  // full 600s budget while sibling calls finished in ~30s). Same containment
  // rationale as the temp cwd — the agent gets nothing it does not need.
  const dir = mkdtempSync(join(tmpdir(), 'patina-gemini-'));
  const cliModel = resolveLocalCliModel({ backendName: name, model, modelSource });
  const args = ['-p', '', '--output-format', 'text', '--skip-trust', '--allowed-mcp-server-names', NO_MCP_SERVERS, '-m', cliModel];

  // Vision input: gemini's @-includes are confined to the workspace root, so
  // images are staged into the temp cwd and referenced as @<filename>.
  let effectivePrompt = prompt;
  if (Array.isArray(images) && images.length > 0) {
    try {
      const staged = stageCliImages(dir, images);
      effectivePrompt = `${staged.map((f) => `@${f}`).join(' ')}\n${prompt}`;
    } catch (err) {
      // Runs before the Promise's cleanup; remove the temp dir and surface a
      // backend-shaped error instead of leaking it and escaping a raw fs error (#446).
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
      throw new Error(`gemini-cli backend: failed to stage image input (${err.message})`);
    }
  }

  return new Promise((resolve, reject) => {
    const { proc, terminate, waitForClose } = spawnOwnedCliProcess(
      'gemini',
      args,
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
        finishReject(new Error(`gemini-cli backend: timed out after ${timeout}ms`), { kill: true });
      }, timeout)
      : null;
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

    proc.on('close', (code, sig) => {
      if (settled) return;
      if (code !== 0) {
        // Signal death (OOM kill, external SIGTERM) yields code===null (#446).
        const how = code === null && sig ? `terminated by ${sig}` : `exited with code ${code}`;
        finishReject(new Error(`gemini-cli backend: gemini ${how}\n${stderr}`));
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
        finishReject(new Error(`gemini-cli backend: stdin error (${err.message})`), { kill: true });
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
  if (signal?.aborted) throw abortError('gemini-cli backend: aborted');
}

// Gemini CLI prepends benign warnings to stdout (e.g. "Ripgrep is not
// available. Falling back to GrepTool.", "MCP issues detected..."). They
// aren't part of the model's response, so strip leading lines that match
// known noise patterns before returning.
export function stripGeminiNoise(text) {
  const lines = text.split(/\r?\n/);
  // Anchor to the exact known gemini stdout banners, not a broad `Warning:`
  // prefix — a model response that legitimately begins with "Warning: ..."
  // must not be truncated (#446).
  const noiseRe = /^(?:Ripgrep is not available\b|MCP issues detected\b|Loaded cached credentials\b)/i;
  let i = 0;
  while (i < lines.length && (noiseRe.test(lines[i]) || lines[i].trim() === '')) {
    i++;
  }
  return lines.slice(i).join('\n');
}
