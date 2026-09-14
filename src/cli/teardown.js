import http from 'node:http';
import https from 'node:https';
import { getProcessExitCode } from '../errors.js';

const STDIO_FDS = new Set([0, 1, 2]);

/**
 * True when a libuv handle is an idle HTTP client socket left by global
 * `fetch` / undici keep-alive (or `http.globalAgent`). Server-side sockets
 * and stdio pipes are left alone.
 *
 * @param {object|null|undefined} handle Process handle from `_getActiveHandles`.
 * @returns {boolean} Whether teardown may destroy this handle.
 */
export function isIdleHttpClientSocket(handle) {
  if (!handle || handle.destroyed) return false;
  if (handle.constructor?.name !== 'Socket') return false;
  if (handle.server) return false;
  if (STDIO_FDS.has(handle.fd)) return false;
  return typeof handle.remotePort === 'number';
}

function defaultGetHandles(processObj) {
  if (typeof processObj._getActiveHandles === 'function') return processObj._getActiveHandles();
  return [];
}

function listResourceTypes(processObj) {
  if (typeof processObj.getActiveResourcesInfo === 'function') return processObj.getActiveResourcesInfo();
  return [];
}

function waitForHandleClose(handle, wait) {
  if (!handle || handle.destroyed) return wait();
  if (typeof handle.once !== 'function') return wait();
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    handle.once('close', done);
    handle.once('error', done);
    wait().then(done);
  });
}

/**
 * Close leftover CLI handles so process.exit / natural exit does not race
 * undici keep-alive sockets (issue #807: win32 libuv abort at async.c:94).
 *
 * @param {object} [options] Injection points for tests.
 * @param {NodeJS.Process} [options.processObj=process] Process-like object.
 * @param {typeof http} [options.httpModule] HTTP module whose globalAgent is destroyed.
 * @param {typeof https} [options.httpsModule] HTTPS module whose globalAgent is destroyed.
 * @param {(processObj: NodeJS.Process) => object[]} [options.getHandles] Active-handle enumerator.
 * @param {() => Promise<void>} [options.wait] Drain delay after destroy.
 * @returns {Promise<{closed: object[], remaining: string[]}>} Closed sockets and leftover resource types.
 */
export async function drainCliHandles({
  processObj = process,
  httpModule = http,
  httpsModule = https,
  getHandles = defaultGetHandles,
  wait = () => new Promise((resolve) => {
    setImmediate(() => setImmediate(resolve));
  }),
} = {}) {
  httpModule.globalAgent?.destroy?.();
  httpsModule.globalAgent?.destroy?.();

  const stdin = processObj.stdin;
  if (stdin && typeof stdin.pause === 'function') stdin.pause();
  if (stdin && typeof stdin.unref === 'function') stdin.unref();

  const closed = [];
  const pending = [];
  for (const handle of getHandles(processObj)) {
    if (!isIdleHttpClientSocket(handle)) continue;
    closed.push({
      remoteAddress: handle.remoteAddress ?? null,
      remotePort: handle.remotePort ?? null,
    });
    handle.destroy();
    pending.push(waitForHandleClose(handle, wait));
  }
  if (pending.length === 0) await wait();
  else await Promise.all(pending);

  return { closed, remaining: listResourceTypes(processObj) };
}

/**
 * Run the CLI and drain leftover handles before the process is allowed to
 * exit. Sets `exitCode` on thrown errors instead of calling `process.exit()`
 * while fetch keep-alive sockets are still live.
 *
 * @param {string[]} args CLI arguments excluding node and script path.
 * @param {object} options Runtime dependencies.
 * @param {(args: string[]) => Promise<void>} options.mainFn CLI dispatcher.
 * @param {(err: unknown) => void} [options.onError] Error reporter.
 * @param {typeof drainCliHandles} [options.drain] Handle drain.
 * @param {NodeJS.Process} [options.processObj=process] Process-like object.
 * @returns {Promise<void>} Resolves after work and drain finish.
 */
export async function runCliProcess(args, {
  mainFn,
  onError,
  drain = drainCliHandles,
  processObj = process,
} = {}) {
  try {
    await mainFn(args);
  } catch (err) {
    if (typeof onError === 'function') onError(err);
    processObj.exitCode = getProcessExitCode(err, processObj.exitCode);
  } finally {
    await drain({ processObj });
  }
}
