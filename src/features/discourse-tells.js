// Density-gated discourse tells (issue #334). Unlike markup-leakage (a single
// near-proof-grade hit), these are constructions humans also use, so each fires
// only past a density threshold to keep false positives low.
//
// 1. Fake-candor / manufactured-intimacy openers (English): AI overuses
//    intimacy-signaling openers ("here's the thing", "let's be honest") that
//    real writers use sparingly. Fires at >= 2 per document.
// 2. Decorative thematic breaks: AI sprinkles `---` / `***` / `___` dividers,
//    often before every heading. Fires at >= 3 per document.

const FAKE_CANDOR_RULES = [
  /\bhere'?s the thing\b/gi,
  /\bhere'?s the kicker\b/gi,
  /\blet'?s be honest\b/gi,
  /\blet'?s be real\b/gi,
  /\bthe truth is\b/gi,
  /\bi'?ll be honest(?: with you)?\b/gi,
  /\breal talk\b/gi,
];

const FAKE_CANDOR_MIN = 2;
const THEMATIC_BREAK_MIN = 3;

// A markdown thematic break: a line that is only ---, ***, or ___ (3+), optionally spaced.
const THEMATIC_BREAK_LINE = /^[ \t]*(?:-[ \t]*){3,}$|^[ \t]*(?:\*[ \t]*){3,}$|^[ \t]*(?:_[ \t]*){3,}$/;
const HEADING_LINE = /^[ \t]*#{1,6}[ \t]+\S/;
// Only the dash variant of a thematic break can also be a CommonMark setext
// H2 underline; *** / ___ are always thematic breaks.
const SETEXT_UNDERLINE_CANDIDATE = /^[ \t]*(?:-[ \t]*){3,}$/;
// A line that, when it sits directly above a dash-only line, makes that dash
// line a setext underline rather than a divider: anything that is not blank,
// not a heading, not itself a break, and not a list/blockquote marker.
const NON_SETEXT_PARENT = /^[ \t]*(?:[-*+][ \t]|\d+[.)][ \t]|>)/;

// A dash-only line is a setext H2 underline (not a decorative divider) when the
// immediately preceding line is plain prose (#442).
function isSetextUnderline(lines, i) {
  if (!SETEXT_UNDERLINE_CANDIDATE.test(lines[i])) return false;
  const prev = i > 0 ? lines[i - 1] : '';
  if (prev.trim() === '') return false;
  if (HEADING_LINE.test(prev)) return false;
  if (THEMATIC_BREAK_LINE.test(prev)) return false;
  if (NON_SETEXT_PARENT.test(prev)) return false;
  return true;
}

// Index of the closing fence of a leading YAML frontmatter block, or -1. The two
// `---` lines a real frontmatter block contributes at file start are not
// dividers. To avoid mistaking a document that merely opens with a `---`
// divider for frontmatter, the line right after the opening fence must look
// like YAML (a `key:` line or a `- ` list item) — never a markdown heading or
// prose (#442).
function frontmatterEndIndex(lines) {
  if (lines[0] === undefined || !/^---[ \t]*$/.test(lines[0])) return -1;
  if (lines[1] === undefined || !/^[ \t]*(?:[\w.$-]+[ \t]*:(?:\s|$)|- )/.test(lines[1])) {
    return -1;
  }
  for (let j = 2; j < lines.length; j++) {
    if (/^(?:---|\.\.\.)[ \t]*$/.test(lines[j])) return j;
  }
  return -1;
}

export function detectFakeCandor(text) {
  const str = typeof text === 'string' ? text : '';
  const hits = [];
  let count = 0;
  for (const re of FAKE_CANDOR_RULES) {
    const m = str.match(re);
    if (m && m.length) {
      count += m.length;
      hits.push(...new Set(m.map((x) => x.trim().toLowerCase())));
    }
  }
  return { count, hits: [...new Set(hits)].slice(0, 5), hot: count >= FAKE_CANDOR_MIN, threshold: FAKE_CANDOR_MIN };
}

export function detectThematicBreaks(text) {
  const lines = (typeof text === 'string' ? text : '').split(/\r?\n/);
  const frontmatterEnd = frontmatterEndIndex(lines);
  let count = 0;
  let adjacentToHeading = 0;
  for (let i = 0; i < lines.length; i++) {
    if (i <= frontmatterEnd) continue;
    if (!THEMATIC_BREAK_LINE.test(lines[i])) continue;
    if (isSetextUnderline(lines, i)) continue;
    count++;
    // "adjacent to a heading" = the next non-empty line is a heading.
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === '') continue;
      if (HEADING_LINE.test(lines[j])) adjacentToHeading++;
      break;
    }
  }
  return { count, adjacentToHeading, hot: count >= THEMATIC_BREAK_MIN, threshold: THEMATIC_BREAK_MIN };
}

/**
 * True when a paragraph consists solely of thematic-break lines (e.g. a bare
 * `---` divider that splitParagraphs turned into its own pseudo-paragraph).
 * Used by prose gates to keep hot-ratio denominators on actual prose while the
 * analyzer still attributes hot status to the divider for rewrite scope.
 *
 * @param {string} text Paragraph text.
 * @returns {boolean}
 */
export function isThematicBreakOnly(text) {
  const lines = (typeof text === 'string' ? text : '').split(/\r?\n/);
  let breaks = 0;
  for (const line of lines) {
    if (line.trim() === '') continue;
    if (!THEMATIC_BREAK_LINE.test(line)) return false;
    breaks++;
  }
  return breaks > 0;
}

/**
 * @returns {{ fakeCandor: object, thematicBreaks: object, hot: boolean }}
 */
export function detectDiscourseTells(text) {
  const fakeCandor = detectFakeCandor(text);
  const thematicBreaks = detectThematicBreaks(text);
  return { fakeCandor, thematicBreaks, hot: fakeCandor.hot || thematicBreaks.hot };
}

export { FAKE_CANDOR_MIN, THEMATIC_BREAK_MIN };
