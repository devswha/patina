import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_BACKEND_TIMEOUT_MS = 600_000;
export const DEFAULT_HTTP_MAX_RETRIES = 2;
export const PROMPT_SIZE_WARNING_CHARS = 20_000;

export const BACKEND_SAFETY_DEFAULTS = Object.freeze({
  'openai-http': {
    maxConcurrency: 4,
    maxRetries: DEFAULT_HTTP_MAX_RETRIES,
    promptMode: 'strict',
    agentRuntime: false,
  },
  'codex-cli': {
    maxConcurrency: 2,
    maxRetries: 0,
    promptMode: 'minimal',
    agentRuntime: true,
  },
  'claude-cli': {
    maxConcurrency: 1,
    maxRetries: 0,
    promptMode: 'minimal',
    agentRuntime: true,
  },
  'gemini-cli': {
    maxConcurrency: 2,
    maxRetries: 0,
    promptMode: 'minimal',
    agentRuntime: true,
  },
  'kimi-cli': {
    maxConcurrency: 1,
    maxRetries: 0,
    promptMode: 'minimal',
    agentRuntime: true,
  },
});

const UNKNOWN_BACKEND_SAFETY = Object.freeze({
  maxConcurrency: Infinity,
  maxRetries: 0,
  promptMode: 'strict',
  agentRuntime: false,
});

export function getBackendSafety(backendName) {
  return BACKEND_SAFETY_DEFAULTS[backendName] || UNKNOWN_BACKEND_SAFETY;
}

