import { htmlEscape, diffBlockPairs } from './browser-diff.js';
import { describeImage } from './ocr.js';

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_FETCH_TIMEOUT_MS = 30000;
const DEFAULT_MIN_BLOCK_LENGTH = 20;
const DEFAULT_MAX_BLOCKS = 200;
const MAX_JUMP_CHIPS = 12;

// Block-level tags whose plain-text content patina may rewrite. div/section/
// article are scanned leaf-first: a container with nested block markup is
// rejected and the scan descends into it, so only containers that directly
// hold copy become blocks. Tables stay out (data cells must not be
// rewritten); the walker only touches blocks it can swap back losslessly.
const PROSE_TAGS = 'p|h1|h2|h3|h4|h5|h6|li|blockquote|figcaption|dt|dd|summary|div|section|article';

// Containers whose content must never be treated as prose, even when it
// happens to contain things that look like prose tags (e.g. serialized HTML
// inside a Next.js data script). nav and button hold navigation chrome and
// control labels — never body copy.
const EXCLUDED_CONTAINERS = 'head|script|style|noscript|template|textarea|svg|iframe|select|option|code|pre|nav|button';

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
export function inlineSrcdocIframes(html) {
  // A double-quoted srcdoc holds its internal quotes entity-escaped, so
  // [^"]* is a safe capture; a single-quoted srcdoc may carry raw markup but
  // never a raw single quote.
  const iframeRe = /<iframe\b[^>]*\bsrcdoc=(?:"([^"]*)"|'([^']*)')[^>]*>(?:[\s\S]*?<\/iframe\s*>)?/gi;
  return String(html ?? '').replace(iframeRe, (_, dq, sq) => {
    const decoded = stripActiveContent(decodeHtmlEntities(dq ?? sq ?? ''));
    return `<div class="ptna-srcdoc">${decoded}</div>`;
  });
}

function decodeHtmlEntities(value) {
  return String(value)
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

// Formatting-only tags whose presence inside a prose block is acceptable:
// the block is extracted with its text flattened. The rewritten view loses
// the inline formatting; the original view (toggle) keeps it. Anything not
// in this set (nested lists, divs, images, buttons…) keeps the block out.
const INLINE_TAGS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'code', 'del', 'em', 'i',
  'ins', 'kbd', 'mark', 'q', 'ruby', 'rt', 'rp', 's', 'small', 'span',
  'strong', 'sub', 'sup', 'time', 'u', 'var', 'wbr',
]);

// Whole-card anchors (an entire teaser wrapped in one link) are real prose;
// shorter single-link blocks are navigation/CTA chrome.
const SINGLE_ANCHOR_MIN_LENGTH = 80;

// A '<' or '>' is legal inside a quoted HTML attribute value (data-* JSON,
// serialized template markup, aria-label="Next >"…). A naive regex that
// matches tag boundaries by `<`/`>` therefore computes the wrong element
// boundaries on real-world markup. scanTagAt walks from a '<' through the
// tag's attributes — skipping quoted spans — to the '>' that actually closes
// the tag, returning the tag name, whether it is an end tag, and the offset
// just past '>'. Everything downstream sees only real tag tokens, so a swap
// position can never land inside an attribute value.
function scanTagAt(source, ltIndex) {
  const after = source[ltIndex + 1];
  if (after === undefined) return null;
  const isClose = after === '/';
  let i = ltIndex + (isClose ? 2 : 1);
  // A real tag name starts with an ASCII letter (the HTML tokenizer rule), so
  // text like "<3" or "a < b" is never mistaken for a tag.
  if (!/[a-zA-Z]/.test(source[i] || '')) return null;
  const nameStart = i;
  while (i < source.length && /[a-zA-Z0-9-]/.test(source[i])) i++;
  if (i === nameStart) return null;
  const name = source.slice(nameStart, i).toLowerCase();
  let quote = null;
  while (i < source.length) {
    const ch = source[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      const selfClose = source[i - 1] === '/';
      return { name, isClose, selfClose, end: i + 1 };
    }
    i++;
  }
  return null;
}

