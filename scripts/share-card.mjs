#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scoreDeterministicSignals } from '../src/scoring.js';
import { getRepoRoot } from '../src/config.js';

// Shareable before/after + score card (#283). SVG only — no new runtime dep,
// no PNG raster (that would need sharp/resvg). 1200x630 is the OG/Twitter card
// size. Scores are derived from the deterministic engine (scoreDeterministicSignals),
// never recomputed by hand and never an LLM call, so the card stays reproducible.

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;

// Cap the embedded prose so the card never leaks a full document and the text
// fits the panel. Truncation appends an ellipsis.
export const MAX_SNIPPET_CHARS = 280;
// Wrap inside the ~440px text column of the 500px panel at 25px. The budget is
// measured in "columns": a CJK glyph is ~full-width (2 columns) while Latin is
// ~half-width (1), so a fixed character count overflows for CJK. ~36 columns
// keeps both a Latin line and a Hangul/Kana/Han line inside the panel.
const PANEL_WRAP_COLUMNS = 36;
const MAX_PANEL_LINES = 6;

// Keep the font stack to a system fallback: GitHub/social render SVG via <img>
// with no web-font loading, so an Inter dependency would silently drop to a
// default and break CJK (the #217 lesson). This stack covers ko/zh/ja.
const FONT_STACK =
  'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, ' +
  '"Segoe UI", "Helvetica Neue", "Apple SD Gothic Neo", "Noto Sans KR", ' +
  '"Noto Sans CJK KR", "Noto Sans CJK JP", "Noto Sans CJK SC", ' +
  '"Hiragino Sans", "Microsoft YaHei", Arial, sans-serif';

export function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Collapse runs of whitespace (incl. newlines) into single spaces and trim, so
// a multi-paragraph snippet renders as flowing card text rather than raw breaks.
export function normalizeSnippet(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function truncateSnippet(value, max = MAX_SNIPPET_CHARS) {
  const text = normalizeSnippet(value);
  if (text.length <= max) return text;
  // Use the Unicode ellipsis; never split the middle of a surrogate pair.
  const codepoints = Array.from(text);
  if (codepoints.length <= max) return text;
  return `${codepoints.slice(0, max).join('').trimEnd()}\u2026`;
}

// Display width of one code point in render "columns": full-width for CJK
// (Hangul, Kana, CJK ideographs, full-width forms), half-width otherwise. This
// is a coarse East-Asian-Width approximation — enough to keep both Latin and
// CJK lines inside the panel without a Unicode width table dependency.
export function charColumns(ch) {
  const cp = ch.codePointAt(0);
  if (cp === undefined) return 1;
  const wide =
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK radicals / Kangxi / symbols
    (cp >= 0x3041 && cp <= 0x33ff) || // Hiragana, Katakana, CJK symbols
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Ext A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK Unified
    (cp >= 0xa000 && cp <= 0xa4cf) || // Yi
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compatibility ideographs
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK compatibility forms
    (cp >= 0xff00 && cp <= 0xff60) || // full-width forms
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x20000 && cp <= 0x3fffd); // CJK Ext B+
  return wide ? 2 : 1;
}

export function stringColumns(value) {
  let total = 0;
  for (const ch of Array.from(String(value ?? ''))) total += charColumns(ch);
  return total;
}

// Greedy word-wrap measured in columns (CJK glyphs count double). CJK text has
// no spaces, so when a single "word" overflows the panel we hard-break it by
// character. Returns at most MAX_PANEL_LINES lines, the last ending with an
// ellipsis if clipped.
export function wrapSnippetLines(value, { wrap = PANEL_WRAP_COLUMNS, maxLines = MAX_PANEL_LINES } = {}) {
  const text = truncateSnippet(value);
  if (!text) return [];
  const lines = [];
  let current = '';
  const flush = () => {
    if (current) lines.push(current);
    current = '';
  };
  for (const word of text.split(' ')) {
    if (stringColumns(word) > wrap) {
      // Hard-break an overlong token (CJK run or a long URL/identifier).
      flush();
      for (const ch of Array.from(word)) {
        if (stringColumns(current) + charColumns(ch) > wrap) flush();
        current += ch;
      }
      continue;
    }
    const candidate = current ? `${current} ${word}` : word;
    if (stringColumns(candidate) > wrap) {
      flush();
      current = word;
    } else {
      current = candidate;
    }
  }
  flush();
  if (lines.length <= maxLines) return lines;
  const clipped = lines.slice(0, maxLines);
  // Trim the final visible line by columns, leaving room for the ellipsis.
  const chars = Array.from(clipped[maxLines - 1]);
  let kept = '';
  for (const ch of chars) {
    if (stringColumns(kept) + charColumns(ch) > wrap - 1) break;
    kept += ch;
  }
  clipped[maxLines - 1] = `${kept.trimEnd()}\u2026`;
  return clipped;
}

