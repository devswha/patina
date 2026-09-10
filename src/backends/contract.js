// Backend resilience contract — single owner per concern (C3).
//
// To avoid duplicated or compounding retries, each resilience concern has
// exactly ONE owner:
//
//   * Transport retry (same provider, same request) — src/api.js `callLLM`.
//     Retries up to `maxRetries` times on retryable HTTP/network errors with
//     exponential backoff + jitter, bounded by the deadline. CLI backends pass
//     maxRetries=0 (see BACKEND_SAFETY_DEFAULTS) so they never transport-retry.
//   * Backend fallback (different backend) — src/backends/index.js
//     `invokeBackendChain`. On a retryable error it advances to the NEXT backend
//     in the chain; it NEVER re-invokes the same backend (that is transport
//     retry's job). `isRetryableBackendError` (here) is the shared predicate.
//   * Schema retry (re-ask for valid JSON) — src/scoring.js `callAndParseJson`.
//     Exactly one extra attempt at temperature 0 on a JSON-parse/schema failure.
//   * Timeout & concurrency — this module: `DEFAULT_BACKEND_TIMEOUT_MS`,
//     `resolveBackendMaxConcurrency`, `withBackendConcurrencySlot`,
//     `resolveBackendMaxRetries`.
//
// Defaults are intentionally stable; changing a retry path means changing its
// single owner here or in the file named above, never adding a parallel one.
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';

/**
 * Resolve how a bare CLI name must be spawned on the current platform.
 *
 * win32 only: a CLI installed as an npm `.cmd`/`.bat` shim cannot be spawned
 * without a shell (Node refuses since the CVE-2024-27980 fix), while a real
 * `.exe` spawns bare. Walk PATH in order and return the first PATHEXT match;
 * batch shims come back flagged so callers launch them through cmd.exe (see
 * spawnWindowsBatch). Real executables and unknown names keep the bare name
 * so the existing not-installed error path is unchanged.
 *
 * @param {string} command Bare CLI name (e.g. 'gemini').
 * @param {object} [deps]
 * @param {string} [deps.platform]
 * @param {NodeJS.ProcessEnv} [deps.env]
 * @param {(path: string) => boolean} [deps.exists]
 * @returns {{ command: string, batch: boolean }}
 */
export function resolveCliSpawnCommand(command, { platform = process.platform, env = process.env, exists = existsSync } = {}) {
  if (platform !== 'win32') return { command, batch: false };
  const extensions = String(env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').map((ext) => ext.toUpperCase());
  for (const dir of String(env.PATH || '').split(';')) {
    if (!dir) continue;
    for (const ext of extensions) {
      const candidate = join(dir, command + ext);
      if (!exists(candidate)) continue;
      return { command: candidate, batch: ext === '.CMD' || ext === '.BAT' };
    }
  }
  return { command, batch: false };
}

/**
 * Build the spawn triple for a win32 batch shim. `shell: true` is not used:
 * Node merely concatenates args with it (dropping empty strings, splitting
 * on spaces, DEP0190). Instead cmd.exe gets one fully-quoted command line:
 * every token is double-quoted, the whole line is wrapped in a second quote
 * pair because cmd /s strips one outer pair, and windowsVerbatimArguments
 * keeps Node's own quoting out of the way. Verified on Windows 11 with a
 * space in the batch path, an empty-string arg and a space in an arg.
 */
export function windowsBatchSpawn(command, args, options = {}) {
  const quote = (value) => `"${String(value).replace(/"/g, '""')}"`;
  const line = [command, ...args].map(quote).join(' ');
  return ['cmd.exe', ['/d', '/s', '/c', `"${line}"`], { ...options, windowsVerbatimArguments: true }];
}

/**
 * Availability probe shared by every local CLI backend: `<cli> --version`
 * with the platform's spawn shape (see resolveCliSpawnCommand).
 */
export function probeCliAvailability(command, { platform = process.platform, env = process.env, exists = existsSync, spawnSyncImpl = spawnSync } = {}) {
  try {
    const resolved = resolveCliSpawnCommand(command, { platform, env, exists });
    const [spawnCommand, spawnArgs, spawnOptions] = resolved.batch
      ? windowsBatchSpawn(resolved.command, ['--version'], { stdio: 'ignore' })
      : [resolved.command, ['--version'], { stdio: 'ignore' }];
    const result = spawnSyncImpl(spawnCommand, spawnArgs, spawnOptions);
    return result.status === 0;
  } catch {
    return false;
  }
}
export const DEFAULT_BACKEND_TIMEOUT_MS = 600_000;
export const DEFAULT_HTTP_MAX_RETRIES = 2;
export const PROMPT_SIZE_WARNING_CHARS = 20_000;
export class TimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TimeoutError';
  }
}


