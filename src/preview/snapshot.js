import { htmlEscape } from '../browser-diff.js';
import { fetchCappedBytes, readResponseBytesCapped } from '../ocr.js';
import { isSubresourceFetchAllowed } from '../security.js';
import { stripActiveContent, fromCodePointSafe } from './dom.js';

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_FETCH_TIMEOUT_MS = 30000;
const MAX_PAGE_REDIRECTS = 5;

export async function fetchPreviewPage(url, options = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const lookupImpl = options.lookupImpl;
  const outerSignal = options.signal;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`fetch timed out after ${timeoutMs}ms`)), timeoutMs);
  const onOuterAbort = () => controller.abort(outerSignal.reason);
  if (outerSignal) {
    if (outerSignal.aborted) controller.abort(outerSignal.reason);
    else outerSignal.addEventListener('abort', onOuterAbort, { once: true });
  }

  try {
    // Follow redirects manually so every hop is SSRF-guarded. The user-typed
    // URL is trusted (it may legitimately point at a localhost dev server),
    // but redirect Location headers are server-controlled content: a hostile
    // public page must not be able to 30x the preview into cloud metadata or
    // an internal host — especially since the final hop becomes baseUrl,
    // which the subresource guard then treats as "the page's own host"
    // (same containment rule as fetchCappedBytes in ocr.js).
    let current = url;
    let response;
    for (let hop = 0; ; hop++) {
      response = await fetchImpl(current, {
        signal: controller.signal,
        redirect: 'manual',
        headers: { accept: 'text/html,application/xhtml+xml' },
      });
      const location = response.status >= 300 && response.status < 400
        ? response.headers.get('location')
        : null;
      if (!location) break;
      if (hop >= MAX_PAGE_REDIRECTS) {
        throw new Error('the page redirected too many times');
      }
      const next = new URL(location, current).href;
      if (!(await isSubresourceFetchAllowed(next, { baseUrl: url, lookupImpl }))) {
        throw new Error('the page redirected to a private/internal address');
      }
      current = next;
    }
    if (!response.ok) {
      throw new Error(`the page returned HTTP ${response.status}`);
    }
    const contentType = response.headers.get('content-type') || '';
    if (contentType && !/html/i.test(contentType)) {
      throw new Error(`the page is ${contentType.split(';')[0]}, not HTML`);
    }
    // Stream the body under a true byte cap instead of buffering the whole
    // response and checking UTF-16 code-unit length: a hostile/misconfigured
    // server could otherwise stream hundreds of MB within the timeout, and
    // `.length` undercounts multi-byte (e.g. Korean) pages (#447).
    const buf = await readResponseBytesCapped(response, {
      maxBytes,
      tooBig: `the page is larger than the ${Math.round(maxBytes / 1024 / 1024)}MB preview limit`,
    });
    const html = buf.toString('utf-8');
    return { html, finalUrl: current };
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener?.('abort', onOuterAbort);
  }
}

// Prepare fetched HTML for extraction and overlay: harvest the React
// streaming swap operations while the inline scripts still exist, drop
// active content, statically resolve the stream so Suspense content is
// visible without JS, then inline srcdoc iframes so their content becomes
// first-class DOM (prose extraction + OCR + the overlay all reach it).
export function prepareSnapshotHtml(html) {
  const raw = String(html ?? '');
  const ops = harvestStreamOps(raw);
  return inlineSrcdocIframes(resolveStreamedHtml(stripActiveContent(raw), ops));
}

// Sites embed long detail pages (the scrollable below-the-fold content) in
// <iframe srcdoc="...">. The detail HTML lives escaped inside an attribute,
// so prose extraction never sees it. Decode each srcdoc, strip its active
// content, and inline it as a <div> so the detail copy and images are
// rewritten and annotated like the rest of the page.
//
// Inlining (rather than keeping the iframe and rewriting its srcdoc) is a
// deliberate choice: an iframe is a separate document, so the scriptless
// radio-hack toggle and the #ptna-N jump anchors could never reach content
// kept inside one (issue #427 discussion).
export function inlineSrcdocIframes(html) {
  // A double-quoted srcdoc holds its internal quotes entity-escaped, so
  // [^"]* is a safe capture; a single-quoted srcdoc may carry raw markup but
  // never a raw single quote.
  const iframeRe = /<iframe\b[^>]*\bsrcdoc=(?:"([^"]*)"|'([^']*)')[^>]*>(?:[\s\S]*?<\/iframe\s*>)?/gi;
  const out = String(html ?? '').replace(iframeRe, (_, dq, sq) => {
    const decoded = adaptSrcdocViewportCss(stripActiveContent(decodeHtmlEntities(dq ?? sq ?? '')));
    return `<div class="ptna-srcdoc">${decoded}</div>`;
  });
  return unclipSrcdocWrappers(out);
}

