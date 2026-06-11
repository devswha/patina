import { htmlEscape, diffBlockPairs } from './browser-diff.js';

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_FETCH_TIMEOUT_MS = 30000;
const DEFAULT_MIN_BLOCK_LENGTH = 20;
const DEFAULT_MAX_BLOCKS = 200;
const MAX_JUMP_CHIPS = 12;

// Block-level tags whose plain-text content patina may rewrite. Tables,
// buttons, navs, and anything with nested markup are intentionally absent:
// the v1 walker only touches blocks it can swap back losslessly.
const PROSE_TAGS = 'p|h1|h2|h3|h4|h5|h6|li|blockquote|figcaption|dt|dd|summary';

// Containers whose content must never be treated as prose, even when it
// happens to contain things that look like prose tags (e.g. serialized HTML
// inside a Next.js data script).
const EXCLUDED_CONTAINERS = 'head|script|style|noscript|template|textarea|svg|iframe|select|option|code|pre';

export async function fetchPreviewPage(url, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const outerSignal = options.signal;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`fetch timed out after ${timeoutMs}ms`)), timeoutMs);
  const onOuterAbort = () => controller.abort(outerSignal.reason);
  if (outerSignal) {
    if (outerSignal.aborted) controller.abort(outerSignal.reason);
    else outerSignal.addEventListener('abort', onOuterAbort, { once: true });
  }

  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { accept: 'text/html,application/xhtml+xml' },
    });
    if (!response.ok) {
      throw new Error(`the page returned HTTP ${response.status}`);
    }
    const contentType = response.headers.get('content-type') || '';
    if (contentType && !/html/i.test(contentType)) {
      throw new Error(`the page is ${contentType.split(';')[0]}, not HTML`);
    }
    const html = await response.text();
    if (html.length > maxBytes) {
      throw new Error(`the page is larger than the ${Math.round(maxBytes / 1024 / 1024)}MB preview limit`);
    }
    return { html, finalUrl: response.url || url };
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener?.('abort', onOuterAbort);
  }
}

// Prepare fetched HTML for extraction and overlay: harvest the React
// streaming swap operations while the inline scripts still exist, drop
// active content, then statically resolve the stream so Suspense content
// is visible without JS.
export function prepareSnapshotHtml(html) {
  const raw = String(html ?? '');
  const ops = harvestStreamOps(raw);
  return resolveStreamedHtml(stripActiveContent(raw), ops);
}