function renderTspans(lines, x) {
  return lines
    .map((line, index) => `<tspan x="${x}" dy="${index === 0 ? 0 : 38}">${escapeXml(line)}</tspan>`)
    .join('');
}

// Format a 0-100 score for the chip, or '—' when the deterministic engine
// skipped (too short) or could not produce a number.
export function formatScoreValue(score) {
  if (score === null || score === undefined) return '\u2014';
  const n = Number(score);
  if (!Number.isFinite(n)) return '\u2014';
  return String(Math.round(n));
}

export function formatScoreLine({ aiScore, mps }) {
  const parts = [`AI ${formatScoreValue(aiScore)}`];
  if (mps !== null && mps !== undefined && Number.isFinite(Number(mps))) {
    parts.push(`MPS ${formatScoreValue(mps)}`);
  }
  return parts.join('  ·  ');
}

/**
 * Render a 1200x630 brand share card comparing before/after prose with scores.
 *
 * @param {object} card Card content.
 * @param {string} card.before Original (AI-sounding) text; truncated + escaped.
 * @param {string} card.after Rewritten text; truncated + escaped.
 * @param {number|null} [card.aiScore] 0-100 AI-likeness for the "after" text.
 * @param {number|null} [card.mps] 0-100 Meaning-Preservation Score (LLM-derived; optional).
 * @param {number|null} [card.beforeScore] Optional 0-100 AI-likeness for "before".
 * @param {string} [card.lang] Language code, for the footer tagline only.
 * @returns {string} A standalone, self-describing SVG document string.
 * @example
 * renderShareCard({ before: 'Coffee has emerged…', after: 'Coffee changed…', aiScore: 0 });
 */
export function renderShareCard({
  before = '',
  after = '',
  aiScore = null,
  mps = null,
  beforeScore = null,
  lang = 'en',
} = {}) {
  const beforeLines = wrapSnippetLines(before);
  const afterLines = wrapSnippetLines(after);
  const afterChip = formatScoreLine({ aiScore, mps });
  const beforeChip = beforeScore === null || beforeScore === undefined
    ? null
    : `AI ${formatScoreValue(beforeScore)}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}" role="img" aria-labelledby="title desc">
  <title id="title">patina before and after, with AI-likeness score</title>
  <desc id="desc">A social card comparing AI-sounding prose before a meaning-preserving rewrite and the cleaner text after, with the deterministic AI-likeness score (lang: ${escapeXml(lang)}).</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0b1020"/>
      <stop offset="55%" stop-color="#111827"/>
      <stop offset="100%" stop-color="#1f2937"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#000" flood-opacity="0.35"/>
    </filter>
  </defs>
  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="url(#bg)"/>
  <text x="72" y="78" fill="#f9fafb" font-family='${FONT_STACK}' font-size="46" font-weight="800">patina</text>
  <text x="72" y="118" fill="#a7f3d0" font-family='${FONT_STACK}' font-size="24" font-weight="600">Strip the AI packaging. Keep the meaning.</text>

  <g filter="url(#shadow)">
    <rect x="72" y="158" width="500" height="330" rx="26" fill="#111827" stroke="#374151" stroke-width="2"/>
    <text x="104" y="210" fill="#fca5a5" font-family='${FONT_STACK}' font-size="24" font-weight="800">Before${beforeChip ? `  ·  ${escapeXml(beforeChip)}` : ''}</text>
    <text x="104" y="258" fill="#e5e7eb" font-family='${FONT_STACK}' font-size="25">${renderTspans(beforeLines, 104)}</text>
  </g>

  <text x="596" y="332" fill="#93c5fd" font-family='${FONT_STACK}' font-size="42" font-weight="800">\u2192</text>

  <g filter="url(#shadow)">
    <rect x="628" y="158" width="500" height="330" rx="26" fill="#ecfdf5" stroke="#34d399" stroke-width="2"/>
    <text x="660" y="210" fill="#047857" font-family='${FONT_STACK}' font-size="24" font-weight="800">After  ·  ${escapeXml(afterChip)}</text>
    <text x="660" y="258" fill="#064e3b" font-family='${FONT_STACK}' font-size="25">${renderTspans(afterLines, 660)}</text>
  </g>

  <text x="72" y="548" fill="#d1d5db" font-family='${FONT_STACK}' font-size="23">Pattern-based · auditable · KO/EN/ZH/JA · Claude Code · Codex CLI · Cursor · OpenCode · Node CLI</text>
  <text x="72" y="586" fill="#93c5fd" font-family='${FONT_STACK}' font-size="22" font-weight="700">github.com/devswha/patina</text>
</svg>
`;
}