// Inside the original iframe, vw and width-based @media resolve against the
// IFRAME box; after inlining they resolve against the top window, inflating
// every viewport-relative size and flipping the narrow-viewport breakpoints
// the live page actually renders with (#430). The .ptna-srcdoc wrapper is a
// size container (container-type:inline-size in PREVIEW_CSS) whose width
// equals the old iframe's, so rewriting the srcdoc's CSS to container units
// reproduces the iframe-viewport semantics exactly. Only CSS contexts are
// touched — <style> blocks and style="" attributes — never text content or
// base64 data-URI payloads, which can contain "vw" by coincidence. vh stays:
// the live site resizes the iframe via JS, so it has no faithful static
// reference either way.
function adaptSrcdocViewportCss(srcdocHtml) {
  const transform = (css) => css
    .replace(/(\d*\.?\d+)vw\b/g, '$1cqw')
    .replace(/@media\s*\(\s*((?:min|max)-width\s*:[^)]+)\)\s*\{/gi, '@container ($1){');
  return String(srcdocHtml)
    .replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style\s*>)/gi, (_, open, css, close) => `${open}${transform(css)}${close}`)
    .replace(/(\bstyle\s*=\s*)("([^"]*)"|'([^']*)')/gi, (_full, prefix, _quoted, dq, sq) => {
      const value = dq ?? sq ?? '';
      const quote = dq !== undefined ? '"' : "'";
      return `${prefix}${quote}${transform(value)}${quote}`;
    });
}

// Hosts size the original iframe with fixed-height overflow-hidden wrappers
// (the live site resizes the iframe via JS, which the snapshot strips). The
// inlined document is much taller than that box, so without this the whole
// detail clips to the wrapper height (#427). Walk up the wrappers whose open
// tag sits directly against the inlined div and neutralize their inline
// height/overflow declarations. Class-based sizing can't be fixed from here;
// the common Next.js pattern uses inline styles.
const MAX_UNCLIP_DEPTH = 2;

function unclipSrcdocWrappers(html) {
  const source = String(html);
  const edits = [];
  const seenEdits = new Set();
  let cursor = 0;
  for (;;) {
    const at = source.indexOf('<div class="ptna-srcdoc">', cursor);
    if (at === -1) break;

    let boundary = at;
    for (let depth = 0; depth < MAX_UNCLIP_DEPTH; depth++) {
      const wrapper = findAdjacentClippingWrapper(source, boundary);
      if (!wrapper) break;
      const key = `${wrapper.styleStart}:${wrapper.styleEnd}`;
      if (!seenEdits.has(key)) {
        seenEdits.add(key);
        edits.push({ start: wrapper.styleStart, end: wrapper.styleEnd, value: unclippedStyle(wrapper.style) });
      }
      boundary = wrapper.tagStart;
    }
    cursor = at + '<div class="ptna-srcdoc">'.length;
  }

  if (edits.length === 0) return source;
  let out = '';
  let last = 0;
  for (const edit of edits.sort((a, b) => a.start - b.start)) {
    out += source.slice(last, edit.start) + edit.value;
    last = edit.end;
  }
  return out + source.slice(last);
}

function findAdjacentClippingWrapper(source, boundary) {
  let tagEnd = boundary;
  while (tagEnd > 0 && /\s/.test(source[tagEnd - 1])) tagEnd--;
  if (source[tagEnd - 1] !== '>') return null;

  const tagStart = source.lastIndexOf('<', tagEnd - 1);
  if (tagStart === -1) return null;
  const tag = source.slice(tagStart, tagEnd);
  if (!/^<(?:div|section|article)\b/i.test(tag)) return null;

  const style = readStyleAttribute(tag);
  if (!style) return null;
  if (!/overflow(?:-y)?\s*:\s*hidden/i.test(style.value) || !/(?:max-)?height\s*:/i.test(style.value)) return null;

  return {
    tagStart,
    style: style.value,
    styleStart: tagStart + style.valueStart,
    styleEnd: tagStart + style.valueEnd,
  };
}

