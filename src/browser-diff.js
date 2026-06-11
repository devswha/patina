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

  const before = renderBlocks(beforeBlocks, leftMatched, 'before');
  const after = renderBlocks(afterBlocks, rightMatched, 'after');
  return {
    beforeHtml: before.html,
    afterHtml: after.html,
    beforeChangeCount: before.changeCount,
    afterChangeCount: after.changeCount,
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
  const { beforeHtml, afterHtml, afterChangeCount } = renderChangedBlocks(original, rewrittenBody);
  const escapedSourcePath = htmlEscape(sourcePath);
  const failureNotice = diffError
    ? `<p class="warning">Pattern explanation unavailable: ${htmlEscape(diffError)}</p>`
    : '';
  const explanationHtml = diffExplanation
    ? renderExplanationHtml(diffExplanation)
    : '<p class="explain-empty">No pattern explanation available.</p>';

  const hasChanges = afterChangeCount > 0;
  const changeChip = hasChanges
    ? `${afterChangeCount} change${afterChangeCount === 1 ? '' : 's'}`
    : 'No changes';
  const jumpNav = hasChanges
    ? `<nav class="jump" aria-label="Jump to change">${Array.from(
      { length: afterChangeCount },
      (_, i) => `<a class="chip jump-chip" href="#after-change-${i + 1}">${i + 1}</a>`,
    ).join('')}</nav>`
    : '';
  const toggleInput = hasChanges
    ? '<input type="checkbox" id="changes-only" class="toggle-input">'
    : '';
  const toggleLabel = hasChanges
    ? '<label class="chip switch" for="changes-only"><span class="knob"></span>Changes only</label>'
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
      --bg: #0b0e0d;
      --panel: #111614;
      --line: rgba(132, 168, 152, 0.16);
      --muted: #8da59a;
      --text: #e9efe9;
      --bronze: #c8956c;
      --bronze-soft: rgba(200, 149, 108, 0.15);
      --verdigris: #5fc4a8;
      --verdigris-soft: rgba(95, 196, 168, 0.13);
      --gold: #d8b66a;
      --warn: #e8a35f;
      --serif: "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif;
      --sans: "Avenir Next", "Segoe UI", "Apple SD Gothic Neo", Pretendard, "Noto Sans KR", sans-serif;
      --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--text);
      font: 14px/1.6 var(--sans);
      background:
        radial-gradient(1100px 540px at 8% -10%, rgba(95, 196, 168, 0.11), transparent 62%),
        radial-gradient(900px 520px at 100% 104%, rgba(200, 149, 108, 0.09), transparent 60%),
        var(--bg);
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      background: repeating-linear-gradient(0deg, rgba(141, 168, 154, 0.035) 0 1px, transparent 1px 64px);
    }
    main {
      max-width: 1280px;
      margin: 0 auto;
      padding: 36px 24px 56px;
      display: grid;
      gap: 18px;
      position: relative;
    }
    main > * { animation: rise 0.55s cubic-bezier(0.22, 0.7, 0.25, 1) both; }
    main > *:nth-child(2) { animation-delay: 0.07s; }
    main > *:nth-child(3) { animation-delay: 0.14s; }
    main > *:nth-child(4) { animation-delay: 0.21s; }
    @keyframes rise {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      main > *, mark.changed-block:target { animation: none !important; }
      .switch .knob::after { transition: none !important; }
    }
    .panel {
      border: 1px solid var(--line);
      border-radius: 14px;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.016), transparent 42%), var(--panel);
      overflow: hidden;
    }
    .masthead {
      display: flex;
      flex-wrap: wrap;
      gap: 18px;
      justify-content: space-between;
      align-items: flex-end;
      padding: 4px 2px 18px;
      border-bottom: 1px solid var(--line);
      position: relative;
    }
    .masthead::after {
      content: "";
      position: absolute;
      left: 0;
      right: 0;
      bottom: 3px;
      height: 1px;
      background: var(--line);
    }
    .eyebrow {
      margin: 0;
      font: 600 11px/1 var(--mono);
      text-transform: uppercase;
      letter-spacing: 0.16em;
      color: var(--verdigris);
    }
    h1 {
      margin: 8px 0 8px;
      font: 500 clamp(26px, 4vw, 40px)/1.1 var(--serif);
      letter-spacing: 0.005em;
    }
    h1 .arrow { color: var(--verdigris); }
    .meta {
      margin: 0;
      font: 11.5px/1.5 var(--mono);
      color: var(--muted);
      word-break: break-all;
    }
    .controls {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      justify-content: flex-end;
    }
    .chip {
      display: inline-block;
      padding: 5px 11px;
      border: 1px solid var(--line);
      border-radius: 999px;
      font: 600 11px/1.2 var(--mono);
      text-transform: uppercase;
      letter-spacing: 0.07em;
      color: var(--muted);
      background: rgba(17, 22, 20, 0.7);
    }
    .jump { display: flex; gap: 6px; flex-wrap: wrap; }
    .jump-chip {
      min-width: 28px;
      text-align: center;
      text-decoration: none;
      color: var(--verdigris);
      border-color: rgba(95, 196, 168, 0.35);
    }
    .jump-chip:hover, .jump-chip:focus-visible { background: var(--verdigris-soft); }
    .toggle-input {
      position: absolute;
      width: 1px;
      height: 1px;
      opacity: 0;
    }
    .switch {
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      user-select: none;
    }
    .switch .knob {
      width: 22px;
      height: 12px;
      border-radius: 999px;
      border: 1px solid var(--line);
      position: relative;
    }
    .switch .knob::after {
      content: "";
      position: absolute;
      left: 1px;
      top: 1px;
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: var(--muted);
      transition: transform 0.18s ease, background 0.18s ease;
    }
    #changes-only:checked ~ main .switch {
      color: var(--verdigris);
      border-color: var(--verdigris);
    }
    #changes-only:checked ~ main .switch .knob::after {
      transform: translateX(10px);
      background: var(--verdigris);
    }
    #changes-only:focus-visible ~ main .switch {
      outline: 2px solid var(--verdigris);
      outline-offset: 2px;
    }
    #changes-only:checked ~ main .prose .ctx { display: none; }
    #changes-only:checked ~ main .prose .gap { display: block; }
    .scores {
      display: grid;
      gap: 16px;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    }
    .score-card { padding: 16px 18px 18px; border-top: 2px solid transparent; }
    .score-card.side-before { border-top-color: var(--bronze); }
    .score-card.side-after { border-top-color: var(--verdigris); }
    .score-card h2 {
      margin: 0 0 12px;
      font: 600 11px/1 var(--mono);
      text-transform: uppercase;
      letter-spacing: 0.14em;
      color: var(--muted);
    }
    .score-number { margin: 0; font: 500 42px/1 var(--serif); }
    .score-scale { font-size: 14px; color: var(--muted); margin-left: 5px; }
    .score-verdict { margin: 8px 0 0; color: var(--gold); font-size: 13px; }
    .score-skip { margin: 0; font: 500 22px/1.2 var(--serif); color: var(--muted); }
    .score-note { margin: 8px 0 0; color: var(--muted); font-size: 12.5px; }
    .facts { display: flex; flex-wrap: wrap; gap: 20px; margin: 16px 0 0; }
    .fact dt {
      font: 600 10.5px/1 var(--mono);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--muted);
    }
    .fact dd { margin: 4px 0 0; font-size: 14px; }
    .compare {
      display: grid;
      gap: 16px;
      grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
      align-items: start;
    }
    .pane-title {
      position: sticky;
      top: 0;
      z-index: 1;
      margin: 0;
      padding: 14px 18px 10px;
      font: 600 11px/1 var(--mono);
      text-transform: uppercase;
      letter-spacing: 0.14em;
      background: linear-gradient(180deg, var(--panel) 72%, rgba(17, 22, 20, 0));
    }
    .pane-before .pane-title { color: var(--bronze); }
    .pane-after .pane-title { color: var(--verdigris); }
    .prose {
      padding: 4px 18px 18px;
      white-space: pre-wrap;
      word-break: break-word;
      font: 15px/1.85 "Apple SD Gothic Neo", Pretendard, "Noto Sans KR", "Segoe UI", sans-serif;
      color: #dde7e0;
    }
    .prose .gap {
      display: none;
      color: var(--muted);
      text-align: center;
      letter-spacing: 0.4em;
      padding: 6px 0;
    }
    mark.changed-block {
      display: inline;
      color: inherit;
      border-radius: 4px;
      padding: 1px 4px;
      scroll-margin-top: 96px;
    }
    .pane-before mark.changed-block {
      background: var(--bronze-soft);
      box-shadow: inset 0 -2px 0 var(--bronze);
    }
    .pane-after mark.changed-block {
      background: var(--verdigris-soft);
      box-shadow: inset 0 -2px 0 var(--verdigris);
    }
    mark.changed-block::before {
      content: attr(data-n);
      display: inline-block;
      min-width: 17px;
      margin-right: 7px;
      text-align: center;
      border-radius: 999px;
      font: 700 10.5px/17px var(--mono);
    }
    .pane-before mark.changed-block::before { background: var(--bronze); color: #20150c; }
    .pane-after mark.changed-block::before { background: var(--verdigris); color: #0b201a; }
    mark.changed-block:target {
      animation: flash 1.2s ease 1;
      outline: 1.5px solid var(--verdigris);
      outline-offset: 3px;
    }
    @keyframes flash {
      from { filter: brightness(1.9); }
      to { filter: none; }
    }
    .explain { padding: 16px 18px 18px; }
    .explain .pane-title {
      position: static;
      padding: 0 0 12px;
      background: none;
      color: var(--muted);
    }
    .explain-cards { display: grid; gap: 12px; }
    .explain-card {
      border: 1px solid var(--line);
      border-left: 3px solid var(--verdigris);
      border-radius: 10px;
      padding: 12px 16px;
      background: rgba(95, 196, 168, 0.04);
      font-size: 13.5px;
      line-height: 1.75;
    }
    .explain-card strong { color: var(--gold); font-weight: 600; }
    .explain-card code {
      font: 12.5px var(--mono);
      background: rgba(200, 149, 108, 0.13);
      border-radius: 4px;
      padding: 1px 5px;
      color: #e8c9a8;
    }
    .explain-empty { margin: 0; color: var(--muted); }
    .warning { margin: 0 0 12px; color: var(--warn); }
  </style>
</head>
<body>
  ${toggleInput}
  <main>
    <header class="masthead">
      <div>
        <p class="eyebrow">patina · galley proof</p>
        <h1>Before <span class="arrow">→</span> After</h1>
        <p class="meta">Source: ${escapedSourcePath}</p>
      </div>
      <div class="controls">
        <span class="chip">${changeChip}</span>
        ${jumpNav}
        ${toggleLabel}
      </div>
    </header>
    <section class="scores">
      ${renderScoreCard('Before', 'side-before', beforeScore)}
      ${renderScoreCard('After', 'side-after', afterScore)}
    </section>
    <section class="compare">
      <article class="panel pane pane-before">
        <h2 class="pane-title">Before</h2>
        <div class="prose">${beforeHtml}</div>
      </article>
      <article class="panel pane pane-after">
        <h2 class="pane-title">After</h2>
        <div class="prose">${afterHtml}</div>
      </article>
    </section>
    <section class="panel explain">
      <h2 class="pane-title">Pattern explanation</h2>
      ${failureNotice}
      <div class="explain-cards">${explanationHtml}</div>
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

function renderScoreCard(title, sideClass, score) {
  const head = `<h2>${htmlEscape(title)}</h2>`;
  const wrap = (body) => `<article class="panel score-card ${sideClass}">${head}${body}</article>`;

  if (!score || typeof score !== 'object') {
    return wrap('<p class="score-skip">Not scored</p><p class="score-note">Score unavailable.</p>');
  }
  if (score.skipped || score.error || score.overall === null || score.overall === undefined) {
    return wrap(`<p class="score-skip">Not scored</p><p class="score-note">${htmlEscape(describeSkipReason(score))}</p>`);
  }

  const facts = [];
  if (Number.isFinite(score.paragraphCount)) facts.push(['Paragraphs', score.paragraphCount]);
  if (Number.isFinite(score.hotParagraphs)) facts.push(['Hot paragraphs', score.hotParagraphs]);
  if (Number.isFinite(score.signalScore)) facts.push(['Signal score', score.signalScore]);
  const factsHtml = facts.length
    ? `<dl class="facts">${facts.map(([label, value]) =>
      `<div class="fact"><dt>${htmlEscape(label)}</dt><dd>${htmlEscape(String(value))}</dd></div>`).join('')}</dl>`
    : '';
  const verdict = score.interpretation
    ? `<p class="score-verdict">${htmlEscape(String(score.interpretation))}</p>`
    : '';
  return wrap(`<p class="score-number">${htmlEscape(String(score.overall))}<span class="score-scale">/100</span></p>${verdict}${factsHtml}`);
}

function describeSkipReason(score) {
  if (score.skipReason === 'paragraphs<=2') return 'Deterministic scoring needs more than two paragraphs.';
  if (score.skipReason) return `Scoring skipped: ${score.skipReason}.`;
  if (score.error) return `Scoring unavailable: ${score.error}.`;
  return 'Scoring unavailable.';
}

// Minimal markdown rendering for the diff-explanation text: bold, inline
// code, and --- section breaks. Everything is HTML-escaped first; anything
// beyond these three forms stays visible as plain text.
function renderExplanationHtml(text) {
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

// Consecutive changed blocks form one numbered hunk so readers can count and
// jump between edits; unchanged runs are wrapped so the CSS-only
// "changes only" toggle can hide them and reveal a gap marker instead.
function renderBlocks(blocks, matchedSet, side) {
  const runs = [];
  blocks.forEach((block, index) => {
    const changed = Boolean(block.text) && !matchedSet.has(index);
    const last = runs[runs.length - 1];
    if (last && last.changed === changed) last.blocks.push(block);
    else runs.push({ changed, blocks: [block] });
  });

  let changeCount = 0;
  const html = runs.map((run) => {
    if (!run.changed) {
      const text = run.blocks
        .map((block) => `${htmlEscape(block.text)}${htmlEscape(block.separator)}`)
        .join('');
      return `<span class="ctx">${text}</span><span class="gap" aria-hidden="true">⋯</span>`;
    }
    changeCount += 1;
    // The run's trailing separator stays outside the mark so the highlight
    // never paints trailing blank lines.
    const inner = run.blocks
      .map((block, index) => htmlEscape(block.text) + (index < run.blocks.length - 1 ? htmlEscape(block.separator) : ''))
      .join('');
    const trailing = htmlEscape(run.blocks[run.blocks.length - 1].separator);
    return `<mark class="changed-block" id="${side}-change-${changeCount}" data-n="${changeCount}">${inner}</mark>${trailing}`;
  }).join('');

  return { html, changeCount };
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
