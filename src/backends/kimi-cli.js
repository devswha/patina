import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_BACKEND_TIMEOUT_MS, runInteractiveCommand } from './contract.js';
import { resolveLocalCliModel } from '../model-defaults.js';

export const name = 'kimi-cli';
export const loginCommand = 'kimi login';
export const installHint = 'Install Kimi Code CLI first, then run `patina auth login kimi-cli` again.';

const KIMI_ENV_KEYS = ['KIMI_API_KEY', 'MOONSHOT_API_KEY'];

export function isAvailable() {
  try {
    const result = spawnSync('kimi', ['--version'], { stdio: 'ignore' });
    return result.status === 0;
  } catch {
    return false;
  }
}

export function isAuthenticated() {
  const root = kimiDataDir();
  return hasKimiCredential(root) ||
    hasNonEmptyKimiConfig(root) ||
    KIMI_ENV_KEYS.some((key) => Boolean(process.env[key]?.trim()));
}

export function authHint() {
  if (KIMI_ENV_KEYS.some((key) => Boolean(process.env[key]?.trim()))) {
    return 'Authenticated via KIMI_API_KEY/MOONSHOT_API_KEY env var.';
  }
  return `Run \`${loginCommand}\` once interactively to log in with Kimi Code OAuth.`;
}

export function login(options = {}) {
  return runInteractiveCommand({
    backendName: name,
    command: 'kimi',
    args: ['login'],
    notFoundHint: installHint,
    ...options,
  });
}

export async function invoke({ prompt, model, modelSource, signal, timeout = DEFAULT_BACKEND_TIMEOUT_MS, images } = {}) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('kimi-cli backend: prompt must be a non-empty string');
  }
  if (Array.isArray(images) && images.length > 0) {
    // kimi --print runs with tools hard-disabled by design (see the security
    // comment below) — there is no safe way for it to open an image file.
    throw new Error('kimi-cli backend: image input is not supported');
  }
  throwIfAborted(signal);

  const dir = mkdtempSync(join(tmpdir(), 'patina-kimi-'));
  const cliModel = resolveLocalCliModel({ backendName: name, model, modelSource });
  // `--print` runs non-interactively WITHOUT `--yolo`, so the agent cannot
  // auto-approve any tool action — there is no terminal to confirm at, so
  // shell/file tools stay blocked even if user text tries a prompt injection.
  // (Verified: an injected "run this shell command" prompt produced no tool
  // execution.) `--max-steps-per-turn 20` only lets the model take more
  // reasoning/formatting steps within that sandboxed-by-non-interactivity turn;
  // it does NOT grant tool execution. Keep `--print` and never add `--yolo`.
  const args = [
    '--print',
    '--input-format',
    'text',
    '--output-format',
    'text',
    '--final-message-only',
    '--no-thinking',
    '--max-steps-per-turn',
    '20',
  ];
  if (cliModel) args.push('--model', cliModel);

  return new Promise((resolve, reject) => {
    const proc = spawn('kimi', args, { stdio: ['pipe', 'pipe', 'pipe'], cwd: dir });

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
        finishReject(new Error(`kimi-cli backend: timed out after ${timeout}ms`), { kill: true });
      }, timeout)
      : null;
    if (signal) {
      const onAbort = () => finishReject(abortError('kimi-cli backend: aborted'), { kill: true });
      signal.addEventListener('abort', onAbort, { once: true });
      cleanupSignal = () => signal.removeEventListener('abort', onAbort);
    }

    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        finishReject(new Error('kimi-cli backend: `kimi` CLI not found. Install Kimi Code first.'));
      } else {
        finishReject(new Error(`kimi-cli backend: failed to spawn kimi (${err.message})`));
      }
    });

    proc.on('close', (code, sig) => {
      if (settled) return;
      if (code !== 0) {
        // Signal death (OOM kill, external SIGTERM) yields code===null (#446).
        const how = code === null && sig ? `terminated by ${sig}` : `exited with code ${code}`;
        finishReject(new Error(`kimi-cli backend: kimi ${how}\n${stderr}`));
        return;
      }
      finishResolve(stripKimiNoise(stdout));
    });

    // A child that exits before draining a large prompt makes the buffered
    // stdin write fail with EPIPE; without a handler that becomes an unhandled
    // 'error' event that crashes the process. Ignore EPIPE (the 'close' handler
    // surfaces the real exit code + stderr); reject on anything else.
    proc.stdin.on('error', (err) => {
      if (err && err.code !== 'EPIPE') {
        finishReject(new Error(`kimi-cli backend: stdin error (${err.message})`), { kill: true });
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
      // SIGKILL reaches only the direct child; grandchildren (workers/MCP) are
      // not in a killable group and may briefly outlive it — accepted leak (#446).
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
  if (signal?.aborted) throw abortError('kimi-cli backend: aborted');
}

export function stripKimiNoise(text) {
  const lines = text.split(/\r?\n/);
  const bannerRe = /^To resume this session:\s*kimi\s+-r\s+/i;
  // The resume banner is a trailing footer; strip it only from the end so a
  // mid-response line that legitimately quotes the same text survives (#446).
  let last = lines.length - 1;
  while (last >= 0 && lines[last].trim() === '') last--;
  if (last >= 0 && bannerRe.test(lines[last].trim())) {
    let end = last;
    while (end > 0 && lines[end - 1].trim() === '') end--;
    return lines.slice(0, end).join('\n').trimStart();
  }
  return lines.join('\n').trimStart();
}

function kimiDataDir() {
  return process.env.KIMI_SHARE_DIR || join(homedir(), '.kimi');
}

function hasKimiCredential(root) {
  try {
    return readdirSync(join(root, 'credentials'), { withFileTypes: true })
      .some((entry) => entry.isFile() && entry.name.endsWith('.json'));
  } catch {
    return false;
  }
}

// A logged-in Kimi CLI writes a populated config.toml. A bare/zero-byte file
// is created by some workflows without an actual login, so requiring a
// non-empty file avoids the false positive of "exists but empty" (#508 G8).
// statSync throws on a missing path, so the catch also covers the absent case.
function hasNonEmptyKimiConfig(root) {
  try {
    return statSync(join(root, 'config.toml')).size > 0;
  } catch {
    return false;
  }
}
