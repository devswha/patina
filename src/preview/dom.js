// Shared low-level HTML primitives for the preview pipeline: a quoted-aware
// tag scanner, entity decoders, and the inert-snapshot sanitizer. Imported by
// snapshot/extract/render so the tag-walking and active-content-stripping
// rules live in exactly one place.

// String.fromCodePoint throws a RangeError on a code point > U+10FFFF (or
// negative), so a page with a numeric reference like &#xFFFFFFFF; would crash
// prose extraction / srcdoc inlining. Out-of-range references aren't valid
// characters — leave the original entity text in place rather than throw (#527 H1).
export function fromCodePointSafe(codePoint, original) {
  return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
    ? String.fromCodePoint(codePoint)
    : original;
}

// A '<' or '>' is legal inside a quoted HTML attribute value (data-* JSON,
// serialized template markup, aria-label="Next >"…). A naive regex that
// matches tag boundaries by `<`/`>` therefore computes the wrong element
// boundaries on real-world markup. scanTagAt walks from a '<' through the
// tag's attributes — skipping quoted spans — to the '>' that actually closes
// the tag, returning the tag name, whether it is an end tag, and the offset
// just past '>'. Everything downstream sees only real tag tokens, so a swap
// position can never land inside an attribute value.
export function scanTagAt(source, ltIndex) {
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
export function stripActiveContent(html) {
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

export function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (m, hex) => fromCodePointSafe(parseInt(hex, 16), m))
    .replace(/&#(\d+);/g, (m, dec) => fromCodePointSafe(Number(dec), m))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

