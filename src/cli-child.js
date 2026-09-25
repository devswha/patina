import { fileURLToPath } from 'node:url';
import { TextDecoder } from 'node:util';

const CLI_PATH = fileURLToPath(new URL('../bin/patina.js', import.meta.url));
const MAX_STDOUT_BYTES = 256 * 1024;

/** Public failures carry stable codes only, never values, drafts, or child output. */
export class CliChildError extends Error {
  constructor(code) {
    super(code);
    this.name = 'CliChildError';
    this.code = code;
  }
}

export function cliVerification(value) {
  const bounded = number => typeof number === 'number' && Number.isFinite(number) && number >= 0 && number <= 100;
  const reasons = ['passed', 'passed-on-retry', 'floor-not-met', 'retry-error', 'dropped-numbers', 'numeric-claim-changed', 'output-changed'];
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof value.verified !== 'boolean' || typeof value.retried !== 'boolean'
    || !bounded(value.mps) || !bounded(value.fidelity)
    || !bounded(value.mpsFloor) || !bounded(value.fidelityFloor) || !reasons.includes(value.reason)
    || typeof value.outputHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.outputHash)) return null;
  if (value.verified && value.reason !== (value.retried ? 'passed-on-retry' : 'passed')) return null;
  // Whitelist scalar evidence only; never reflect arbitrary child JSON or text.
  return { verified: value.verified, mps: value.mps, fidelity: value.fidelity,
    retried: value.retried, reason: value.reason, mpsFloor: value.mpsFloor, fidelityFloor: value.fidelityFloor,
    outputHash: value.outputHash };
}

/** Spawn the shipped CLI only. Drafts travel in a private snapshot file. */
export function invokeCli(args, { cwd, env, signal, timeoutMs, spawnImpl }) {
  return new Promise((resolveResult, reject) => {
    let child;
    let timer;
    let settled = false;
    const chunks = [];
    let bytes = 0;
    const finish = (error, exitCode = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (error) {
        // A separate POSIX process group includes the backend's children.
        // Windows can only guarantee termination of the direct CLI process.
        try { if (process.platform !== 'win32' && child?.pid) process.kill(-child.pid, 'SIGKILL'); } catch {}
        try { child?.kill('SIGKILL'); } catch {}
        child?.stdout?.destroy();
        child?.unref();
        reject(error);
      } else {
        try {
          resolveResult({ exitCode, stdout: exitCode === 0 || exitCode === 4 ? new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)) : '' });
        } catch {
          if (exitCode === 4) resolveResult({ exitCode, stdout: '' });
          else reject(new CliChildError('invalid_cli_json'));
        }
      }
    };
    const onAbort = () => finish(new CliChildError('aborted'));
    try {
      if (signal?.aborted) return onAbort();
      child = spawnImpl(process.execPath, [CLI_PATH, ...args], {
        cwd, env, shell: false, windowsHide: true, detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      child.on('error', () => finish(new CliChildError('cli_start_failed')));
      child.on('close', code => finish(null, code));
      child.stdout.on('error', () => finish(new CliChildError('cli_output_failed')));
      child.stdout.on('data', chunk => {
        const buffer = Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > MAX_STDOUT_BYTES) return finish(new CliChildError('cli_output_limit'));
        chunks.push(buffer);
      });
      signal?.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => finish(new CliChildError('timeout')), timeoutMs);
      if (signal?.aborted) onAbort();
    } catch { finish(new CliChildError('cli_start_failed')); }
  });
}
