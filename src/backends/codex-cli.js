import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_BACKEND_TIMEOUT_MS,
  runInteractiveCommand,
  probeCliAvailability,
  spawnOwnedCliProcess,
  stageCliImages,
} from './contract.js';
import { resolveLocalCliModel } from '../model-defaults.js';

export const name = 'codex-cli';
export const supportsImages = true;
export const loginCommand = 'codex login';

// Codex feature flags that expose agent tools. A rewrite or score is a pure
// text transform, yet with these enabled `codex exec` behaves as an agent:
// on the 2026-09-10 P17b pilot it issued 3-13 shell tool calls per prompt
// inside the read-only sandbox, re-sending the prompt on every turn (one KO
// rewrite reached 11 turns, ~500k cumulative input tokens). Disabling them
// removes the tool definitions from the request and leaves a single turn.
// Images still arrive through `-i`, which is model input, not a tool.
export const CODEX_DISABLED_FEATURES = Object.freeze(['shell_tool', 'unified_exec', 'multi_agent']);
export const installHint = 'Install it from https://github.com/openai/codex, then run `patina auth login codex-cli` again.';

export function isAvailable() {
  return probeCliAvailability('codex');
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

export async function invoke({ prompt, model, modelSource, signal, timeout = DEFAULT_BACKEND_TIMEOUT_MS, images } = {}) {
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

  // Vision input: codex exec attaches images natively via -i; staging them
  // into the temp cwd keeps the read-only sandbox + empty-cwd containment.
  const imageArgs = [];
  if (Array.isArray(images) && images.length > 0) {
    try {
      for (const staged of stageCliImages(dir, images)) {
        imageArgs.push('-i', join(dir, staged));
      }
    } catch (err) {
      // stageCliImages runs before the Promise, so its own try/finally cleanup
      // does not cover it — clean up the temp dir and surface a backend-shaped
      // error instead of leaking the dir and escaping a raw fs error (#446).
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
      throw new Error(`codex-cli backend: failed to stage image input (${err.message})`);
    }
  }

  return new Promise((resolve, reject) => {
    const { proc, terminate, waitForClose } = spawnOwnedCliProcess('codex', [
      'exec',
      '--skip-git-repo-check',
      '--sandbox', 'read-only',
      '-C', dir,
      '--model', cliModel,
      ...CODEX_DISABLED_FEATURES.flatMap((feature) => ['--disable', feature]),
      '--output-last-message', outFile,
      ...imageArgs,
      // stdout is discarded, not piped: `codex exec` streams session/progress
      // output there, and a piped-but-undrained stdout deadlocks the child
      // once the ~64KB OS pipe buffer fills (#438). The final answer comes
      // from --output-last-message, so nothing on stdout is needed.
    ], { stdio: ['pipe', 'ignore', 'pipe'], cwd: dir });

    let stderr = '';
    proc.stderr.setEncoding('utf8'); // decode as streaming UTF-8 so multibyte CJK is not corrupted at chunk boundaries (#446)
    proc.stderr.on('data', (chunk) => { stderr += chunk; });

    let settled = false;
    let cleanupSignal = () => {};
    // A non-finite timeout means "no timeout" — without this guard Node clamps
    // setTimeout(fn, Infinity) to 1ms and the child is SIGKILLed ~immediately (#527 H13).
    const timer = Number.isFinite(timeout)
      ? setTimeout(() => {
        finishReject(new Error(`codex-cli backend: timed out after ${timeout}ms`), { kill: true });
      }, timeout)
      : null;
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

    proc.on('close', (code, sig) => {
      if (settled) return;
      if (code !== 0) {
        // Signal death (OOM kill, external SIGTERM) yields code===null; report
        // the signal instead of "exited with code null" (#446).
        const how = code === null && sig ? `terminated by ${sig}` : `exited with code ${code}`;
        finishReject(new Error(`codex-cli backend: codex ${how}\n${stderr}`));
        return;
      }

      try {
        const content = readFileSync(outFile, 'utf8');
        finishResolve(content);
      } catch (err) {
        finishReject(new Error(`codex-cli backend: failed to read output file (${err.message})`));
      }
    });

    // A child that exits before draining a large prompt makes the buffered
    // stdin write fail with EPIPE; without a handler that becomes an unhandled
    // 'error' event that crashes the process. Ignore EPIPE (the 'close' handler
    // surfaces the real exit code + stderr); reject on anything else.
    proc.stdin.on('error', (err) => {
      if (err && err.code !== 'EPIPE') {
        finishReject(new Error(`codex-cli backend: stdin error (${err.message})`), { kill: true });
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
  if (signal?.aborted) throw abortError('codex-cli backend: aborted');
}
