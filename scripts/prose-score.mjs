import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadLexicon } from '../src/features/lexicon.js';
import { loadPatterns } from '../src/loader.js';
import { stripNonProse, detectLanguage, scoreProse } from '../src/prose-core.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPO_ROOT = resolve(__dirname, '..');
export const DEFAULT_PROSE_EXTENSIONS = ['.md', '.mdx', '.txt', '.rst', '.adoc'];

const lexiconCache = new Map();
const patternTermCache = new Map();

export function isProsePath(file, extensions = DEFAULT_PROSE_EXTENSIONS) {
  const lower = file.toLowerCase();
  return extensions.some((ext) => lower.endsWith(ext));
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
  const { leaked: _leaked, discourseHot: _discourseHot, ...scored } = scoreProse(text, {
    file,
    lang: resolvedLang,
    gate,
    lexicon: getLexicon(resolvedLang, repoRoot),
    strip,
  });
  const patternHits = countPatternWatchHits(prose, getPatternWatchTerms(resolvedLang, repoRoot), resolvedLang);
  return { file, ...scored, patternHits };
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