export function resolveBackendMaxConcurrency(backendName, override) {
  const fallback = getBackendSafety(backendName).maxConcurrency;
  if (override === undefined || override === null) return fallback;
  const n = Number(override);
  // Fail closed: an invalid override (0, negative, NaN) must not silently
  // disable the cross-process cap. Fall back to the backend's own default
  // rather than Infinity — the cap exists to bound agent-CLI fan-out (#445).
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function resolveBackendMaxRetries(backendName, override) {
  const n = override === undefined || override === null
    ? getBackendSafety(backendName).maxRetries
    : Number(override);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

export function formatLimit(value) {
  return Number.isFinite(value) ? String(value) : 'unbounded';
}

// Copy image attachments into a CLI backend's per-invocation temp dir so a
// vision-capable CLI can read them from its own (otherwise empty) cwd. This
// preserves the prompt-injection containment of the empty-cwd spawn: the CLI
// never needs access to the caller's paths. Returns the staged filenames.
export function stageCliImages(dir, images = []) {
  return images.map((imagePath, index) => {
    const ext = (/\.([a-z0-9]{1,5})$/i.exec(String(imagePath))?.[1] || 'png').toLowerCase();
    const staged = `ocr-image-${index}.${ext}`;
    copyFileSync(imagePath, join(dir, staged));
    return staged;
  });
}

export function isRetryableBackendError(err, { attemptIndex = 0, signal } = {}) {
  if (signal?.aborted) return false;
  const status = extractStatus(err);
  if (status === 429 || status === 503) return true;
  // A per-attempt timeout (api.js renames exhausted timer aborts to
  // TimeoutError, #444) is as fallbackable as an AbortError on the first hop.
  return (err?.name === 'AbortError' || err?.name === 'TimeoutError') && attemptIndex === 0;
}

export function describeBackendError(err) {
  const status = extractStatus(err);
  if (status) return `HTTP ${status}`;
  const exitCode = extractExitCode(err);
  if (exitCode) return `exit code ${exitCode}`;
  return err?.name || 'error';
}

function extractStatus(err) {
  // `Number(null) === 0` is finite, so an explicit `status: null` would short
  // out the HTTP 429/503 message fallback and look non-retryable (#445).
  if (err?.status != null) {
    const direct = Number(err.status);
    if (Number.isFinite(direct)) return direct;
  }
  const match = String(err?.message || '').match(/\bHTTP\s+(429|503)\b/);
  return match ? Number(match[1]) : null;
}

function extractExitCode(err) {
  const direct = Number(err?.code);
  if (Number.isFinite(direct)) return direct;
  const match = String(err?.message || '').match(/\bexited with code\s+(\d+)\b/i);
  return match ? Number(match[1]) : null;
}

export async function withBackendConcurrencySlot({
  backendName,
  maxConcurrency,
  signal,
  timeout = DEFAULT_BACKEND_TIMEOUT_MS,
  pollMs = 250,
  staleMs = Math.max(timeout * 2, 30 * 60_000),
  fn,
} = {}) {
  if (typeof fn !== 'function') {
    throw new Error('backend concurrency slot requires fn');
  }
  if (!Number.isFinite(maxConcurrency)) {
    return fn();
  }

  const slot = await acquireBackendSlot({
    backendName,
    maxConcurrency,
    signal,
    timeout,
    pollMs,
    staleMs,
  });

  try {
    return await fn();
  } finally {
    releaseBackendSlot(slot);
  }
}

async function acquireBackendSlot({
  backendName,
  maxConcurrency,
  signal,
  timeout,
  pollMs,
  staleMs,
}) {
  throwIfAborted(signal, `${backendName || 'backend'}: aborted while waiting for concurrency slot`);
  const startedAt = Date.now();
  // Per-user slot root: the slot dirs are real locks, and a world-shared
  // tmpdir path means another user's slot dir cannot be removed (EACCES) and
  // would permanently consume a cap slot on a multi-user host (#445).
  const root = join(tmpdir(), `patina-backend-slots-${userSlotSegment()}`, safePathSegment(backendName || 'backend'));
  mkdirSync(root, { recursive: true });

  for (;;) {
    for (let index = 0; index < maxConcurrency; index++) {
      const slot = join(root, `slot-${index}`);
      cleanupStaleSlot(slot, staleMs);
      try {
        mkdirSync(slot);
        writeFileSync(join(slot, 'owner.json'), JSON.stringify({
          pid: process.pid,
          backendName,
          createdAt: new Date().toISOString(),
        }), 'utf8');
        return slot;
      } catch (err) {
        if (err?.code !== 'EEXIST') throw err;
      }
    }

    throwIfAborted(signal, `${backendName || 'backend'}: aborted while waiting for concurrency slot`);
    if (Date.now() - startedAt >= timeout) {
      throw new Error(`${backendName || 'backend'}: timed out waiting for concurrency slot (cap ${maxConcurrency})`);
    }
    await sleepWithAbort(Math.min(pollMs, timeout), signal, backendName);
  }
}

function cleanupStaleSlot(slot, staleMs) {
  try {
    // A crashed owner (its pid no longer alive) must release the slot
    // immediately, not after staleMs — otherwise a cap-1 backend (claude/kimi)
    // is blocked for up to 30 minutes by a dead run (#445).
    if (!isSlotOwnerAlive(slot)) {
      rmSync(slot, { recursive: true, force: true });
      return;
    }
    const ageMs = Date.now() - statSync(slot).mtimeMs;
    if (ageMs > staleMs) rmSync(slot, { recursive: true, force: true });
  } catch {}
}

// True unless the slot's recorded owner pid is provably dead. Unreadable/absent
// owner records return true so mtime staleness still governs and a just-created
// slot (owner.json not yet written) is never yanked from under its owner.
function isSlotOwnerAlive(slot) {
  let pid;
  try {
    pid = Number(JSON.parse(readFileSync(join(slot, 'owner.json'), 'utf8'))?.pid);
  } catch {
    return true;
  }
  if (!Number.isInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0); // signal 0 is a liveness probe, not an actual signal
    return true;
  } catch (err) {
    // ESRCH → no such process (dead); EPERM → exists but not ours (alive).
    return err?.code === 'EPERM';
  }
}

// A filesystem-safe per-user segment so slot roots are owned by, and removable
// by, the current user. uid on POSIX; falls back to the username elsewhere.
function userSlotSegment() {
  try {
    const { uid, username } = userInfo();
    return Number.isInteger(uid) && uid >= 0 ? `uid-${uid}` : safePathSegment(username || 'user');
  } catch {
    return 'user';
  }
}

function releaseBackendSlot(slot) {
  try {
    rmSync(slot, { recursive: true, force: true });
  } catch {}
}

function sleepWithAbort(ms, signal, backendName) {
  if (ms <= 0) return Promise.resolve();
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(abortError(`${backendName || 'backend'}: aborted while waiting for concurrency slot`));
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function throwIfAborted(signal, message) {
  if (signal?.aborted) throw abortError(message);
}

function abortError(message) {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

function safePathSegment(value) {
  return String(value).replace(/[^a-z0-9._-]+/gi, '_');
}

export function runInteractiveCommand({
  backendName,
  command,
  args = [],
  cwd = process.cwd(),
  env = process.env,
  stdio = 'inherit',
  notFoundHint,
} = {}) {
  if (!backendName || !command) {
    throw new Error('interactive backend command requires backendName and command');
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { cwd, env, stdio });

    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error(`${backendName}: \`${command}\` CLI not found. ${notFoundHint || 'Install the CLI and try again.'}`));
        return;
      }
      reject(new Error(`${backendName}: failed to spawn ${command} (${err.message})`));
    });

    proc.on('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      if (signal) {
        reject(new Error(`${backendName}: ${command} was terminated by ${signal}`));
        return;
      }
      reject(new Error(`${backendName}: ${command} exited with code ${code}`));
    });
  });
}