// Score "after" (and optionally "before") deterministically: LLM-free, no
// network, reproducible. The engine flags a short snippet as `skipped` (low
// confidence on <=2 paragraphs) but still computes a usable `overall`; a card
// snippet is short by design, so we use that number and only fall back to '—'
// when the engine produced no number at all (skipReason language-disabled,
// deterministic-failure, or an empty input).
function deterministicAiScore(text, lang, repoRoot) {
  const result = scoreDeterministicSignals({ text, config: { language: lang }, repoRoot });
  if (!result || result.overall === null || result.overall === undefined) {
    return null;
  }
  return result.overall;
}

export function buildCard({ before, after, lang = 'en', mps = null, repoRoot = getRepoRoot(), withBeforeScore = true } = {}) {
  return renderShareCard({
    before,
    after,
    lang,
    mps,
    aiScore: deterministicAiScore(after, lang, repoRoot),
    beforeScore: withBeforeScore ? deterministicAiScore(before, lang, repoRoot) : null,
  });
}

export function parseArgs(argv) {
  const opts = { before: null, after: null, beforeFile: null, afterFile: null, out: null, lang: 'en', mps: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--before') opts.before = argv[++i];
    else if (arg === '--after') opts.after = argv[++i];
    else if (arg === '--before-file') opts.beforeFile = argv[++i];
    else if (arg === '--after-file') opts.afterFile = argv[++i];
    else if (arg === '--out' || arg === '--card') opts.out = argv[++i];
    else if (arg === '--lang') opts.lang = argv[++i] || 'en';
    else if (arg === '--mps') opts.mps = Number(argv[++i]);
    else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new Error(`unknown option ${arg}`);
  }
  return opts;
}

const HELP = `patina share-card — render a 1200x630 before/after + score SVG (#283)

Usage:
  node scripts/share-card.mjs --before <text> --after <text> [--out card.svg] [--lang en] [--mps 92]
  node scripts/share-card.mjs --before-file a.txt --after-file b.txt --out card.svg

Reads --before/--after inline, or --before-file/--after-file from disk. Writes
the SVG to --out (or stdout). AI-likeness scores are computed deterministically;
--mps is optional (Meaning-Preservation Score is an LLM-derived number).`;

export function run(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  const before = opts.before ?? (opts.beforeFile ? readFileSync(resolve(opts.beforeFile), 'utf8') : null);
  const after = opts.after ?? (opts.afterFile ? readFileSync(resolve(opts.afterFile), 'utf8') : null);
  if (before === null || after === null) {
    throw new Error('share-card needs both --before/--before-file and --after/--after-file');
  }
  const mps = Number.isFinite(opts.mps) ? opts.mps : null;
  const svg = buildCard({ before, after, lang: opts.lang, mps });
  if (opts.out) {
    writeFileSync(resolve(opts.out), svg, 'utf8');
    process.stdout.write(`Written: ${resolve(opts.out)}\n`);
  } else {
    process.stdout.write(svg);
  }
}

const directPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (directPath === fileURLToPath(import.meta.url) || directPath === resolve(dirname(fileURLToPath(import.meta.url)), 'share-card.mjs')) {
  try {
    run();
  } catch (error) {
    console.error(`patina-share-card: ${error.message}`);
    process.exitCode = 2;
  }
}