export const BACKEND_SAFETY_DEFAULTS = Object.freeze({
  'openai-http': {
    maxConcurrency: 4,
    maxRetries: DEFAULT_HTTP_MAX_RETRIES,
    promptMode: 'strict',
    agentRuntime: false,
    // Only the OpenAI-compatible HTTP backend builds a chat-completions body,
    // so structured-output request fields (response_format) apply here alone.
    supportsStructuredOutput: true,
  },
  'codex-cli': {
    maxConcurrency: 2,
    maxRetries: 0,
    promptMode: 'minimal',
    agentRuntime: true,
    supportsStructuredOutput: false,
  },
  'claude-cli': {
    maxConcurrency: 1,
    maxRetries: 0,
    promptMode: 'minimal',
    agentRuntime: true,
    supportsStructuredOutput: false,
  },
  'gemini-cli': {
    maxConcurrency: 2,
    maxRetries: 0,
    promptMode: 'minimal',
    agentRuntime: true,
    supportsStructuredOutput: false,
  },
  'kimi-cli': {
    maxConcurrency: 1,
    maxRetries: 0,
    promptMode: 'minimal',
    agentRuntime: true,
    supportsStructuredOutput: false,
  },
  'agy-cli': {
    maxConcurrency: 1,
    maxRetries: 0,
    promptMode: 'minimal',
    agentRuntime: true,
    supportsStructuredOutput: false,
  },
});

const UNKNOWN_BACKEND_SAFETY = Object.freeze({
  maxConcurrency: Infinity,
  maxRetries: 0,
  promptMode: 'strict',
  agentRuntime: false,
  supportsStructuredOutput: false,
});

export function getBackendSafety(backendName) {
  return BACKEND_SAFETY_DEFAULTS[backendName] || UNKNOWN_BACKEND_SAFETY;
}

// True only for backends whose request path can carry an OpenAI-compatible
// structured-output field (response_format). CLI backends spawn an agent and
// never receive it, so structured output is never sent to a local CLI.
export function backendSupportsStructuredOutput(backendName) {
  return getBackendSafety(backendName).supportsStructuredOutput === true;
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
  // attemptIndex is retained for call-site compatibility but no longer gates
  // the decision (#506 defect 2): a backend that timed out or aborted on its
  // own (without the user aborting) is fallbackable at any hop.
  void attemptIndex;
  const status = extractStatus(err);
  if (status === 429 || status === 503) return true;
  // A per-attempt timeout falls through at ANY non-final hop, exactly like a
  // 429/503. This includes api.js TimeoutError, central contract TimeoutError,
  // local CLI timeout-shaped messages, and concurrency slot wait timeouts
  // (#525). The chain caller already stops at the final hop via `!next`.
  return err?.name === 'AbortError' || isTimeoutError(err);
}

export function isTimeoutError(err) {
  if (err?.name === 'TimeoutError') return true;
  const message = String(err?.message || '');
  return /\btimed out\b/i.test(message);
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
  deadline = Number.isFinite(timeout) ? Date.now() + timeout : Infinity,
  pollMs = 250,
  staleMs = Math.max(timeout * 2, 30 * 60_000),
  fn,
} = {}) {
  if (typeof fn !== 'function') {
    throw new Error('backend concurrency slot requires fn');
  }
  // The run phase gets whatever remains of the shared deadline after the slot
  // wait, so slot-wait + run can never exceed the single budget (#506 defect 1).
  // Callers that pass only `timeout` (no `deadline`) keep their full budget via
  // the derived default above.
  const remainingTimeout = () =>
    (Number.isFinite(deadline) ? Math.max(0, deadline - Date.now()) : timeout);
  // Never start backend work on an already-spent budget: an expired shared
  // deadline used to reach `fn(0)` on both the unbounded path and via the
  // slot-acquired-after-expiry race below (#567).
  const assertBudget = () => {
    if (Number.isFinite(deadline) && Date.now() >= deadline) {
      throw new TimeoutError(`${backendName || 'backend'}: shared deadline expired before backend start`);
    }
  };
  if (!Number.isFinite(maxConcurrency)) {
    assertBudget();
    return fn(remainingTimeout());
  }

  const slot = await acquireBackendSlot({
    backendName,
    maxConcurrency,
    signal,
    deadline,
    pollMs,
    staleMs,
  });

  try {
    // The slot can be won in the instant the deadline expires (mkdir succeeds
    // between the loop's deadline check and now). Re-check before invoking.
    assertBudget();
    return await fn(remainingTimeout());
  } finally {
    releaseBackendSlot(slot);
  }
}