// React 18 streaming SSR ships late content as hidden segments
// (<div hidden id="S:n">…</div>) appended near the end of <body>, plus
// inline runtime calls that swap them into place:
//   $RC("B:n","S:m") — replace a Suspense boundary's fallback (the markup
//     after <template id="B:n"></template> up to the boundary-closing
//     <!--/$--> comment) with segment S:m;
//   $RS("S:m","P:n") — replace the placeholder <template id="P:n"></template>
//     itself with segment S:m.
// The B/P↔S pairing exists only in those calls, so it must be harvested
// before scripts are stripped.
export function harvestStreamOps(html) {
  const ops = [];
  const source = String(html ?? '');
  const rcRe = /\$RC\(\s*"(B:[^"]+)"\s*,\s*"(S:[^"]+)"/g;
  let match;
  while ((match = rcRe.exec(source)) !== null) {
    ops.push({ kind: 'boundary', targetId: match[1], contentId: match[2] });
  }
  const rsRe = /\$RS\(\s*"(S:[^"]+)"\s*,\s*"(P:[^"]+)"/g;
  while ((match = rsRe.exec(source)) !== null) {
    ops.push({ kind: 'placeholder', contentId: match[1], targetId: match[2] });
  }
  return ops;
}

// The preview snapshot strips scripts, so without static resolution these
// pages would show their loading spinners forever. Ops are applied until a
// full pass makes no progress (segments and their targets can be nested in
// either order); targets whose segment never streamed keep their fallback.
// Leftover hidden segments are removed afterwards so the extractor cannot
// rewrite invisible text.
export function resolveStreamedHtml(html, ops = harvestStreamOps(html)) {
  let out = String(html ?? '');
  const pending = [...ops];
  let progressed = true;
  while (progressed && pending.length > 0) {
    progressed = false;
    for (let i = 0; i < pending.length; i++) {
      const applied = applyStreamOp(out, pending[i]);
      if (applied !== null) {
        out = applied;
        pending.splice(i, 1);
        i -= 1;
        progressed = true;
      }
    }
  }
  for (let guard = 0; guard < 200; guard++) {
    const leftover = findStreamSegment(out, null);
    if (!leftover) break;
    out = out.slice(0, leftover.start) + out.slice(leftover.end);
  }
  return out;
}

function applyStreamOp(html, op) {
  const templateTag = `<template id="${op.targetId}"></template>`;
  if (!html.includes(templateTag)) return null;
  const segment = findStreamSegment(html, op.contentId);
  if (!segment) return null;

  const withoutSegment = html.slice(0, segment.start) + html.slice(segment.end);
  const templateStart = withoutSegment.indexOf(templateTag);
  if (templateStart === -1) return null;

  if (op.kind === 'placeholder') {
    return withoutSegment.slice(0, templateStart)
      + segment.content
      + withoutSegment.slice(templateStart + templateTag.length);
  }
  const fallbackStart = templateStart + templateTag.length;
  const fallbackEnd = findBoundaryEnd(withoutSegment, fallbackStart);
  if (fallbackEnd === -1) return null;
  return withoutSegment.slice(0, templateStart)
    + segment.content
    + withoutSegment.slice(fallbackEnd);
}

// React writes streamed segments literally as <div hidden id="S:n">…</div>,
// one after another. Tag-balance counting is unreliable on real-world
// markup, so each segment is bounded by the next streamed div (or </body>),
// and the wrapper's own closing tag is the last </div> before that boundary.
const STREAM_DIV_PREFIX = '<div hidden id="S:';

function findStreamSegment(html, id) {
  const opener = id === null ? STREAM_DIV_PREFIX : `<div hidden id="${id}"`;
  const start = html.indexOf(opener);
  if (start === -1) return null;
  const tagEnd = html.indexOf('>', start);
  if (tagEnd === -1) return null;

  const nextDiv = html.indexOf(STREAM_DIV_PREFIX, tagEnd + 1);
  const bodyClose = html.indexOf('</body>', tagEnd + 1);
  const boundary = Math.min(
    nextDiv === -1 ? html.length : nextDiv,
    bodyClose === -1 ? html.length : bodyClose,
  );
  const lastClose = html.lastIndexOf('</div>', boundary);
  if (lastClose <= tagEnd) return null;
  return {
    start,
    end: lastClose + '</div>'.length,
    content: html.slice(tagEnd + 1, lastClose),
  };
}

// A fallback segment ends at its boundary-closing comment <!--/$-->;
// nested suspense boundaries open with <!--$?-->, <!--$-->, or <!--$!-->.
function findBoundaryEnd(html, fromIndex) {
  const markerRe = /<!--\$[?!]?-->|<!--\/\$-->/g;
  markerRe.lastIndex = fromIndex;
  let depth = 1;
  let match;
  while ((match = markerRe.exec(html)) !== null) {
    if (match[0] === '<!--/$-->') {
      depth -= 1;
      if (depth === 0) return match.index;
    } else {
      depth += 1;
    }
  }
  return -1;
}

export function extractProseBlocks(html, options = {}) {
  const minLength = options.minLength ?? DEFAULT_MIN_BLOCK_LENGTH;
  const maxBlocks = options.maxBlocks ?? DEFAULT_MAX_BLOCKS;
  const source = String(html ?? '');
  const excluded = collectExcludedRanges(source);

  const blocks = [];
  let truncated = false;
  const blockRe = new RegExp(`<(${PROSE_TAGS})\\b[^>]*>([^<]+)</\\1\\s*>`, 'gi');
  let match;
  while ((match = blockRe.exec(source)) !== null) {
    if (isInsideRanges(excluded, match.index)) continue;
    const openEnd = match.index + match[0].indexOf('>') + 1;
    const raw = match[2];
    const text = decodeEntities(raw).replace(/\s+/g, ' ').trim();
    if (text.length < minLength) continue;
    if (!/[A-Za-z가-힣぀-ヿ㐀-鿿]/.test(text)) continue;
    if (blocks.length >= maxBlocks) {
      truncated = true;
      break;
    }
    blocks.push({
      tag: match[1].toLowerCase(),
      start: openEnd,
      end: openEnd + raw.length,
      raw,
      text,
    });
  }
  return { blocks, truncated };
}

export function alignRewrites(blocks, rewrittenBody) {
  const paragraphs = String(rewrittenBody ?? '')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (paragraphs.length !== blocks.length) {
    throw new Error(`the rewrite returned ${paragraphs.length} paragraphs for ${blocks.length} prose blocks`);
  }
  return paragraphs;
}

export function buildPreviewHtml({ html, blocks, rewrites, sourceUrl, explanationHtml = '', scoreChip = null }) {
  let changedCount = 0;
  const planned = blocks.map((block, index) => {
    const rewritten = rewrites[index];
    if (rewritten === block.text) return null;
    changedCount += 1;
    return { block, rewritten, n: changedCount };
  }).filter(Boolean);

  let out = String(html);
  for (const { block, rewritten, n } of [...planned].reverse()) {
    const replacement = `<span class="ptna-blk" id="ptna-${n}" data-n="${n}">`
      + `<span class="ptna-after">${htmlEscape(rewritten)}</span>`
      + `<span class="ptna-before">${block.raw}</span>`
      + '</span>';
    out = out.slice(0, block.start) + replacement + out.slice(block.end);
  }

  out = stripActiveContent(out);
  out = injectHead(out, sourceUrl);
  out = injectChrome(out, { changedCount, totalCount: blocks.length, explanationHtml, scoreChip });
  return { html: out, changedCount, totalCount: blocks.length };
}

// File input has no host page to overlay, so render the text as a reading
// document of our own and reuse the same in-place chrome. LCS hunk pairing
// (diffBlockPairs) means the model does not have to preserve paragraph
// counts for file previews.
export function buildFilePreviewHtml({ originalText, rewrittenText, sourcePath, explanationHtml = '', scoreChip = null }) {
  const pairs = diffBlockPairs(originalText, rewrittenText);
  let changedCount = 0;
  const doc = pairs.map((pair) => {
    if (pair.type === 'same') return htmlEscape(pair.text);
    changedCount += 1;
    return `<span class="ptna-blk" id="ptna-${changedCount}" data-n="${changedCount}">`
      + `<span class="ptna-after">${htmlEscape(pair.after)}</span>`
      + `<span class="ptna-before">${htmlEscape(pair.before)}</span>`
      + '</span>';
  }).join('\n\n');
  const totalCount = pairs.length;

  const shell = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'">
<title>patina preview</title>
<style>${FILE_PAGE_CSS}</style>
</head>
<body>
<main class="ptna-page">
  <header class="ptna-mast">
    <p class="ptna-eyebrow">patina · preview</p>
    <p class="ptna-src">Source: ${htmlEscape(sourcePath)}</p>
  </header>
  <div class="ptna-doc">${doc}</div>
</main>
</body>
</html>`;
  const out = injectChrome(shell, { changedCount, totalCount, explanationHtml, scoreChip });
  return { html: out, changedCount, totalCount };
}

// The snapshot must stay inert: scripts are removed entirely (hydration
// would revert the swapped text), inline handlers and javascript: URLs are
// neutralized, and meta CSP/refresh tags are dropped because they could
// block the injected overlay styles or navigate away from the snapshot.
function stripActiveContent(html) {
  let out = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*\/\s*>/gi, '')
    .replace(/<meta\b[^>]*http-equiv\s*=\s*["']?(?:content-security-policy|refresh)[^>]*>/gi, '');
  for (let pass = 0; pass < 10; pass++) {
    const next = out.replace(/(<[a-zA-Z][^>]*?)\s+on[a-zA-Z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/g, '$1');
    if (next === out) break;
    out = next;
  }
  return out.replace(/(\s(?:href|src|action|formaction)\s*=\s*["']?\s*)javascript:/gi, '$1blocked:');
}

function injectHead(html, sourceUrl) {
  const baseTag = /<base\b/i.test(html) ? '' : `<base href="${htmlEscape(sourceUrl)}">`;
  const injection = `${baseTag}<style id="ptna-style">${PREVIEW_CSS}</style>`;
  if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, `$&${injection}`);
  if (/<html\b[^>]*>/i.test(html)) return html.replace(/<html\b[^>]*>/i, `$&<head>${injection}</head>`);
  return `<head>${injection}</head>${html}`;
}

function injectChrome(html, { changedCount, totalCount, explanationHtml = '', scoreChip = null }) {
  const inputs = changedCount > 0
    ? '<input type="radio" name="ptna-view" id="ptna-v-rew" class="ptna-toggle-input" checked>'
      + '<input type="radio" name="ptna-view" id="ptna-v-orig" class="ptna-toggle-input">'
      + '<input type="radio" name="ptna-view" id="ptna-v-both" class="ptna-toggle-input">'
    : '';
  const chips = Array.from({ length: Math.min(changedCount, MAX_JUMP_CHIPS) }, (_, i) =>
    `<a class="ptna-chip" href="#ptna-${i + 1}">${i + 1}</a>`).join('');
  const overflow = changedCount > MAX_JUMP_CHIPS
    ? `<span class="ptna-chip ptna-chip-more">+${changedCount - MAX_JUMP_CHIPS}</span>`
    : '';
  const views = changedCount > 0
    ? '<div class="ptna-views">'
      + '<label class="ptna-view" for="ptna-v-rew">rewritten</label>'
      + '<label class="ptna-view" for="ptna-v-orig">original</label>'
      + '<label class="ptna-view" for="ptna-v-both">both</label>'
      + '</div>'
    : '';
  const notes = explanationHtml
    ? `<details class="ptna-notes"><summary>patina notes</summary><div class="ptna-notes-body">${explanationHtml}</div></details>`
    : '';
  const bar = `<div class="ptna-bar"><span class="ptna-brand">patina</span>`
    + `<span class="ptna-count">${changedCount} of ${totalCount} blocks rewritten</span>`
    + (scoreChip ? `<span class="ptna-score">${htmlEscape(scoreChip)}</span>` : '')
    + (chips ? `<nav class="ptna-jump" aria-label="Jump to rewrite">${chips}${overflow}</nav>` : '')
    + views
    + '</div>';

  let out = html;
  if (/<body\b[^>]*>/i.test(out)) out = out.replace(/<body\b[^>]*>/i, `$&${inputs}`);
  else out = `${inputs}${out}`;
  if (/<\/body\s*>/i.test(out)) return out.replace(/<\/body\s*>/i, `${notes}${bar}$&`);
  return `${out}${notes}${bar}`;
}

function collectExcludedRanges(html) {
  const ranges = [];
  const containerRe = new RegExp(`<(${EXCLUDED_CONTAINERS})\\b[^>]*>[\\s\\S]*?</\\1\\s*>`, 'gi');
  let match;
  while ((match = containerRe.exec(html)) !== null) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  const commentRe = /<!--[\s\S]*?-->/g;
  while ((match = commentRe.exec(html)) !== null) {
    ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

function isInsideRanges(ranges, index) {
  return ranges.some(([start, end]) => index >= start && index < end);
}

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

// All selectors are ptna-prefixed and critical properties carry !important
// so the host page's stylesheet cannot hide the overlay. Three view states
// (radio hack, no JS): rewritten (default), original, both — "both" keeps
// the rewrite and shows the struck-through original beside it.
const PREVIEW_CSS = `
.ptna-toggle-input{position:absolute !important;width:1px;height:1px;opacity:0;}
.ptna-blk{scroll-margin-top:90px;}
.ptna-blk .ptna-before{display:none !important;}
.ptna-blk .ptna-after{background:rgba(95,196,168,0.20) !important;box-shadow:inset 0 -2px 0 #5fc4a8 !important;border-radius:3px;padding:0 2px;color:inherit;}
#ptna-v-orig:checked ~ * .ptna-blk .ptna-after{display:none !important;}
#ptna-v-orig:checked ~ * .ptna-blk .ptna-before{display:inline !important;background:rgba(200,149,108,0.20) !important;box-shadow:inset 0 -2px 0 #c8956c !important;border-radius:3px;padding:0 2px;color:inherit;}
#ptna-v-both:checked ~ * .ptna-blk .ptna-before{display:inline !important;background:rgba(200,149,108,0.16) !important;box-shadow:inset 0 -2px 0 #c8956c !important;border-radius:3px;padding:0 2px;color:inherit;text-decoration:line-through;opacity:0.75;margin-left:7px;}
.ptna-blk::before{content:attr(data-n);display:inline-block !important;min-width:16px;margin-right:6px;text-align:center;border-radius:999px;background:#5fc4a8;color:#0b201a;font:700 10px/16px ui-monospace,Menlo,Consolas,monospace !important;vertical-align:2px;}
#ptna-v-orig:checked ~ * .ptna-blk::before{background:#c8956c;color:#20150c;}
.ptna-blk:target .ptna-after,#ptna-v-orig:checked ~ * .ptna-blk:target .ptna-before{outline:2px solid #5fc4a8 !important;outline-offset:2px;}
.ptna-bar{position:fixed !important;left:50% !important;bottom:18px !important;transform:translateX(-50%);z-index:2147483647 !important;display:flex !important;flex-wrap:wrap;gap:12px;align-items:center;justify-content:center;max-width:94vw;padding:9px 16px;border-radius:999px;border:1px solid rgba(95,196,168,0.4);background:rgba(11,14,13,0.93) !important;color:#cfe2d8 !important;font:600 11px/1.2 ui-monospace,Menlo,Consolas,monospace !important;letter-spacing:0.06em;text-transform:uppercase;box-shadow:0 6px 28px rgba(0,0,0,0.45);}
.ptna-brand{color:#5fc4a8 !important;letter-spacing:0.16em;}
.ptna-count{color:#8da59a !important;}
.ptna-score{color:#d8b66a !important;}
.ptna-jump{display:flex;gap:5px;flex-wrap:wrap;}
.ptna-chip{min-width:22px;text-align:center;padding:3px 0;border:1px solid rgba(95,196,168,0.35);border-radius:999px;color:#5fc4a8 !important;text-decoration:none !important;font:inherit !important;}
.ptna-chip:hover{background:rgba(95,196,168,0.15);}
.ptna-chip-more{border-color:rgba(141,165,154,0.3);color:#8da59a !important;}
.ptna-views{display:inline-flex;border:1px solid rgba(141,165,154,0.4);border-radius:999px;overflow:hidden;}
.ptna-view{padding:4px 11px;cursor:pointer;user-select:none;color:#8da59a;font:inherit;}
.ptna-view:hover{color:#cfe2d8;}
#ptna-v-rew:checked ~ .ptna-bar label[for="ptna-v-rew"]{background:rgba(95,196,168,0.22);color:#5fc4a8;}
#ptna-v-orig:checked ~ .ptna-bar label[for="ptna-v-orig"]{background:rgba(200,149,108,0.22);color:#c8956c;}
#ptna-v-both:checked ~ .ptna-bar label[for="ptna-v-both"]{background:rgba(216,182,106,0.20);color:#d8b66a;}
.ptna-notes{position:fixed !important;right:18px;bottom:74px;z-index:2147483646 !important;max-width:min(440px,92vw);font:13px/1.7 "Apple SD Gothic Neo",Pretendard,"Noto Sans KR","Segoe UI",sans-serif !important;color:#dde7e0 !important;}
.ptna-notes summary{cursor:pointer;list-style:none;display:inline-block;padding:6px 13px;border-radius:999px;border:1px solid rgba(216,182,106,0.45);background:rgba(11,14,13,0.93);color:#d8b66a;font:600 11px/1.2 ui-monospace,Menlo,Consolas,monospace;letter-spacing:0.08em;text-transform:uppercase;float:right;}
.ptna-notes summary::-webkit-details-marker{display:none;}
.ptna-notes[open] summary{border-bottom-left-radius:0;border-bottom-right-radius:0;}
.ptna-notes-body{clear:both;max-height:46vh;overflow:auto;margin-top:2px;padding:12px 14px;border:1px solid rgba(216,182,106,0.35);border-radius:12px;background:rgba(11,14,13,0.96);}
.ptna-notes-body .explain-card{border:1px solid rgba(132,168,152,0.2);border-left:3px solid #5fc4a8;border-radius:8px;padding:9px 12px;margin:0 0 10px;background:rgba(95,196,168,0.05);}
.ptna-notes-body .explain-card:last-child{margin-bottom:0;}
.ptna-notes-body .explain-card strong{color:#d8b66a;}
.ptna-notes-body .explain-card code{font:12px ui-monospace,Menlo,Consolas,monospace;background:rgba(200,149,108,0.14);border-radius:4px;padding:1px 4px;color:#e8c9a8;}
@media (prefers-reduced-motion:reduce){.ptna-view{transition:none !important;}}
`.replace(/\n/g, '');

// Standalone shell styling for file previews — same galley identity as the
// browser diff page, single reading column.
const FILE_PAGE_CSS = `${PREVIEW_CSS}
:root{color-scheme:dark;}
body{margin:0;background:radial-gradient(1100px 540px at 8% -10%,rgba(95,196,168,0.11),transparent 62%),radial-gradient(900px 520px at 100% 104%,rgba(200,149,108,0.09),transparent 60%),#0b0e0d;color:#e9efe9;}
.ptna-page{max-width:760px;margin:0 auto;padding:40px 22px 120px;}
.ptna-mast{border-bottom:1px solid rgba(132,168,152,0.16);padding-bottom:14px;margin-bottom:26px;}
.ptna-eyebrow{margin:0 0 8px;font:600 11px/1 ui-monospace,Menlo,Consolas,monospace;text-transform:uppercase;letter-spacing:0.16em;color:#5fc4a8;}
.ptna-src{margin:0;font:11.5px/1.5 ui-monospace,Menlo,Consolas,monospace;color:#8da59a;word-break:break-all;}
.ptna-doc{white-space:pre-wrap;word-break:break-word;font:15.5px/1.9 "Apple SD Gothic Neo",Pretendard,"Noto Sans KR","Segoe UI",sans-serif;color:#dde7e0;}
`.replace(/\n/g, '');
