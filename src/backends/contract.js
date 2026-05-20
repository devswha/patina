import { spawn } from 'node:child_process';

export const DEFAULT_BACKEND_TIMEOUT_MS = 180_000;

export function isRetryableBackendError(err, { attemptIndex = 0, signal } = {}) {
  if (signal?.aborted) return false;
  const status = extractStatus(err);
  if (status === 429 || status === 503) return true;
  return err?.name === 'AbortError' && attemptIndex === 0;
}

export function describeBackendError(err) {
  const status = extractStatus(err);
  if (status) return `HTTP ${status}`;
  return err?.name || 'error';
}

function extractStatus(err) {
  const direct = Number(err?.status);
  if (Number.isFinite(direct)) return direct;
  const match = String(err?.message || '').match(/\bHTTP\s+(429|503)\b/);
  return match ? Number(match[1]) : null;
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
