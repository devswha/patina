import { htmlEscape } from './browser-diff.js';

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

export function buildPreviewHtml({ html, blocks, rewrites, sourceUrl }) {
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
  out = injectChrome(out, { changedCount, totalCount: blocks.length });
  return { html: out, changedCount };
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

function injectChrome(html, { changedCount, totalCount }) {
  const toggle = changedCount > 0
    ? '<input type="checkbox" id="ptna-orig" class="ptna-toggle-input">'
    : '';
  const chips = Array.from({ length: Math.min(changedCount, MAX_JUMP_CHIPS) }, (_, i) =>
    `<a class="ptna-chip" href="#ptna-${i + 1}">${i + 1}</a>`).join('');
  const overflow = changedCount > MAX_JUMP_CHIPS
    ? `<span class="ptna-chip ptna-chip-more">+${changedCount - MAX_JUMP_CHIPS}</span>`
    : '';
  const switchHtml = changedCount > 0
    ? `<label class="ptna-switch" for="ptna-orig"><span class="ptna-knob"></span><span class="ptna-state ptna-state-rew">rewritten</span><span class="ptna-state ptna-state-orig">original</span></label>`
    : '';
  const bar = `<div class="ptna-bar"><span class="ptna-brand">patina</span>`
    + `<span class="ptna-count">${changedCount} of ${totalCount} blocks rewritten</span>`
    + (chips ? `<nav class="ptna-jump" aria-label="Jump to rewrite">${chips}${overflow}</nav>` : '')
    + switchHtml
    + '</div>';

  let out = html;
  if (/<body\b[^>]*>/i.test(out)) out = out.replace(/<body\b[^>]*>/i, `$&${toggle}`);
  else out = `${toggle}${out}`;
  if (/<\/body\s*>/i.test(out)) return out.replace(/<\/body\s*>/i, `${bar}$&`);
  return `${out}${bar}`;
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
// so the host page's stylesheet cannot hide the overlay.
const PREVIEW_CSS = `
.ptna-toggle-input{position:absolute !important;width:1px;height:1px;opacity:0;}
.ptna-blk{scroll-margin-top:90px;}
.ptna-blk .ptna-before{display:none !important;}
.ptna-blk .ptna-after{background:rgba(95,196,168,0.20) !important;box-shadow:inset 0 -2px 0 #5fc4a8 !important;border-radius:3px;padding:0 2px;color:inherit;}
#ptna-orig:checked ~ * .ptna-blk .ptna-after{display:none !important;}
#ptna-orig:checked ~ * .ptna-blk .ptna-before{display:inline !important;background:rgba(200,149,108,0.20) !important;box-shadow:inset 0 -2px 0 #c8956c !important;border-radius:3px;padding:0 2px;color:inherit;}
.ptna-blk::before{content:attr(data-n);display:inline-block !important;min-width:16px;margin-right:6px;text-align:center;border-radius:999px;background:#5fc4a8;color:#0b201a;font:700 10px/16px ui-monospace,Menlo,Consolas,monospace !important;vertical-align:2px;}
#ptna-orig:checked ~ * .ptna-blk::before{background:#c8956c;color:#20150c;}
.ptna-blk:target .ptna-after,#ptna-orig:checked ~ * .ptna-blk:target .ptna-before{outline:2px solid #5fc4a8 !important;outline-offset:2px;}
.ptna-bar{position:fixed !important;left:50% !important;bottom:18px !important;transform:translateX(-50%);z-index:2147483647 !important;display:flex !important;gap:12px;align-items:center;padding:9px 16px;border-radius:999px;border:1px solid rgba(95,196,168,0.4);background:rgba(11,14,13,0.93) !important;color:#cfe2d8 !important;font:600 11px/1.2 ui-monospace,Menlo,Consolas,monospace !important;letter-spacing:0.06em;text-transform:uppercase;box-shadow:0 6px 28px rgba(0,0,0,0.45);}
.ptna-brand{color:#5fc4a8 !important;letter-spacing:0.16em;}
.ptna-count{color:#8da59a !important;}
.ptna-jump{display:flex;gap:5px;}
.ptna-chip{min-width:22px;text-align:center;padding:3px 0;border:1px solid rgba(95,196,168,0.35);border-radius:999px;color:#5fc4a8 !important;text-decoration:none !important;font:inherit !important;}
.ptna-chip:hover{background:rgba(95,196,168,0.15);}
.ptna-chip-more{border-color:rgba(141,165,154,0.3);color:#8da59a !important;}
.ptna-switch{display:inline-flex;align-items:center;gap:7px;cursor:pointer;user-select:none;color:#5fc4a8 !important;}
.ptna-knob{width:22px;height:12px;border-radius:999px;border:1px solid rgba(141,165,154,0.5);position:relative;}
.ptna-knob::after{content:"";position:absolute;left:1px;top:1px;width:8px;height:8px;border-radius:999px;background:#5fc4a8;transition:transform 0.18s ease,background 0.18s ease;}
#ptna-orig:checked ~ .ptna-bar .ptna-knob::after{transform:translateX(10px);background:#c8956c;}
.ptna-state-orig{display:none;}
#ptna-orig:checked ~ .ptna-bar .ptna-state-rew{display:none;}
#ptna-orig:checked ~ .ptna-bar .ptna-state-orig{display:inline;color:#c8956c !important;}
#ptna-orig:checked ~ .ptna-bar .ptna-switch{color:#c8956c !important;}
@media (prefers-reduced-motion:reduce){.ptna-knob::after{transition:none !important;}}
`.replace(/\n/g, '');