// Where a block's content ends. For tags with no implicit close (headings,
// blockquote, div, section, article, figcaption, summary) it is the matching
// end tag. For HTML5 optional-end-tag elements (li, dt, dd, p) the browser
// also closes them on certain sibling start/close tags, so the end is the
// FIRST such tag at the same level. The set mirrors the parser's
// implied-close rules, so the computed end matches the rendered DOM and the
// in-place swap stays lossless. Matching runs over real tag tokens only
// (scanTagAt), never over attribute text.
const P_CLOSERS = new Set(['address', 'article', 'aside', 'blockquote', 'details', 'div', 'dl', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul', 'li', 'dt', 'dd', 'dialog']);
const IMPLICIT_TERMINATORS = {
  li: (t) => (t.isClose && ['li', 'ul', 'ol', 'menu'].includes(t.name)) || (!t.isClose && t.name === 'li'),
  dt: (t) => (t.isClose && ['dt', 'dd', 'dl'].includes(t.name)) || (!t.isClose && (t.name === 'dt' || t.name === 'dd')),
  dd: (t) => (t.isClose && ['dt', 'dd', 'dl'].includes(t.name)) || (!t.isClose && (t.name === 'dt' || t.name === 'dd')),
  p: (t) => (t.isClose && (P_CLOSERS.has(t.name) || ['td', 'th', 'body', 'html'].includes(t.name))) || (!t.isClose && P_CLOSERS.has(t.name)),
};

// A prose block spanning more tag tokens than this is never real prose; the
// cap bounds findBlockEnd's forward scan so a page full of unclosed openers
// stays linear instead of O(n^2).
const FORWARD_SCAN_CAP = 4096;

// Walk forward through the pre-tokenized tag stream from the opener at
// `startIdx` and return the source offset where the block closes: the
// explicit end tag, or (for optional-end-tag elements) the first implicit
// terminator. Comments and inert-container content are already absent from
// the token stream, so a terminator-looking name inside a comment or script
// can never truncate a block. Returns -1 if no close is found within the cap.
function findBlockEndToken(tokens, startIdx, tag) {
  const isTerminator = IMPLICIT_TERMINATORS[tag];
  const limit = Math.min(tokens.length, startIdx + 1 + FORWARD_SCAN_CAP);
  for (let j = startIdx + 1; j < limit; j++) {
    const token = tokens[j];
    if (isTerminator ? isTerminator(token) : (token.isClose && token.name === tag)) {
      return token.start;
    }
  }
  return -1;
}

// Tokenize the document into structural tag tokens in ONE pass, skipping
// comment spans and the content of inert/never-prose containers (script,
// style, noscript, svg, …). Doing this once — instead of re-scanning the raw
// string per opener — keeps extraction linear, and dropping comment/inert
// content means their tag-like text can neither become a false candidate nor
// truncate a real block.
function tokenizeTags(source, excluded) {
  const ranges = [...excluded].sort((a, b) => a[0] - b[0]);
  const tokens = [];
  let i = 0;
  let ri = 0;
  while (i < source.length) {
    const lt = source.indexOf('<', i);
    if (lt === -1) break;
    while (ri < ranges.length && ranges[ri][1] <= lt) ri++;
    if (ri < ranges.length && lt >= ranges[ri][0] && lt < ranges[ri][1]) {
      i = ranges[ri][1];
      continue;
    }
    const token = scanTagAt(source, lt);
    if (!token) { i = lt + 1; continue; }
    tokens.push({ name: token.name, isClose: token.isClose, start: lt, contentStart: token.end });
    i = token.end;
  }
  return tokens;
}

// Tag-priority for the truncation budget: genuine prose tags outrank
// container divs so a card grid of leaf divs cannot crowd real article
// paragraphs out of the cap.
const TAG_PRIORITY = { p: 3, h1: 3, h2: 3, h3: 3, h4: 3, h5: 3, h6: 3, blockquote: 3, li: 2, dt: 2, dd: 2, figcaption: 2, summary: 2, div: 1, section: 1, article: 1 };
const PROSE_TAG_SET = new Set(PROSE_TAGS.split('|'));

export function extractProseBlocks(html, options = {}) {
  const minLength = options.minLength ?? DEFAULT_MIN_BLOCK_LENGTH;
  const maxBlocks = options.maxBlocks ?? DEFAULT_MAX_BLOCKS;
  const source = String(html ?? '');
  const excluded = collectExcludedRanges(source);
  const tokens = tokenizeTags(source, excluded);

  const candidates = [];
  // Process open tags, not whole elements: when a candidate is rejected for
  // nested block markup, processing continues at the next opener INSIDE it, so
  // prose nested in rejected containers (li > p, blockquote > p, wrapper
  // divs) is still found. An accepted block is inline-only, so it can never
  // contain another candidate — accepted blocks cannot overlap.
  for (let idx = 0; idx < tokens.length; idx++) {
    const token = tokens[idx];
    if (token.isClose || !PROSE_TAG_SET.has(token.name)) continue;
    const tag = token.name;
    const openEnd = token.contentStart;
    const end = findBlockEndToken(tokens, idx, tag);
    if (end === -1) continue;
    const raw = source.slice(openEnd, end);
    // Comments are invisible: remove them (no space — a comment between two
    // text nodes does not render as a word break) before judging
    // inline-only-ness and deriving text, so a comment that carries tag-like
    // text (`<!-- </p> -->`) neither disqualifies the block nor leaks into its
    // copy. block.raw keeps the exact source slice so the swap stays lossless.
    const inner = raw.replace(/<!--[\s\S]*?-->/g, '');
    if (inner.includes('<') && !hasOnlyInlineMarkup(inner)) continue;
    const text = decodeEntities(inner.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    // A short block that is just one link is navigation/CTA chrome, not prose.
    if (text.length < SINGLE_ANCHOR_MIN_LENGTH
      && /^\s*<a\b[^>]*>[\s\S]*<\/a\s*>\s*$/i.test(inner)
      && (inner.match(/<a\b/gi) || []).length === 1) continue;
    if (text.length < minLength) continue;
    if (!/[A-Za-z가-힣぀-ヿ㐀-鿿]/.test(text)) continue;
    candidates.push({ tag, start: openEnd, end, raw, text });
  }

  // Over budget: keep the highest-priority blocks (prose tags before container
  // divs), then restore document order so alignment and the reverse-order swap
  // stay correct.
  let truncated = false;
  let blocks = candidates;
  if (candidates.length > maxBlocks) {
    truncated = true;
    blocks = candidates
      .map((block, index) => ({ block, index }))
      .sort((a, b) => (TAG_PRIORITY[b.block.tag] - TAG_PRIORITY[a.block.tag]) || (a.index - b.index))
      .slice(0, maxBlocks)
      .sort((a, b) => a.index - b.index)
      .map((entry) => entry.block);
  }
  return { blocks, truncated };
}

// Receives comment-free input (the caller strips comments first), so a block
// qualifies only when every remaining tag is inline formatting.
function hasOnlyInlineMarkup(raw) {
  const tagRe = /<\/?([a-z][a-z0-9-]*)/gi;
  let match;
  while ((match = tagRe.exec(raw)) !== null) {
    if (!INLINE_TAGS.has(match[1].toLowerCase())) return false;
  }
  return true;
}

export function alignRewrites(blocks, rewrittenBody) {
  const paragraphs = String(rewrittenBody ?? '')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (paragraphs.length === blocks.length) {
    return { rewrites: paragraphs, unalignedCount: 0 };
  }

  // The model merged or split paragraphs. Fall back to LCS hunk pairing:
  // unchanged blocks keep their slot, equal-sized changed hunks pair 1:1,
  // and anything else keeps the original text instead of failing the run.
  const pairs = diffBlockPairs(
    blocks.map((block) => block.text).join('\n\n'),
    paragraphs.join('\n\n'),
  );
  const rewrites = [];
  let unalignedCount = 0;
  for (const pair of pairs) {
    if (pair.type === 'same') {
      rewrites.push(pair.text);
      continue;
    }
    const before = pair.before ? pair.before.split('\n\n') : [];
    const after = pair.after ? pair.after.split('\n\n') : [];
    if (before.length === after.length) {
      rewrites.push(...after);
      continue;
    }
    // Counts differ inside the hunk (the model merged or split): pair by
    // order-monotonic character-bigram similarity; blocks with no confident
    // partner keep their original text, surplus model paragraphs are dropped.
    const mapping = pairHunkBySimilarity(before, after);
    before.forEach((text, index) => {
      if (mapping[index] !== null) {
        rewrites.push(mapping[index]);
      } else {
        rewrites.push(text);
        unalignedCount += 1;
      }
    });
  }
  if (rewrites.length !== blocks.length) {
    throw new Error(`the rewrite returned ${paragraphs.length} paragraphs for ${blocks.length} prose blocks`);
  }
  return { rewrites, unalignedCount };
}

const MIN_PAIR_SIMILARITY = 0.25;

// Monotonic alignment maximizing total bigram similarity (tiny
// Needleman-Wunsch); pairs below the similarity floor are not made at all.
function pairHunkBySimilarity(before, after) {
  const k = before.length;
  const m = after.length;
  const sim = before.map((b) => after.map((a) => diceSimilarity(b, a)));
  const best = Array.from({ length: k + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= k; i++) {
    for (let j = 1; j <= m; j++) {
      const pairScore = sim[i - 1][j - 1] >= MIN_PAIR_SIMILARITY
        ? best[i - 1][j - 1] + sim[i - 1][j - 1]
        : -Infinity;
      best[i][j] = Math.max(best[i - 1][j], best[i][j - 1], pairScore);
    }
  }
  const mapping = new Array(k).fill(null);
  let i = k;
  let j = m;
  while (i > 0 && j > 0) {
    if (sim[i - 1][j - 1] >= MIN_PAIR_SIMILARITY
      && best[i][j] === best[i - 1][j - 1] + sim[i - 1][j - 1]) {
      mapping[i - 1] = after[j - 1];
      i -= 1;
      j -= 1;
    } else if (best[i][j] === best[i - 1][j]) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  return mapping;
}

function diceSimilarity(a, b) {
  const left = bigramCounts(a);
  const right = bigramCounts(b);
  let leftTotal = 0;
  let rightTotal = 0;
  let overlap = 0;
  for (const count of left.values()) leftTotal += count;
  for (const count of right.values()) rightTotal += count;
  if (leftTotal === 0 || rightTotal === 0) return 0;
  for (const [gram, count] of left) {
    const other = right.get(gram);
    if (other) overlap += Math.min(count, other);
  }
  return (2 * overlap) / (leftTotal + rightTotal);
}

function bigramCounts(text) {
  const compact = String(text).replace(/\s+/g, '');
  const counts = new Map();
  for (let i = 0; i < compact.length - 1; i++) {
    const gram = compact.slice(i, i + 2);
    counts.set(gram, (counts.get(gram) || 0) + 1);
  }
  return counts;
}

export function buildPreviewHtml({ html, blocks, rewrites, sourceUrl, explanationHtml = '', scoreChip = null, imageFindings = [] }) {
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

  const image = annotateImageFindings(out, imageFindings);
  out = image.html;

  out = stripActiveContent(out);
  out = injectHead(out, sourceUrl);
  out = injectChrome(out, {
    changedCount,
    totalCount: blocks.length,
    explanationHtml,
    scoreChip,
    imageCardsHtml: image.cardsHtml,
    imageChangedCount: image.changedCount,
  });
  return { html: out, changedCount, totalCount: blocks.length, imageChangedCount: image.changedCount };
}

// OCR findings cannot be swapped into pixels and the host image is often a
// CSS background, a carousel slide, or lazy-loaded — none reliably visible on
// the frozen snapshot. So each finding's card embeds the exact image patina
// OCR'd (capped thumbnail) alongside the extracted text and suggested rewrite;
// the card itself is the jump target, so a finding is always reachable. When
// the image IS a plain <img> in the DOM it also gets an on-page badge.
function annotateImageFindings(html, imageFindings) {
  let out = html;
  let changedCount = 0;
  const cards = [];
  for (const finding of imageFindings) {
    if (!finding.changed) continue;
    changedCount += 1;
    const n = changedCount;
    if (finding.anchor) {
      const esc = escapeRegExp(finding.anchor);
      const tagRe = new RegExp(`<img\\b[^>]*\\bsrc\\s*=\\s*(?:"${esc}"|'${esc}'|${esc}(?=[\\s>]))[^>]*>`, 'i');
      out = out.replace(tagRe, (tag) => `<span class="ptna-img" data-n="I${n}">${tag}</span>`);
    }
    const thumb = finding.previewDataUri
      ? `<img class="ptna-img-thumb" alt="" src="${htmlEscape(finding.previewDataUri)}">`
      : '';
    cards.push(
      `<article class="explain-card ptna-img-card" id="ptna-img-${n}">`
      + `<div class="ptna-img-head"><strong>I${n}</strong> · ${htmlEscape(describeImage(finding))}</div>`
      + thumb
      + `<div class="ptna-img-text"><span class="ptna-img-label">image text</span>${htmlEscape(finding.text)}</div>`
      + `<div class="ptna-img-text"><span class="ptna-img-label">suggested</span><span class="ptna-img-suggest">${htmlEscape(finding.rewritten)}</span></div>`
      + '</article>',
    );
  }
  return { html: out, cardsHtml: cards.join(''), changedCount };
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
//
// This is a tag-aware walk, not a set of independent regexes, because the
// snapshot now carries attacker-controlled markup from inlined frames and
// srcdoc. Walking real tag tokens (scanTagAt skips quoted attribute values)
// means: a '>' inside a quoted attribute can no longer hide a later on*
// handler from the stripper, an unclosed <script> is neutralized instead of
// surviving, and a literal "<script>" inside another tag's attribute value is
// not mistaken for a real script element.
function stripActiveContent(html) {
  const s = String(html ?? '');
  let out = '';
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt === -1) { out += s.slice(i); break; }
    out += s.slice(i, lt);
    if (s.startsWith('<!--', lt)) {
      const close = s.indexOf('-->', lt + 4);
      const end = close === -1 ? s.length : close + 3;
      out += s.slice(lt, end);
      i = end;
      continue;
    }
    const token = scanTagAt(s, lt);
    if (!token) { out += '<'; i = lt + 1; continue; }
    if (token.name === 'script' && !token.isClose) {
      // Drop the whole element when it has a close tag; for an unclosed
      // <script> drop only the open tag, leaving its trailing source as inert
      // text rather than executable script (and without nuking the rest of
      // the document).
      const closeRe = /<\/script\s*>/gi;
      closeRe.lastIndex = token.end;
      const m = closeRe.exec(s);
      i = m ? m.index + m[0].length : token.end;
      continue;
    }
    if (token.name === 'meta') {
      const tag = s.slice(lt, token.end);
      if (/http-equiv\s*=\s*["']?\s*(?:content-security-policy|refresh)/i.test(tag)) {
        i = token.end;
        continue;
      }
    }
    let tag = s.slice(lt, token.end);
    // The regexes run on a SINGLE complete tag (quoted spans included), so the
    // first-'>' truncation problem cannot occur. The separator before an on*
    // handler may be whitespace, '/' (HTML allows <a/onclick=…>), or the
    // closing quote of the previous attribute value (<a href="x"onclick=…>);
    // the captured separator is preserved so neighbouring attributes survive.
    // Run to a fixed point: when two handlers are adjacent the first match
    // consumes the quote that would separate the second, so a single pass
    // leaves the second behind — keep stripping until nothing changes.
    const handlerRe = /(^|[\s/"'])on[a-zA-Z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi;
    let prevTag;
    do {
      prevTag = tag;
      tag = tag.replace(handlerRe, '$1');
    } while (tag !== prevTag);
    tag = neutralizeJavascriptUrls(tag);
    out += tag;
    i = token.end;
  }
  return out;
}

// Neutralize javascript: in href/src/action/formaction, including
// entity-encoded forms (&#106;avascript:, &#x6a;…) that decode to
// "javascript:" only in the browser. The value is entity-decoded for the
// scheme test; if it resolves to a javascript: URL the literal value is
// blanked.
function neutralizeJavascriptUrls(tag) {
  return tag.replace(
    /(\b(?:href|src|action|formaction)\s*=\s*)("([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (full, prefix, _quoted, dq, sq, uq) => {
      const value = dq ?? sq ?? uq ?? '';
      // Browsers strip ASCII whitespace AND C0 control characters from a URL
      // before matching its scheme, so `java\tscript:`, `\x01javascript:`, and
      // entity-encoded forms all resolve to javascript:. Negating the
      // printable range \x21–￿ removes everything <= 0x20 without putting
      // a control-character literal in the pattern (which the linter forbids).
      const decoded = decodeEntities(value).replace(/[^\x21-\uffff]/g, '');
      if (/^javascript:/i.test(decoded)) return `${prefix}"blocked:"`;
      return full;
    },
  );
}

// Active content the snapshot strips can still re-enter through markup the
// sanitizer cannot make safe — a data:/javascript: <iframe> renders its own
// document, an <object>/<embed> loads a plugin. Rather than rely on the
// stripper alone, the page-preview document also carries a CSP that forbids
// all script execution and sub-frames while leaving passive resources (the
// page's own images, CSS, fonts) loading for fidelity.
// No base-uri directive: the preview is served from a file:// temp path or
// localhost, so the page's own relative URLs (images, CSS, links) resolve
// only through the injected <base href>. base-uri 'none' would nullify that
// <base> and break every relative resource — and inertness comes from the
// 'none' source directives + stripActiveContent, not from base-uri.
const PREVIEW_CSP = [
  "default-src 'none'",
  'img-src * data: blob:',
  "style-src * 'unsafe-inline'",
  'font-src * data:',
  'media-src * data: blob:',
  "frame-src 'none'",
  "child-src 'none'",
  "object-src 'none'",
  "form-action 'none'",
].join('; ');

function injectHead(html, sourceUrl) {
  const baseTag = /<base\b/i.test(html) ? '' : `<base href="${htmlEscape(sourceUrl)}">`;
  // CSP first so it governs everything that follows (and the page's own,
  // permissive CSP was already stripped by stripActiveContent).
  const csp = `<meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}">`;
  const injection = `${csp}${baseTag}<style id="ptna-style">${PREVIEW_CSS}</style>`;
  if (/<head\b[^>]*>/i.test(html)) return html.replace(/<head\b[^>]*>/i, `$&${injection}`);
  if (/<html\b[^>]*>/i.test(html)) return html.replace(/<html\b[^>]*>/i, `$&<head>${injection}</head>`);
  return `<head>${injection}</head>${html}`;
}

function injectChrome(html, { changedCount, totalCount, explanationHtml = '', scoreChip = null, imageCardsHtml = '', imageChangedCount = 0 }) {
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
  const imageChips = Array.from({ length: Math.min(imageChangedCount, MAX_JUMP_CHIPS) }, (_, i) =>
    `<a class="ptna-chip ptna-chip-img" href="#ptna-img-${i + 1}">I${i + 1}</a>`).join('');
  const views = changedCount > 0
    ? '<div class="ptna-views">'
      + '<label class="ptna-view" for="ptna-v-rew">rewritten</label>'
      + '<label class="ptna-view" for="ptna-v-orig">original</label>'
      + '<label class="ptna-view" for="ptna-v-both">both</label>'
      + '</div>'
    : '';
  const notesBody = `${explanationHtml}${imageCardsHtml}`;
  // Auto-open when there are image findings — they have no in-page diff, so a
  // collapsed panel would hide the only place they appear.
  const open = imageChangedCount > 0 ? ' open' : '';
  const summaryLabel = imageChangedCount > 0 ? `patina notes · ${imageChangedCount} image text` : 'patina notes';
  const notes = notesBody
    ? `<details class="ptna-notes"${open}><summary>${summaryLabel}</summary><div class="ptna-notes-body">${notesBody}</div></details>`
    : '';
  const bar = `<div class="ptna-bar"><span class="ptna-brand">patina</span>`
    + `<span class="ptna-count">${changedCount} of ${totalCount} blocks rewritten</span>`
    + (imageChangedCount > 0 ? `<span class="ptna-count ptna-count-img">${imageChangedCount} image(s)</span>` : '')
    + (scoreChip ? `<span class="ptna-score">${htmlEscape(scoreChip)}</span>` : '')
    + (chips || imageChips ? `<nav class="ptna-jump" aria-label="Jump to rewrite">${chips}${overflow}${imageChips}</nav>` : '')
    + views
    + '</div>';

  let out = html;
  if (/<body\b[^>]*>/i.test(out)) out = out.replace(/<body\b[^>]*>/i, `$&${inputs}`);
  else out = `${inputs}${out}`;
  if (/<\/body\s*>/i.test(out)) return out.replace(/<\/body\s*>/i, `${notes}${bar}$&`);
  return `${out}${notes}${bar}`;
}

// Find the inert/never-prose regions of the document in a SINGLE linear walk.
// Walking (rather than running a `<tag>…</tag>` regex over the whole string)
// is what makes this correct AND safe: a container open tag that only appears
// inside a comment (`<!-- <nav> -->`) or inside another inert container's text
// (`<script>"<style>"</script>`) is never seen as a real open tag, so it can't
// pair with a later real close tag and swallow the prose between them. It also
// avoids the backtracking a non-greedy regex with a backreference can hit on
// many unclosed containers.
function collectExcludedRanges(html) {
  const containerSet = new Set(EXCLUDED_CONTAINERS.split('|'));
  const ranges = [];
  const source = String(html ?? '');
  let i = 0;
  while (i < source.length) {
    const lt = source.indexOf('<', i);
    if (lt === -1) break;
    if (source.startsWith('<!--', lt)) {
      const close = source.indexOf('-->', lt + 4);
      const end = close === -1 ? source.length : close + 3;
      ranges.push([lt, end]);
      i = end;
      continue;
    }
    const token = scanTagAt(source, lt);
    if (!token) { i = lt + 1; continue; }
    if (!token.isClose && !token.selfClose && containerSet.has(token.name)) {
      const closeRe = new RegExp(`</${token.name}\\s*>`, 'gi');
      closeRe.lastIndex = token.end;
      const closeMatch = closeRe.exec(source);
      // Only a container with its OWN real close tag defines an excluded
      // range. A self-closed (<svg .../>) container is skipped above so it
      // can't borrow a later element's close; an unclosed container finds no
      // close and is left in place. Excluding either to EOF would swallow all
      // following prose (inline self-closed SVG icons are everywhere) — the
      // pre-rewrite regex likewise required a real close tag.
      if (closeMatch) {
        const end = closeMatch.index + closeMatch[0].length;
        ranges.push([lt, end]);
        i = end;
        continue;
      }
    }
    i = token.end;
  }
  return ranges;
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
.ptna-chip-img{color:#c8956c !important;border-color:rgba(200,149,108,0.4);}
.ptna-chip-img:hover{background:rgba(200,149,108,0.15);}
.ptna-count-img{color:#c8956c !important;}
.ptna-img{display:inline-block;position:relative;outline:2px dashed #c8956c !important;outline-offset:3px;border-radius:4px;scroll-margin-top:90px;}
.ptna-img::after{content:attr(data-n);position:absolute;top:6px;left:6px;padding:1px 7px;border-radius:999px;background:#c8956c;color:#20150c;font:700 10.5px/16px ui-monospace,Menlo,Consolas,monospace !important;}
.ptna-img:target{outline-style:solid !important;outline-width:3px !important;}
.ptna-img-card{border-left-color:#c8956c !important;background:rgba(200,149,108,0.05) !important;scroll-margin-top:16px;}
.ptna-img-card:target{outline:2px solid #c8956c !important;outline-offset:2px;}
.ptna-img-head{font-size:11px;color:#8da59a;margin-bottom:7px;}
.ptna-img-head strong{color:#c8956c;}
.ptna-img-thumb{display:block;max-width:100%;max-height:220px;width:auto;border-radius:6px;border:1px solid rgba(132,168,152,0.25);margin:0 0 8px;}
.ptna-img-text{margin:5px 0;line-height:1.6;}
.ptna-img-label{display:inline-block;min-width:62px;font:600 9.5px/1.6 ui-monospace,Menlo,Consolas,monospace !important;text-transform:uppercase;letter-spacing:0.08em;color:#8da59a;vertical-align:top;}
.ptna-img-suggest{color:#5fc4a8;}
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
