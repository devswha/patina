#!/usr/bin/env node
// Score MDX docs through the canonical prose scorer (issue #398).
//
// Delegates to scoreText from scripts/prose-score.mjs so the cached lexicon,
// repoRoot pattern packs, and the LEAKAGE score floor from src/scoring.js all
// apply (rows rank by `flooredScore`). The old DISCOURSE floor is gone (#391):
// discourse tells reach the ranking through per-paragraph hot attribution
// instead. MDX ESM import/export blocks are stripped first so they are not
// counted as prose paragraphs.
//
// Usage: node scripts/qa/mdx-score.mjs <docsDir> <lang>
import { readFileSync, statSync } from 'node:fs';
import { relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import { scoreText, walkFiles } from '../prose-score.mjs';

export const SUPPORTED_LANGS = ['en', 'ko', 'zh', 'ja'];
const NON_EN_SUFFIXES = SUPPORTED_LANGS.filter((lang) => lang !== 'en');

// MDX scoring policy: uniform list items and standalone link lines are
// navigation, not prose; inline code names are prose-visible vocabulary.
const MDX_STRIP_OPTIONS = {
  dropListItems: true,
  dropStandaloneLinks: true,
  keepInlineCode: true,
};
const MIN_PROSE_CHARS = 40;
const TOP_N = 15;

// Matches only syntactic ESM statement openers — not hard-wrapped prose lines
// that happen to begin with "import " or "export " (e.g. "export the results
// to CSV, or…"). import requires a specifier shape (brace, star, module
// string, or a default binding with a `from '…'` clause); export requires a
// declaration keyword, brace, or star.
const ESM_START_RE = new RegExp(
  [
    /^import\s+[{*'"]/, // import { x } …  / import * as ns …  / import 'mod'
    /^import\s+[\w$]+.*\bfrom\s*['"]/, // import Default [, { x }] from 'mod'
    /^import\s+[\w$]+\s*,\s*\{/, // import Default, {  (multi-line named list)
    /^export\s+\{/, // export { x }
    /^export\s+\*/, // export * from 'mod'
    /^export\s+(?:default|const|let|var|function|async\s+function|class)\b/,
  ].map((re) => re.source).join('|')
);

// Bracket depth for one line of an ESM statement, skipping brackets inside
// string/template literals and // comments so `export const x = "fn(";` does
// not leave the depth open and swallow the prose below. `quote` carries an
// open template literal across lines; '…' and "…" never span lines.
function scanEsmLine(line, depth, quote) {
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '/' && line[i + 1] === '/') break;
    else if (ch === '{' || ch === '(' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ')' || ch === ']') depth -= 1;
  }
  if (quote === "'" || quote === '"') quote = null;
  return { depth, quote };
}

// A statement keeps continuing while a template literal or brackets are open,
// or the line ends on a token that cannot terminate it (comma, assignment,
// opening bracket).
function esmStatementContinues(depth, quote, line) {
  if (quote === '`') return true;
  return depth > 0 || /[,=([{]\s*$/.test(line.trimEnd());
}

// Remove top-level MDX ESM import/export statements (fumadocs-style files put
// them between the frontmatter and the prose). Pragmatic line-based handling:
// a block starting with ESM_START_RE is dropped up to the line that ends the
// statement (balanced brackets outside strings, no trailing continuation
// token). A blank line outside a template literal always ends the block — a
// safety valve so one odd statement can never eat the rest of the document.
// Fenced code blocks pass through untouched so stripProse can remove them.
export function stripMdxEsm(raw) {
  const lines = String(raw || '').split('\n');
  const out = [];
  let fenceMarker = null;
  let inEsm = false;
  let esmDepth = 0;
  let esmQuote = null;
  for (const line of lines) {
    if (!inEsm) {
      const fence = line.match(/^\s*(```|~~~)/);
      if (fence) {
        if (fenceMarker === null) fenceMarker = fence[1];
        else if (fence[1] === fenceMarker) fenceMarker = null;
        out.push(line);
        continue;
      }
      if (fenceMarker !== null) {
        out.push(line);
        continue;
      }
      if (ESM_START_RE.test(line)) {
        ({ depth: esmDepth, quote: esmQuote } = scanEsmLine(line, 0, null));
        inEsm = esmStatementContinues(esmDepth, esmQuote, line);
        continue;
      }
      out.push(line);
      continue;
    }
    if (esmQuote !== '`' && /^\s*$/.test(line)) {
      inEsm = false;
      esmDepth = 0;
      out.push(line);
      continue;
    }
    ({ depth: esmDepth, quote: esmQuote } = scanEsmLine(line, esmDepth, esmQuote));
    inEsm = esmStatementContinues(esmDepth, esmQuote, line);
  }
  return out.join('\n');
}

export function collectMdxFiles(dir, lang) {
  // endsWith comparison instead of an interpolated RegExp: lang never acts as
  // a regex metacharacter (issue #398 defect 3).
  const all = walkFiles(dir, { match: (path) => path.endsWith('.mdx') });
  if (lang === 'en') {
    // en files have no language suffix (foo.mdx); ko/zh/ja are foo.<lang>.mdx.
    return all.filter((file) => !NON_EN_SUFFIXES.some((suffix) => file.endsWith(`.${suffix}.mdx`)));
  }
  return all.filter((file) => file.endsWith(`.${lang}.mdx`));
}

export function scoreMdxText(raw, { file = '', lang } = {}) {
  return scoreText(stripMdxEsm(raw), { file, lang, strip: MDX_STRIP_OPTIONS });
}

export function runMdxScore(dir, lang) {
  const rows = [];
  const thin = []; // analyzer-skipped prose with a hot signal -> template candidate
  for (const path of collectMdxFiles(dir, lang)) {
    const file = relative(dir, path);
    const row = scoreMdxText(readFileSync(path, 'utf8'), { file, lang });
    if (row.proseLength < MIN_PROSE_CHARS) continue;
    const rec = {
      f: file,
      score: Math.round(row.flooredScore),
      hot: row.hotCount,
      total: row.paragraphCount,
      leak: row.markupLeakage.leaked,
      candor: row.discourseTells.fakeCandor,
    };
    // The analyzer's own skip verdict (paragraphs<=2 / sentences<=2) replaces
    // the old local MIN_PROSE_PARAS floor: too little prose to trust a
    // hot/total ratio, where one hot intro reads as a misleading 100%.
    if (row.analysisSkipped) {
      if (rec.hot > 0 || rec.leak) thin.push(rec);
    } else {
      rows.push(rec);
    }
  }
  rows.sort((a, b) => b.score - a.score);
  return { rows, thin };
}

export function formatMdxReport({ rows, thin }, lang) {
  const lines = [];
  lines.push(`scored ${rows.length} files (lang=${lang}, analyzer prose floor applied)`);
  lines.push(`TOP ${TOP_N} most AI-ish:`);
  for (const r of rows.slice(0, TOP_N)) {
    lines.push(`  ${String(r.score).padStart(3)}  ${r.hot}/${r.total}${r.leak ? ' LEAK' : ''}${r.candor ? ' CANDOR' : ''}  ${r.f}`);
  }
  const avg = rows.length ? Math.round(rows.reduce((sum, r) => sum + r.score, 0) / rows.length) : 0;
  lines.push(`avg: ${avg} | >50: ${rows.filter((r) => r.score > 50).length} | ==0: ${rows.filter((r) => r.score === 0).length}`);
  lines.push('');
  lines.push(`THIN prose (analyzer-skipped) with a hot signal — template-intro candidates: ${thin.length}`);
  for (const r of thin) {
    lines.push(`  ${r.hot}/${r.total}${r.leak ? ' LEAK' : ''}  ${r.f}`);
  }
  return lines.join('\n');
}

function usage() {
  return [
    'usage: node scripts/qa/mdx-score.mjs <docsDir> <lang>',
    `  lang: one of ${SUPPORTED_LANGS.join(', ')} (en matches foo.mdx; others match foo.<lang>.mdx)`,
  ].join('\n');
}

function main(argv) {
  const [dir, lang] = argv;
  if (!dir || !SUPPORTED_LANGS.includes(lang)) {
    console.error(usage());
    process.exit(1);
  }
  let isDir = false;
  try {
    isDir = statSync(dir).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) {
    console.error(`mdx-score: not a directory: ${dir}\n${usage()}`);
    process.exit(1);
  }
  console.log(formatMdxReport(runMdxScore(dir, lang), lang));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
