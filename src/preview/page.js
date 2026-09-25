// The generated preview page: the explanation call's input and rendering, the
// private temp-file write, the window opener, and the --serve loopback server.
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir as osTmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { spawn as spawnChild } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { htmlEscape } from './dom.js';

let testRuntimeOverrides = {};
const DEFAULT_SERVE_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

export function buildExplanationPromptInput(original, rewritten) {
  return [
    'Compare BEFORE to AFTER.',
    'Do not rewrite either text.',
    'Report only changes present in AFTER relative to BEFORE.',
    '',
    '## BEFORE',
    original,
    '',
    '## AFTER',
    rewritten,
  ].join('\n');
}

// Minimal markdown rendering for the diff-explanation text: bold, inline
// code, and --- section breaks. Everything is HTML-escaped first; anything
// beyond these three forms stays visible as plain text.
export function renderExplanationHtml(text) {
  return String(text)
    .split(/\n\s*---\s*\n/)
    .map((section) => section.trim())
    .filter(Boolean)
    .map((section) => {
      const body = htmlEscape(section)
        .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`\n]+)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>');
      return `<article class="explain-card">${body}</article>`;
    })
    .join('') || '<p class="explain-empty">No pattern explanation available.</p>';
}

export function writePreviewPage(html, options = {}) {
  const tmpdir = getRuntimeValue(options, 'tmpdir', osTmpdir);
  const mkdtemp = getRuntimeValue(options, 'mkdtemp', mkdtempSync);
  const writeFile = getRuntimeValue(options, 'writeFile', writeFileSync);
  const chmod = getRuntimeValue(options, 'chmod', chmodSync);
  const now = getRuntimeValue(options, 'now', Date.now);
  const platform = getRuntimeValue(options, 'platform', process.platform);
  const baseTmpDir = typeof tmpdir === 'function' ? tmpdir() : tmpdir;
  const dirPath = mkdtemp(join(baseTmpDir, 'patina-preview-'));
  enforcePermissions(chmod, dirPath, 0o700, { required: platform !== 'win32' });
  const filePath = join(dirPath, `preview-${now()}.html`);
  writeFile(filePath, html, 'utf8');
  enforcePermissions(chmod, filePath, 0o600, { required: platform !== 'win32' });
  return filePath;
}

export function openPreviewPage(path, options = {}) {
  const platform = getRuntimeValue(options, 'platform', process.platform);
  const spawn = getRuntimeValue(options, 'spawn', spawnChild);
  const targetPath = resolvePath(path);
  const { command, args } = resolveOpenCommand(platform, targetPath);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`browser opener exited with code ${code}`));
    });
  });
}

export function servePreviewPage(html, options = {}) {
  const createServer = getRuntimeValue(options, 'createServer', createHttpServer);
  const randomToken = getRuntimeValue(options, 'randomToken', defaultRandomToken);
  const idleTimeoutMs = getRuntimeValue(options, 'idleTimeoutMs', DEFAULT_SERVE_IDLE_TIMEOUT_MS);
  const signal = options.signal;
  const token = randomToken();
  const pagePath = `/${token}/`;

  return new Promise((resolveServer, rejectServer) => {
    let idleTimer = null;
    let closed = false;
    let resolveDone;
    const done = new Promise((resolve) => {
      resolveDone = resolve;
    });

    const server = createServer((req, res) => {
      resetIdleTimer();
      // Connection: close keeps shutdown deterministic on every Node 18.x —
      // server.close() never has to wait out a browser keep-alive socket.
      if ((req.method !== 'GET' && req.method !== 'HEAD') || req.url !== pagePath) {
        res.writeHead(404, {
          'Content-Type': 'text/plain; charset=utf-8',
          'Connection': 'close',
        });
        res.end(req.method === 'HEAD' ? undefined : 'not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-store',
        'Connection': 'close',
      });
      res.end(req.method === 'HEAD' ? undefined : html);
    });

    function close() {
      if (closed) return;
      closed = true;
      if (idleTimer) clearTimeout(idleTimer);
      signal?.removeEventListener?.('abort', close);
      server.close(() => resolveDone());
    }

    function resetIdleTimer() {
      if (closed) return;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(close, idleTimeoutMs);
    }

    server.on('error', rejectServer);
    server.listen(0, '127.0.0.1', () => {
      // Read the address before close() — a pre-aborted signal closes the
      // listening socket, after which server.address() returns null.
      const { port } = server.address();
      if (signal?.aborted) {
        close();
      } else {
        signal?.addEventListener?.('abort', close, { once: true });
        resetIdleTimer();
      }
      // Startup errors (e.g. EADDRINUSE) already rejected via rejectServer.
      // Once listening, the outer promise is resolved, so a later socket error
      // would be swallowed — surface it through the logger and shut down.
      server.removeListener('error', rejectServer);
      server.on('error', (err) => {
        const logger = options.logger;
        const msg = `[patina] local preview server error: ${err?.message || err}`;
        if (logger?.warn) logger.warn('serve.socket_error', { message: msg });
        else process.stderr.write(msg + '\n');
        close();
      });
      resolveServer({
        url: `http://127.0.0.1:${port}${pagePath}`,
        close,
        done,
      });
    });
  });
}

function defaultRandomToken() {
  return randomBytes(16).toString('hex');
}

export function setPreviewPageRuntimeForTests(overrides = {}) {
  testRuntimeOverrides = { ...overrides };
}

export function resetPreviewPageRuntimeForTests() {
  testRuntimeOverrides = {};
}

function getRuntimeValue(options, key, fallback) {
  if (Object.prototype.hasOwnProperty.call(options, key)) return options[key];
  if (Object.prototype.hasOwnProperty.call(testRuntimeOverrides, key)) return testRuntimeOverrides[key];
  return fallback;
}

function resolveOpenCommand(platform, targetPath) {
  if (platform === 'darwin') return { command: 'open', args: [targetPath] };
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', targetPath] };
  return { command: 'xdg-open', args: [targetPath] };
}

function enforcePermissions(chmod, path, mode, { required }) {
  try {
    chmod(path, mode);
  } catch (err) {
    if (required) throw err;
  }
}
