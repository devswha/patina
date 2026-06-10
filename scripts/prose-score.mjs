import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzeText } from '../src/features/index.js';
import { loadLexicon } from '../src/features/lexicon.js';
import {
  paragraphSignalStrength,
  summarizeSignalStrength,
} from '../src/features/signal-strength.js';
import { loadPatterns } from '../src/loader.js';
import { LEAKAGE_SCORE_FLOOR } from '../src/scoring.js';

export { paragraphSignalStrength, summarizeSignalStrength };

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPO_ROOT = resolve(__dirname, '..');
export const DEFAULT_PROSE_EXTENSIONS = ['.md', '.mdx', '.txt', '.rst', '.adoc'];

const lexiconCache = new Map();
const patternTermCache = new Map();

export function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

export function parseFileList(value = '') {
  return String(value)
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function isProsePath(file, extensions = DEFAULT_PROSE_EXTENSIONS) {
  const lower = file.toLowerCase();
  return extensions.some((ext) => lower.endsWith(ext));
}

export function stripProse(markdown, {
  dropListItems = false,
  dropStandaloneLinks = false,
  keepInlineCode = false,
} = {}) {
  let text = String(markdown || '')
    .replace(/^---\n[\s\S]*?\n---\s*/, '\n')
    .replace(/```[\s\S]*?```/g, '\n')
    .replace(/~~~[\s\S]*?~~~/g, '\n')
    // Remove Markdown tables before stripping inline HTML. Cells such as
    // `p<0.01` are prose-visible math, not HTML tags; if HTML stripping runs
    // first it can consume across rows and leave table fragments behind.
    .replace(/^\s*\|.*\|\s*$/gm, '\n');

  if (keepInlineCode) text = text.replace(/`([^`]*)`/g, '$1');
  else text = text.replace(/`[^`]*`/g, ' ');

  if (dropStandaloneLinks) {
    text = text.replace(/^\s*\[[^\]]+\]\([^)]*\)\s*$/gm, '\n');
  }

  text = text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+.*$/gm, '\n')
    .replace(/^\s{0,3}>\s?/gm, '');

  if (dropListItems) {
    text = text
      .replace(/^\s*[-*+]\s+.*$/gm, '\n')
      .replace(/^\s*\d+[.)]\s+.*$/gm, '\n');
  } else {
    text = text
      .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+[.)]\s+/gm, '');
  }

  return stripEmphasisMarkers(text)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Strip emphasis as *paired* markers only (issue #396). A blanket [*_] delete
// mangles non-emphasis tokens (utm_source=chatgpt.com -> utmsource=chatgpt.com,
// grok_card -> grokcard) before analyzeText runs, which kills the
// markup-leakage detector's underscore-dependent signatures. Pairing rules:
// the opener must not touch a word character on the outside (so `2*3` and
// `user_id` survive), the inner text must not start/end with whitespace, and
// the closing run must match the opening run length. The inner text may span
// Markdown soft line breaks (hard-wrapped `**bold\nacross lines**` is valid
// CommonMark emphasis) but never a blank line — emphasis cannot cross a
// paragraph boundary.
const PAIRED_ASTERISK_RE = /(?<![\w*])(\*{1,3})(?!\s)((?:[^*\n]|\n(?![ \t]*\n))+?)(?<!\s)\1(?![\w*])/g;
const PAIRED_UNDERSCORE_RE = /(?<![\w_])(_{1,3})(?!\s)((?:[^\n]|\n(?![ \t]*\n))+?)(?<!\s)\1(?![\w_])/g;

function stripEmphasisMarkers(text) {
  let out = text;
  // Fixpoint loop unwraps nesting such as **bold with *inner* emphasis**.
  for (let i = 0; i < 3; i++) {
    const next = out
      .replace(PAIRED_ASTERISK_RE, '$2')
      .replace(PAIRED_UNDERSCORE_RE, '$2');
    if (next === out) break;
    out = next;
  }
  return out;
}

export function stripNonProse(markdown, options = {}) {
  return stripProse(markdown, options);
}

export function detectLanguage(file, text = '', requested = 'auto') {
  const normalized = String(requested || 'auto').toLowerCase();
  if (['ko', 'en', 'zh', 'ja'].includes(normalized)) return normalized;

  const path = String(file || '').toLowerCase();
  if (/(^|[._/-])kr([._/-]|$)|(^|[._/-])ko([._/-]|$)|korean/.test(path)) return 'ko';
  if (/(^|[._/-])ja([._/-]|$)|japanese/.test(path)) return 'ja';
  if (/(^|[._/-])zh([._/-]|$)|chinese/.test(path)) return 'zh';

  const sample = String(text || '').slice(0, 12000);
  const hangul = (sample.match(/[\uac00-\ud7af]/g) || []).length;
  const kana = (sample.match(/[\u3040-\u30ff]/g) || []).length;
  const cjk = (sample.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (sample.match(/[A-Za-z]/g) || []).length;
  const cjkTotal = hangul + kana + cjk;
  if (latin >= 80 && latin > cjkTotal * 2) return 'en';
  if (hangul >= 8 && hangul >= kana && hangul >= cjk) return 'ko';
  if (kana >= 8) return 'ja';
  if (cjk >= 8) return 'zh';
  return 'en';
}

function getLexicon(lang, repoRoot) {
  const key = `${repoRoot}\0${lang}`;
  if (!lexiconCache.has(key)) lexiconCache.set(key, loadLexicon(lang, repoRoot));
  return lexiconCache.get(key);
}

function getPatternWatchTerms(lang, repoRoot) {
  const key = `${repoRoot}\0${lang}`;
  if (!patternTermCache.has(key)) {
    patternTermCache.set(key, extractPatternWatchTerms(loadPatterns(repoRoot, lang)));
  }
  return patternTermCache.get(key);
}

export function scoreText(text, {
  file = '',
  lang = 'auto',
  gate = 30,
  repoRoot = DEFAULT_REPO_ROOT,
  strip = {},
} = {}) {
  const prose = stripNonProse(text, strip);
  const resolvedLang = detectLanguage(file, prose, lang);
  const result = analyzeText(prose, {
    lang: resolvedLang,
    repoRoot,
    lexicon: getLexicon(resolvedLang, repoRoot),
  });
  const patternHits = countPatternWatchHits(prose, getPatternWatchTerms(resolvedLang, repoRoot), resolvedLang);
  // Gate semantics: `score`/`overGate` are the hot ratio over PROSE paragraphs.
  // Bare `---` divider lines survive stripProse (only leading frontmatter is
  // removed) and split into their own pseudo-paragraphs; with #391 attribution
  // each gated divider is hot, which would let markup — not prose — drive the
  // precommit/dogfood gates. Divider-only pseudo-paragraphs are therefore
  // excluded from the gate ratio and from the prose signal average.
  const proseParagraphs = result.paragraphs.filter((p) => !p.thematicBreakOnly);
  const paragraphCount = proseParagraphs.length;
  const hotCount = proseParagraphs.filter((p) => p.hot).length;
  const score = paragraphCount ? (hotCount / paragraphCount) * 100 : 0;
  const signalScore = summarizeSignalStrength(proseParagraphs);
  const leaked = Boolean(result.markupLeakage?.leaked);
  const discourseHot = result.discourseTells?.hot === true;
  // Ranking semantics (`flooredScore`, used by scripts/qa/mdx-score.mjs rows):
  // detection scope stays wider than the gate. The attributed ratio over ALL
  // analyzer paragraphs (divider pseudo-paragraphs included) can only raise the
  // ranking, so `---`-spam documents still surface as editing hotspots, and the
  // canonical near-proof-grade LEAKAGE_SCORE_FLOOR from src/scoring.js applies
  // on top. Discourse tells carry no document-level floor (#391): they reach
  // both scores through per-paragraph hot attribution.
  const attributedScore = result.paragraphs.length
    ? (result.paragraphs.filter((p) => p.hot).length / result.paragraphs.length) * 100
    : 0;
  const rankedScore = Math.max(score, attributedScore);
  const flooredScore = leaked ? Math.max(rankedScore, LEAKAGE_SCORE_FLOOR) : rankedScore;
  return {
    file,
    lang: resolvedLang,
    paragraphCount,
    hotCount,
    score,
    flooredScore,
    signalScore,
    patternHits,
    gate,
    overGate: score > gate,
    skipped: paragraphCount === 0,
    // The analyzer's own skip verdict (paragraphs<=2 / sentences<=2): too
    // little prose to trust a hot/total ratio.
    analysisSkipped: Boolean(result.skipped),
    skipReason: result.skipReason ?? null,
    proseLength: prose.length,
    markupLeakage: {
      leaked,
      hits: Array.isArray(result.markupLeakage?.hits) ? result.markupLeakage.hits.length : 0,
    },
    discourseTells: {
      hot: discourseHot,
      fakeCandor: result.discourseTells?.fakeCandor?.hot === true,
      thematicBreaks: result.discourseTells?.thematicBreaks?.hot === true,
    },
  };
}

export function extractPatternWatchTerms(patterns = []) {
  const terms = [];
  for (const pattern of patterns) {
    for (const line of String(pattern.body || '').split('\n')) {
      const match = line.match(/^\*\*([^*]+)\*\*\s*(.+)$/);
      if (!match || !isWatchLabel(match[1])) continue;
      const value = match[2].replace(/\s+—\s+/g, ', ');
      for (const raw of value.split(/[,，、;]/)) {
        const term = cleanPatternTerm(raw);
        if (term.length >= 2) terms.push(term);
      }
    }
  }
  return [...new Set(terms)];
}

export function countPatternWatchHits(text, terms = [], lang = 'en') {
  if (!text || !Array.isArray(terms) || terms.length === 0) return 0;
  const haystack = lang === 'en' ? String(text).toLowerCase() : String(text);
  let count = 0;
  for (const term of terms) {
    const needle = lang === 'en' ? term.toLowerCase() : term;
    if (needle && haystack.includes(needle)) count++;
  }
  return count;
}

function isWatchLabel(label) {
  const normalized = label.replace(/[：:]/g, '').trim().toLowerCase();
  return [
    'watch words',
    '주의 어휘',
    '고빈도 ai 어휘',
    '고빈도 어휘',
    '고빈도 표현',
    '高频词汇',
    '注意词汇',
    '注意词',
    '高頻度語彙',
    '注意語彙',
    '注意語',
  ].some((needle) => normalized.includes(needle.toLowerCase()));
}

function cleanPatternTerm(term) {
  return String(term || '')
    .replace(/^[\s`*_"'“”‘’「」『』()（）]+|[\s`*_"'“”‘’「」『』()（）.。]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Shared recursive file walker for scripts/ consumers (issue #398 asked for
// one walker instead of per-script copies).
export function walkFiles(dir, {
  match = () => true,
  ignore = (name) => name === 'node_modules' || name.startsWith('.'),
} = {}) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (ignore(entry)) continue;
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) out.push(...walkFiles(path, { match, ignore }));
    else if (stats.isFile() && match(path)) out.push(path);
  }
  return out.sort();
}

function isInside(base, candidate) {
  const rel = relative(base, candidate);
  return rel === '' || (!rel.startsWith('..') && !rel.includes(`..${sep}`));
}

export function normalizeFiles(files, {
  cwd = process.cwd(),
  extensions = DEFAULT_PROSE_EXTENSIONS,
  maxFiles = 50,
} = {}) {
  const base = resolve(cwd);
  const seen = new Set();
  const out = [];
  for (const raw of files) {
    if (!raw) continue;
    const absolute = resolve(base, raw);
    if (!isInside(base, absolute)) continue;
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    if (!existsSync(absolute)) continue;
    if (!statSync(absolute).isFile()) continue;
    const rel = relative(base, absolute);
    if (!isProsePath(rel, extensions)) continue;
    out.push(rel);
    if (out.length >= maxFiles) break;
  }
  return out;
}

export function scoreFiles(files, {
  cwd = process.cwd(),
  repoRoot = DEFAULT_REPO_ROOT,
  lang = 'auto',
  gate = 30,
  extensions = DEFAULT_PROSE_EXTENSIONS,
  maxFiles = 50,
} = {}) {
  return normalizeFiles(files, { cwd, extensions, maxFiles }).map((file) => {
    const body = readFileSync(resolve(cwd, file), 'utf8');
    return scoreText(body, { file, lang, gate, repoRoot });
  });
}

function statusIcon(row) {
  if (row.skipped) return 'skip';
  return row.overGate ? 'fail' : 'pass';
}

export function formatMarkdownReport(rows, { gate = 30, title = 'Patina prose hotspot report' } = {}) {
  const lines = [
    `# ${title}`,
    '',
    `Gate: **${Number(gate).toFixed(0)}%** hot prose paragraphs. This deterministic check flags editing hotspots; it is not an authorship verdict.`,
    '',
  ];

  if (rows.length === 0) {
    lines.push('No changed prose files were found.');
    return lines.join('\n');
  }

  lines.push('| status | file | lang | paragraphs | hot | score | signal | pattern hits |');
  lines.push('|---|---|---:|---:|---:|---:|---:|---:|');
  for (const row of rows) {
    const signalScore = Number.isFinite(Number(row.signalScore)) ? Number(row.signalScore) : 0;
    const patternHits = Number.isFinite(Number(row.patternHits)) ? Number(row.patternHits) : 0;
    lines.push(
      `| ${statusIcon(row)} | ${escapeCell(row.file)} | ${row.lang} | ${row.paragraphCount} | ${row.hotCount} | ${row.score.toFixed(1)}% | ${signalScore.toFixed(1)} | ${patternHits} |`
    );
  }
  return lines.join('\n');
}

export function summarizeRows(rows) {
  const maxScore = rows.reduce((max, row) => Math.max(max, row.score), 0);
  const failed = rows.filter((row) => row.overGate);
  return {
    fileCount: rows.length,
    failedCount: failed.length,
    maxScore,
    failed,
  };
}

function escapeCell(value) {
  return String(value).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}
