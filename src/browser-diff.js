import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir as osTmpdir } from 'node:os';
import { join, resolve as resolvePath } from 'node:path';
import { spawn as spawnChild } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { randomBytes } from 'node:crypto';

const DEFAULT_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'";
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

export function renderChangedBlocks(original, rewritten) {
  const beforeBlocks = splitTextIntoBlocks(original);
  const afterBlocks = splitTextIntoBlocks(rewritten);
  const matcher = beforeBlocks.length * afterBlocks.length > MAX_LCS_MATRIX_CELLS
    ? matchBlocksByIndex
    : matchCommonBlocks;
  const { leftMatched, rightMatched } = matcher(
    beforeBlocks.map((block) => block.text),
    afterBlocks.map((block) => block.text),
  );

  return {
    beforeHtml: renderBlocks(beforeBlocks, leftMatched),
    afterHtml: renderBlocks(afterBlocks, rightMatched),
  };
}

export function buildScoreSummary(beforeScore, afterScore) {
  return {
    before: normalizeScoreRows(beforeScore),
    after: normalizeScoreRows(afterScore),
  };
}

export function renderBrowserDiffHtml({
  original,
  rewrittenBody,
  diffExplanation,
  diffError,
  beforeScore,
  afterScore,
  sourcePath,
}) {
  const { beforeHtml, afterHtml } = renderChangedBlocks(original, rewrittenBody);
  const summary = buildScoreSummary(beforeScore, afterScore);
  const escapedSourcePath = htmlEscape(sourcePath);
  const explanationBody = diffExplanation ? htmlEscape(diffExplanation) : '';
  const failureNotice = diffError
    ? `<p class="warning">Pattern explanation unavailable: ${htmlEscape(diffError)}</p>`
    : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="Content-Security-Policy" content="${htmlEscape(DEFAULT_CSP)}">
  <title>patina browser diff</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0b0d11;
      --panel: #12161d;
      --line: #293242;
      --muted: #96a3b8;
      --text: #edf2ff;
      --accent: #8db4ff;
      --mark: rgba(255, 215, 102, 0.22);
      --warn: #ffb86b;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 14px/1.6 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      max-width: 1440px;
      margin: 0 auto;
      padding: 32px 20px 40px;
      display: grid;
      gap: 20px;
    }
    .panel {
      border: 1px solid var(--line);
      border-radius: 18px;
      background: var(--panel);
      padding: 18px;
      overflow: hidden;
    }
    h1, h2, h3 { margin: 0 0 10px; }
    .meta { color: var(--muted); margin: 0; word-break: break-all; }
    .summary-grid, .pane-grid {
      display: grid;
      gap: 16px;
    }
    .summary-grid { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
    .pane-grid { grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th, td {
      border-top: 1px solid var(--line);
      padding: 8px 10px;
      text-align: left;
      vertical-align: top;
    }
    th { color: var(--muted); font-weight: 600; }
    pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      font: 13px/1.7 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    mark.changed-block {
      display: inline;
      background: var(--mark);
      color: inherit;
      border-radius: 4px;
      padding: 0 2px;
    }
    .pane-title, .eyebrow {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 8px;
    }
    .warning {
      margin: 0 0 12px;
      color: var(--warn);
    }
    .explanation {
      min-height: 120px;
    }
  </style>
</head>
<body>
  <main>
    <section class="panel">
      <p class="eyebrow">local browser diff</p>
      <h1>patina before/after comparison</h1>
      <p class="meta">Source: ${escapedSourcePath}</p>
    </section>
    <section class="summary-grid">
      ${renderScorePanel('Before', summary.before)}
      ${renderScorePanel('After', summary.after)}
    </section>
    <section class="pane-grid">
      <article class="panel">
        <p class="pane-title">Before</p>
        <pre>${beforeHtml}</pre>
      </article>
      <article class="panel">
        <p class="pane-title">After</p>
        <pre>${afterHtml}</pre>
      </article>
    </section>
    <section class="panel">
      <p class="pane-title">Pattern explanation</p>
      ${failureNotice}
      <pre class="explanation">${explanationBody || htmlEscape('No pattern explanation available.')}</pre>
    </section>
  </main>
</body>
</html>`;
}

export function writeBrowserDiffPage(html, options = {}) {
  const tmpdir = getRuntimeValue(options, 'tmpdir', osTmpdir);
  const mkdtemp = getRuntimeValue(options, 'mkdtemp', mkdtempSync);
  const writeFile = getRuntimeValue(options, 'writeFile', writeFileSync);
  const chmod = getRuntimeValue(options, 'chmod', chmodSync);
  const now = getRuntimeValue(options, 'now', Date.now);
  const platform = getRuntimeValue(options, 'platform', process.platform);
  const baseTmpDir = typeof tmpdir === 'function' ? tmpdir() : tmpdir;
  const dirPath = mkdtemp(join(baseTmpDir, 'patina-browser-diff-'));
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

function renderScorePanel(title, rows) {
  const body = rows.map((row) => `
        <tr>
          <th scope="row">${htmlEscape(row.label)}</th>
          <td>${htmlEscape(row.value)}</td>
        </tr>`).join('');
  return `<article class="panel">
      <h2>${htmlEscape(title)}</h2>
      <table>
        <tbody>${body}
        </tbody>
      </table>
    </article>`;
}

function normalizeScoreRows(score) {
  if (!score || typeof score !== 'object') {
    return [{ label: 'Status', value: 'Unavailable' }];
  }

  const rows = [];
  if (score.overall !== null && score.overall !== undefined) rows.push({ label: 'Overall', value: String(score.overall) });
  if (score.interpretation) rows.push({ label: 'Interpretation', value: String(score.interpretation) });
  if (Number.isFinite(score.paragraphCount)) rows.push({ label: 'Paragraphs', value: String(score.paragraphCount) });
  if (Number.isFinite(score.hotParagraphs)) rows.push({ label: 'Hot paragraphs', value: String(score.hotParagraphs) });
  if (Number.isFinite(score.signalScore)) rows.push({ label: 'Signal score', value: String(score.signalScore) });
  if (score.skipped) rows.push({ label: 'Skipped', value: 'true' });
  if (score.skipReason) rows.push({ label: 'Skip reason', value: String(score.skipReason) });
  if (score.error) rows.push({ label: 'Error', value: String(score.error) });
  return rows.length > 0 ? rows : [{ label: 'Status', value: 'Unavailable' }];
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

function renderBlocks(blocks, matchedSet) {
  return blocks.map((block, index) => {
    const escapedText = htmlEscape(block.text);
    const escapedSeparator = htmlEscape(block.separator);
    if (!block.text) return escapedSeparator;
    if (matchedSet.has(index)) return `${escapedText}${escapedSeparator}`;
    return `<mark class="changed-block">${escapedText}</mark>${escapedSeparator}`;
  }).join('');
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
