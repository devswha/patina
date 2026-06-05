import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
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
    existsSync(join(root, 'config.toml')) ||
    KIMI_ENV_KEYS.some((key) => !!process.env[key]);
}

export function authHint() {
  if (KIMI_ENV_KEYS.some((key) => !!process.env[key])) {
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

export async function invoke({ prompt, model, modelSource, signal, timeout = DEFAULT_BACKEND_TIMEOUT_MS } = {}) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('kimi-cli backend: prompt must be a non-empty string');
  }
  throwIfAborted(signal);

  const dir = mkdtempSync(join(tmpdir(), 'patina-kimi-'));
  const cliModel = resolveLocalCliModel({ backendName: name, model, modelSource });
  const args = [
    '--print',
    '--input-format',
    'text',
    '--output-format',
    'text',
    '--final-message-only',
    '--no-thinking',
    '--max-steps-per-turn',
    '1',
  ];
  if (cliModel) args.push('--model', cliModel);

  return new Promise((resolve, reject) => {
    const proc = spawn('kimi', args, { stdio: ['pipe', 'pipe', 'pipe'], cwd: dir });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', (chunk) => { stderr += chunk; });

    let settled = false;
    let cleanupSignal = () => {};
    const timer = setTimeout(() => {
      finishReject(new Error(`kimi-cli backend: timed out after ${timeout}ms`), { kill: true });
    }, timeout);
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

    proc.on('close', (code) => {
      if (settled) return;
      if (code !== 0) {
        finishReject(new Error(`kimi-cli backend: kimi exited with code ${code}\n${stderr}`));
        return;
      }
      finishResolve(stripKimiNoise(stdout));
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
  if (signal?.aborted) throw abortError('kimi-cli backend: aborted');
}

function stripKimiNoise(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => !/^To resume this session:\s*kimi\s+-r\s+/i.test(line.trim()))
    .join('\n')
    .trimStart();
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