async function acquireBackendSlot({
  backendName,
  maxConcurrency,
  signal,
  deadline,
  pollMs,
  staleMs,
}) {
  throwIfAborted(signal, `${backendName || 'backend'}: aborted while waiting for concurrency slot`);
  // Per-user slot root: the slot dirs are real locks, and a world-shared
  // tmpdir path means another user's slot dir cannot be removed (EACCES) and
  // would permanently consume a cap slot on a multi-user host (#445).
  const root = join(tmpdir(), `patina-backend-slots-${userSlotSegment()}`, safePathSegment(backendName || 'backend'));
  mkdirSync(root, { recursive: true });

  for (;;) {
    // Deadline gates the ROUND, not just the sleep: checking only after a
    // failed acquisition round let a slot freed during the sleep be acquired
    // after the deadline had already expired (#567).
    if (Date.now() >= deadline) {
      throw new TimeoutError(`${backendName || 'backend'}: timed out waiting for concurrency slot (cap ${maxConcurrency})`);
    }
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
    if (Date.now() >= deadline) {
      throw new TimeoutError(`${backendName || 'backend'}: timed out waiting for concurrency slot (cap ${maxConcurrency})`);
    }
    await sleepWithAbort(Math.min(pollMs, Math.max(0, deadline - Date.now())), signal, backendName);
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

// Detached POSIX children become the leader of an owned process group. Keep
// the platform list explicit: Node's `detached` option and negative-PID
// signalling do not have portable semantics, so other platforms retain the
// direct-child-only behavior rather than making an untested cleanup promise.
const OWNED_PROCESS_GROUP_PLATFORMS = new Set([
  'aix',
  'darwin',
  'freebsd',
  'haiku',
  'linux',
  'openbsd',
  'sunos',
]);

function supportsOwnedProcessGroup(platform = process.platform) {
  return OWNED_PROCESS_GROUP_PLATFORMS.has(platform);
}

// Spawn a non-interactive CLI with an owned process group where the platform
// supports POSIX process-group semantics. The close waiter is deliberately
// shared by all callers: cancellation/timeout can kill the group immediately,
// then defer temporary-directory/slot cleanup until Node emits child `close`.
export function spawnOwnedCliProcess(command, args = [], options = {}, {
  platform = process.platform,
  spawnImpl = spawn,
  killImpl = (pid, signal) => process.kill(pid, signal),
} = {}) {
  const ownsProcessGroup = supportsOwnedProcessGroup(platform);
  const resolved = resolveCliSpawnCommand(command, { platform });
  const baseOptions = ownsProcessGroup ? { ...options, detached: true } : { ...options };
  const [spawnCommand, spawnArgs, spawnOptions] = resolved.batch
    ? windowsBatchSpawn(resolved.command, args, baseOptions)
    : [resolved.command, args, baseOptions];
  const proc = spawnImpl(spawnCommand, spawnArgs, spawnOptions);
  let closeResult;
  let resolveClose;
  const closePromise = new Promise((resolve) => {
    resolveClose = resolve;
  });
  proc.once('close', (code, signal) => {
    closeResult = { code, signal };
    resolveClose(closeResult);
  });

  let terminationRequested = false;
  let exited = false;
  const destroyParentPipes = () => {
    if (ownsProcessGroup) return;
    for (const stream of [proc.stdin, proc.stdout, proc.stderr]) {
      if (typeof stream?.destroy === 'function' && !stream.destroyed) stream.destroy();
    }
  };
  const terminate = (signal = 'SIGKILL') => {
    if (terminationRequested) return;
    terminationRequested = true;

    if (ownsProcessGroup && Number.isInteger(proc.pid) && proc.pid > 0) {
      try {
        // Detached POSIX children are process-group leaders, so a negative PID
        // reaches workers that inherited the CLI's stdio pipes as well.
        killImpl(-proc.pid, signal);
        return;
      } catch {
        // Fall through for ESRCH (the leader/group may already be gone) and
        // other errors alike: a direct-child attempt covers the tiny pre-exec
        // window where the child exists but its detached group is not visible.
      }
    }

    try {
      if (!proc.killed) proc.kill(signal);
    } catch {}

    // A direct-child platform cannot signal descendants as a group. If the
    // leader already exited, close the parent-owned pipes now so an inherited
    // descendant cannot hold the adapter's close waiter open forever.
    if (exited) destroyParentPipes();
  };

  // A leader can exit while a worker keeps stdout/stderr open. On POSIX, kill
  // the owned group; elsewhere, only close parent-owned pipes after explicit
  // termination so normal buffered output can still drain before `close`.
  proc.once('exit', () => {
    exited = true;
    if (ownsProcessGroup) {
      terminate();
      return;
    }
    if (terminationRequested) destroyParentPipes();
  });

  return {
    proc,
    terminate,
    waitForClose() {
      return closeResult ? Promise.resolve(closeResult) : closePromise;
    },
  };
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
    // A failed spawn can emit both 'error' and 'close'; settle once so we never
    // resolve-then-reject (or build a second Error) on the same invocation (#533).
    let settled = false;
    const settle = (fn) => { if (settled) return; settled = true; fn(); };

    const proc = spawn(command, args, { cwd, env, stdio });

    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        settle(() => reject(new Error(`${backendName}: \`${command}\` CLI not found. ${notFoundHint || 'Install the CLI and try again.'}`)));
        return;
      }
      settle(() => reject(new Error(`${backendName}: failed to spawn ${command} (${err.message})`)));
    });

    proc.on('close', (code, signal) => {
      if (code === 0) {
        settle(() => resolve());
        return;
      }
      if (signal) {
        settle(() => reject(new Error(`${backendName}: ${command} was terminated by ${signal}`)));
        return;
      }
      settle(() => reject(new Error(`${backendName}: ${command} exited with code ${code}`)));
    });
  });
}