function readStyleAttribute(tag) {
  const attrRe = /\bstyle\s*=\s*("([^"]*)"|'([^']*)')/gi;
  let match;
  while ((match = attrRe.exec(tag)) !== null) {
    const value = match[2] ?? match[3] ?? '';
    const quoteOffset = match[0].indexOf(match[1]);
    return {
      value,
      valueStart: match.index + quoteOffset + 1,
      valueEnd: match.index + quoteOffset + 1 + value.length,
    };
  }
  return null;
}

function unclippedStyle(style) {
  return style
    .split(';')
    .filter((decl) => !/^\s*(?:overflow(?:-y)?|height|max-height)\s*:/i.test(decl))
    .join(';');
}

// Snapshot asset freezing (#428). Sites increasingly refuse cross-site
// subresource loads via Fetch Metadata (Vercel returns 404 to any request
// carrying Sec-Fetch-Site: cross-site) — and a saved snapshot opened from
// file:// or a patina --serve origin is ALWAYS cross-site to the host page.
// The <base href> strategy then silently loses every same-origin stylesheet
// and web font, so the page renders unstyled / in fallback fonts. patina's
// own fetch sends no fetch metadata and is not blocked, so at snapshot time:
//
//   1. same-origin <link rel="stylesheet"> targets are downloaded and inlined
//      as <style> blocks, with relative url() references absolutized against
//      the STYLESHEET's URL (they would otherwise re-resolve against the
//      page-level <base href> and break);
//   2. same-origin font files referenced by the inlined CSS are embedded as
//      data: URIs (the preview CSP already allows font-src data:).
//
// Cross-origin sheets (e.g. font CDNs) are built for cross-site loading and
// keep their <link>. Every fetch is SSRF-guarded (the URLs come from page
// content) and capped; any failure keeps the original markup.
const MAX_FROZEN_SHEETS = 8;
const MAX_SHEET_BYTES = 1.5 * 1024 * 1024;
const MAX_FONT_BYTES = 3 * 1024 * 1024; // Korean variable fonts run ~2MB
const FREEZE_TOTAL_BUDGET = 12 * 1024 * 1024;
const FONT_MIME_BY_EXT = { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf' };

export async function freezeSnapshotAssets(html, { baseUrl, signal, logger, fetchImpl = fetch, lookupImpl } = {}) {
  let origin;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return html;
  }
  if (!/^https?:$/.test(new URL(baseUrl).protocol)) return html;

  const source = String(html ?? '');
  const linkRe = /<link\b[^>]*>/gi;
  const sheets = [];
  let match;
  while ((match = linkRe.exec(source)) !== null && sheets.length < MAX_FROZEN_SHEETS) {
    const tag = match[0];
    if (!/\brel\s*=\s*["']?stylesheet["']?/i.test(tag)) continue;
    const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(tag);
    if (!href) continue;
    let resolved;
    try {
      resolved = new URL(decodeHtmlEntities(href[1] ?? href[2] ?? href[3]), baseUrl);
    } catch {
      continue;
    }
    if (resolved.origin !== origin) continue;
    sheets.push({ tag, url: resolved.href });
  }
  if (sheets.length === 0) return html;

  let spent = 0;
  let out = source;
  const fontCache = new Map();
  let sheetCount = 0;
  let fontCount = 0;

  for (const sheet of sheets) {
    if (signal?.aborted) break;
    try {
      if (!(await isSubresourceFetchAllowed(sheet.url, { baseUrl, lookupImpl }))) {
        throw new Error('private/internal address blocked');
      }
      if (spent >= FREEZE_TOTAL_BUDGET) throw new Error('freeze budget reached');
      const bytes = await fetchCappedBytes(fetchImpl, sheet.url, {
        signal,
        maxBytes: MAX_SHEET_BYTES,
        fetchTimeoutMs: 20000,
        tooBig: 'stylesheet too large',
        guardHop: (next) => isSubresourceFetchAllowed(next, { baseUrl, lookupImpl }),
      });
      spent += bytes.length;
      let css = bytes.toString('utf8');
      // A stylesheet that could close our <style> block must stay external —
      // the page-level sanitizer and CSP still apply either way.
      if (/<\/style/i.test(css)) throw new Error('stylesheet contains </style>');
      css = absolutizeCssUrls(css, sheet.url);
      const embedded = await embedFontsAsDataUris(css, {
        sheetUrl: sheet.url,
        origin,
        baseUrl,
        signal,
        fetchImpl,
        lookupImpl,
        fontCache,
        budget: () => FREEZE_TOTAL_BUDGET - spent,
        onSpend: (n) => { spent += n; },
      });
      css = embedded.css;
      fontCount += embedded.fontCount;
      // Function replacement: page-controlled css must not have its `$&`/$`/$'
      // sequences interpreted as replacement patterns (#447).
      out = out.replace(sheet.tag, () => `<style data-ptna-frozen="${htmlEscape(sheet.url)}">${css}</style>`);
      sheetCount += 1;
    } catch (err) {
      if (signal?.aborted) break;
      logger?.warn?.('preview.freeze_skip', {
        message: `[patina] Could not inline stylesheet ${sheet.url}: ${err?.message || 'fetch failed'}`,
      });
    }
  }
  if (sheetCount > 0) {
    logger?.info?.('preview.freeze', {
      message: `[patina] Snapshot assets frozen: ${sheetCount} stylesheet(s), ${fontCount} font(s) inlined.`,
    });
  }
  return out;
}

const CSS_URL_RE = /\burl\(\s*(?:"([^"]+)"|'([^']+)'|([^)"'\s]+))\s*\)/gi;

// Rewrite every relative url() in a fetched stylesheet to an absolute URL
// resolved against the stylesheet's own location. Without this, inlining
// moves the CSS into the page document and ../-style references re-resolve
// against the page <base href> into garbage paths.
function absolutizeCssUrls(css, sheetUrl) {
  return css.replace(CSS_URL_RE, (full, dq, sq, bare) => {
    const raw = (dq ?? sq ?? bare ?? '').trim();
    if (!raw || raw.startsWith('data:') || raw.startsWith('#') || /^[a-z-]+\(/i.test(raw)) return full;
    try {
      return `url(${new URL(raw, sheetUrl).href})`;
    } catch {
      return full;
    }
  });
}

async function embedFontsAsDataUris(css, { origin, baseUrl, signal, fetchImpl, lookupImpl, fontCache, budget, onSpend }) {
  const refs = [];
  let m;
  CSS_URL_RE.lastIndex = 0;
  while ((m = CSS_URL_RE.exec(css)) !== null) {
    const raw = (m[1] ?? m[2] ?? m[3] ?? '').trim();
    const ext = /\.(woff2?|ttf|otf)(?:[?#]|$)/i.exec(raw)?.[1]?.toLowerCase();
    if (!ext) continue;
    try {
      const url = new URL(raw);
      if (url.origin !== origin) continue;
      refs.push({ raw, url: url.href, ext });
    } catch {
      continue;
    }
  }

  let fontCount = 0;
  for (const ref of refs) {
    if (signal?.aborted) break;
    if (!fontCache.has(ref.url)) {
      try {
        if (budget() <= 0) throw new Error('freeze budget reached');
        if (!(await isSubresourceFetchAllowed(ref.url, { baseUrl, lookupImpl }))) {
          throw new Error('private/internal address blocked');
        }
        const bytes = await fetchCappedBytes(fetchImpl, ref.url, {
          signal,
          maxBytes: Math.min(MAX_FONT_BYTES, budget()),
          fetchTimeoutMs: 20000,
          tooBig: 'font too large',
          guardHop: (next) => isSubresourceFetchAllowed(next, { baseUrl, lookupImpl }),
        });
        onSpend(bytes.length);
        const mime = FONT_MIME_BY_EXT[ref.ext] || 'font/woff2';
        fontCache.set(ref.url, `data:${mime};base64,${bytes.toString('base64')}`);
      } catch {
        fontCache.set(ref.url, null); // failed: keep the absolute URL
      }
    }
    const dataUri = fontCache.get(ref.url);
    if (dataUri && css.includes(`url(${ref.raw})`)) {
      css = css.split(`url(${ref.raw})`).join(`url(${dataUri})`);
      fontCount += 1;
    }
  }
  return { css, fontCount };
}

function decodeHtmlEntities(value) {
  return String(value)
    // Numeric character references (&#60; / &#x3c;) — browsers decode all of
    // these in attribute values, so srcdoc inlining must too or numeric-entity
    // markup renders as inert escaped text and its prose never reaches the
    // extractor (#447).
    .replace(/&#x([0-9a-f]+);/gi, (m, hex) => fromCodePointSafe(parseInt(hex, 16), m))
    .replace(/&#(\d+);/g, (m, dec) => fromCodePointSafe(Number(dec), m))
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&amp;/gi, '&');
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

