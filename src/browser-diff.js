import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir as osTmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { spawn as spawnChild } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { randomBytes } from 'node:crypto';

let testRuntimeOverrides = {};
const MAX_LCS_MATRIX_CELLS = 20000;
export const DEFAULT_SERVE_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

export function buildBrowserDiffPromptInput(original, rewritten) {
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

export function htmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function writeBrowserDiffPage(html, options = {}) {
  const tmpdir = getRuntimeValue(options, 'tmpdir', osTmpdir);
  const mkdtemp = getRuntimeValue(options, 'mkdtemp', mkdtempSync);
  const writeFile = getRuntimeValue(options, 'writeFile', writeFileSync);
  const chmod = getRuntimeValue(options, 'chmod', chmodSync);
  const now = getRuntimeValue(options, 'now', Date.now);
  const platform = getRuntimeValue(options, 'platform', process.platform);
  const prefix = options.prefix ?? 'patina-browser-diff-';
  const baseTmpDir = typeof tmpdir === 'function' ? tmpdir() : tmpdir;
  const dirPath = mkdtemp(join(baseTmpDir, prefix));
  enforcePermissions(chmod, dirPath, 0o700, { required: platform !== 'win32' });
  const filePath = join(dirPath, `browser-diff-${now()}.html`);
  writeFile(filePath, html, 'utf8');
  enforcePermissions(chmod, filePath, 0o600, { required: platform !== 'win32' });
  return filePath;
}

export function openBrowserDiffPage(path, options = {}) {
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

export function serveBrowserDiffPage(html, options = {}) {
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

export function setBrowserDiffRuntimeForTests(overrides = {}) {
  testRuntimeOverrides = { ...overrides };
}

export function resetBrowserDiffRuntimeForTests() {
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

// Walk both block sequences against the LCS alignment and pair them up:
// matched blocks come through as {type:'same'}, and the unmatched runs
// between two matches pair as one {type:'change'} hunk (either side may be
// empty for pure insertions/deletions). This is what lets the file preview
// render original and rewritten text in one document without requiring the
// model to preserve paragraph counts.
export function diffBlockPairs(original, rewritten) {
  const beforeBlocks = splitTextIntoBlocks(original);
  const afterBlocks = splitTextIntoBlocks(rewritten);
  const matcher = beforeBlocks.length * afterBlocks.length > MAX_LCS_MATRIX_CELLS
    ? matchBlocksByIndex
    : matchCommonBlocks;
  const { leftMatched, rightMatched } = matcher(
    beforeBlocks.map((block) => block.text),
    afterBlocks.map((block) => block.text),
  );

  const pairs = [];
  let i = 0;
  let j = 0;
  while (i < beforeBlocks.length || j < afterBlocks.length) {
    const before = [];
    const after = [];
    while (i < beforeBlocks.length && !leftMatched.has(i)) before.push(beforeBlocks[i++].text);
    while (j < afterBlocks.length && !rightMatched.has(j)) after.push(afterBlocks[j++].text);
    if (before.length || after.length) {
      pairs.push({ type: 'change', before: before.join('\n\n'), after: after.join('\n\n') });
      continue;
    }
    if (i < beforeBlocks.length && j < afterBlocks.length) {
      pairs.push({ type: 'same', text: afterBlocks[j].text });
      i += 1;
      j += 1;
      continue;
    }
    // One side exhausted with only matched blocks left on the other — cannot
    // happen with a consistent alignment, but never hang on bad input.
    if (j < afterBlocks.length) pairs.push({ type: 'same', text: afterBlocks[j].text });
    i += 1;
    j += 1;
  }
  return pairs;
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

function splitTextIntoBlocks(text) {
  const normalized = String(text ?? '').replace(/\r\n/g, '\n');
  if (normalized.length === 0) return [{ text: '', separator: '' }];
  if (/\n{2,}/.test(normalized)) return splitBySeparator(normalized, /\n{2,}/g);
  if (/\n/.test(normalized)) return splitBySeparator(normalized, /\n/g);
  return [{ text: normalized, separator: '' }];
}

function splitBySeparator(text, separatorRe) {
  const blocks = [];
  let lastIndex = 0;
  let match;
  while ((match = separatorRe.exec(text)) !== null) {
    blocks.push({ text: text.slice(lastIndex, match.index), separator: match[0] });
    lastIndex = match.index + match[0].length;
  }
  blocks.push({ text: text.slice(lastIndex), separator: '' });
  return blocks;
}

function matchCommonBlocks(left, right) {
  const table = Array.from({ length: left.length + 1 }, () => new Array(right.length + 1).fill(0));
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      if (left[i] === right[j]) table[i][j] = table[i + 1][j + 1] + 1;
      else table[i][j] = Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const leftMatched = new Set();
  const rightMatched = new Set();
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      leftMatched.add(i);
      rightMatched.add(j);
      i++;
      j++;
      continue;
    }
    if (table[i + 1][j] >= table[i][j + 1]) i++;
    else j++;
  }

  return { leftMatched, rightMatched };
}

function matchBlocksByIndex(left, right) {
  const leftMatched = new Set();
  const rightMatched = new Set();
  const count = Math.min(left.length, right.length);
  for (let i = 0; i < count; i++) {
    if (left[i] === right[i]) {
      leftMatched.add(i);
      rightMatched.add(i);
    }
  }
  return { leftMatched, rightMatched };
}

function enforcePermissions(chmod, path, mode, { required }) {
  try {
    chmod(path, mode);
  } catch (err) {
    if (required) throw err;
  }
}
