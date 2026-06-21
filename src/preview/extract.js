import { diffBlockPairs } from '../browser-diff.js';
import { scanTagAt, decodeEntities } from './dom.js';

const DEFAULT_MIN_BLOCK_LENGTH = 20;
const DEFAULT_MAX_BLOCKS = 200;
// Block-level tags whose plain-text content patina may rewrite. div/section/
// article are scanned leaf-first: a container with nested block markup is
// rejected and the scan descends into it, so only containers that directly
// hold copy become blocks. Tables stay out (data cells must not be
// rewritten); the walker only touches blocks it can swap back losslessly.
const PROSE_TAGS = 'p|h1|h2|h3|h4|h5|h6|li|blockquote|figcaption|dt|dd|summary|div|section|article';

// Containers whose content must never be treated as prose, even when it
// happens to contain things that look like prose tags (e.g. serialized HTML
// inside a Next.js data script). nav/aside and button hold navigation chrome
// and control labels — never body copy.
const EXCLUDED_CONTAINERS = 'head|script|style|noscript|template|textarea|svg|iframe|select|option|code|pre|nav|aside|button';

// Formatting-only tags whose presence inside a prose block is acceptable:
// the block is extracted with its text flattened. The rewritten view loses
// the inline formatting; the original view (toggle) keeps it. Anything not
// in this set (nested lists, divs, images, buttons…) keeps the block out.
// code/kbd/var are deliberately NOT here: their content is a verbatim token
// (package name, command, key cap), not prose — a model rewrite can corrupt
// the token, and the flattened swap would render the markup as literal
// backtick text. Blocks carrying them are left untouched.
const INLINE_TAGS = new Set([
  'a', 'abbr', 'b', 'bdi', 'bdo', 'br', 'cite', 'del', 'em', 'i',
  'ins', 'mark', 'q', 'ruby', 'rt', 'rp', 's', 'small', 'span',
  'strong', 'sub', 'sup', 'time', 'u', 'wbr',
]);

// Whole-card anchors (an entire teaser wrapped in one link) are real prose;
// shorter single-link blocks are navigation/CTA chrome.
const SINGLE_ANCHOR_MIN_LENGTH = 80;

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

// Attribute-level navigation chrome. Modern docs/app layouts build sidebars,
// tables of contents, and breadcrumb rails out of generic elements (Fumadocs:
// <aside id="nd-sidebar">, <div id="nd-toc">), so tag-name exclusion alone
// misses them. A container is chrome when its role names a navigation
// surface, or when its id or one of its class NAMES carries a chrome token
// at a word boundary ("nd-toc" and "doc-sidebar" match; "protocol" and
// "asidebar" do not).
const NAV_CHROME_ROLES = new Set(['navigation', 'complementary', 'menu', 'menubar', 'toolbar', 'tablist']);
const NAV_CHROME_TOKEN_RE = /(?:^|[^a-z0-9])(?:toc|table-of-contents|sidebar|side-bar|breadcrumbs?)(?![a-z0-9])/i;

function getOpenTagAttr(tagRaw, name) {
  const re = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const match = tagRaw.match(re);
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3] ?? '';
}

// The token test runs per class NAME, and class names carrying Tailwind
// variant/arbitrary-value syntax ([…], (…), :) are skipped entirely: utility
// classes like [--fd-sidebar-width:286px] or [grid-area:sidebar] describe
// layout geometry on ordinary content wrappers — on a Fumadocs page the ROOT
// layout div carries them, and matching it would swallow the whole page.
function classNamesCarryChromeToken(classValue) {
  for (const name of classValue.split(/\s+/)) {
    if (!name || /[[\]():]/.test(name)) continue;
    if (NAV_CHROME_TOKEN_RE.test(name)) return true;
  }
  return false;
}

function isNavChromeOpenTag(tagRaw) {
  const role = getOpenTagAttr(tagRaw, 'role');
  if (role && NAV_CHROME_ROLES.has(role.trim().toLowerCase())) return true;
  const id = getOpenTagAttr(tagRaw, 'id');
  if (id && NAV_CHROME_TOKEN_RE.test(id)) return true;
  const cls = getOpenTagAttr(tagRaw, 'class');
  if (cls && classNamesCarryChromeToken(cls)) return true;
  return false;
}

// Close position for an attribute-matched chrome container. Unlike the
// tag-name containers (nav, button, code… — which do not nest themselves in
// practice), chrome is usually a generic div/section whose subtree nests the
// same tag freely, so the first </div> is NOT the container's close: walk
// real tag tokens depth-counting the container's own tag, skipping comment
// spans and inert-container content (a "</div>" inside a script string must
// not close the chrome early). Returns -1 when no balanced close is found
// within the cap — the container is then left in place, same as an unclosed
// tag-name container.
const CHROME_SCAN_CAP = 50000;

function findBalancedContainerEnd(source, name, fromIndex, inertSet) {
  let depth = 1;
  let i = fromIndex;
  for (let steps = 0; steps < CHROME_SCAN_CAP && i < source.length; steps++) {
    const lt = source.indexOf('<', i);
    if (lt === -1) return -1;
    if (source.startsWith('<!--', lt)) {
      const close = source.indexOf('-->', lt + 4);
      if (close === -1) return -1;
      i = close + 3;
      continue;
    }
    const token = scanTagAt(source, lt);
    if (!token) { i = lt + 1; continue; }
    if (!token.isClose && !token.selfClose && token.name !== name && inertSet.has(token.name)) {
      const closeRe = new RegExp(`</${token.name}\\s*>`, 'gi');
      closeRe.lastIndex = token.end;
      const closeMatch = closeRe.exec(source);
      i = closeMatch ? closeMatch.index + closeMatch[0].length : token.end;
      continue;
    }
    if (token.name === name) {
      if (token.isClose) {
        depth--;
        if (depth === 0) return token.end;
      } else if (!token.selfClose) {
        depth++;
      }
    }
    i = token.end;
  }
  return -1;
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
    } else if (!token.isClose && !token.selfClose
      && isNavChromeOpenTag(source.slice(lt, token.end))) {
      const end = findBalancedContainerEnd(source, token.name, token.end, containerSet);
      if (end !== -1) {
        ranges.push([lt, end]);
        i = end;
        continue;
      }
    }
    i = token.end;
  }
  return ranges;
}


