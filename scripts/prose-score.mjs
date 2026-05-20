import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzeText } from '../src/features/index.js';
import { loadLexicon } from '../src/features/lexicon.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_REPO_ROOT = resolve(__dirname, '..');
export const DEFAULT_PROSE_EXTENSIONS = ['.md', '.mdx', '.txt', '.rst', '.adoc'];

const lexiconCache = new Map();

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

export function stripNonProse(markdown) {
  return String(markdown || '')
    .replace(/^---\n[\s\S]*?\n---\s*/, '\n')
    .replace(/```[\s\S]*?```/g, '\n')
    .replace(/~~~[\s\S]*?~~~/g, '\n')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s*\|.*\|\s*$/gm, '\n')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
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

export function scoreText(text, { file = '', lang = 'auto', gate = 30, repoRoot = DEFAULT_REPO_ROOT } = {}) {
  const prose = stripNonProse(text);
  const resolvedLang = detectLanguage(file, prose, lang);
  const result = analyzeText(prose, {
    lang: resolvedLang,
    repoRoot,
    lexicon: getLexicon(resolvedLang, repoRoot),
  });
  const paragraphCount = result.paragraphs.length;
  const hotCount = result.paragraphs.filter((p) => p.hot).length;
  const score = paragraphCount ? (hotCount / paragraphCount) * 100 : 0;
  return {
    file,
    lang: resolvedLang,
    paragraphCount,
    hotCount,
    score,
    gate,
    overGate: score > gate,
    skipped: paragraphCount === 0,
  };
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

  lines.push('| status | file | lang | paragraphs | hot | score |');
  lines.push('|---|---|---:|---:|---:|---:|');
  for (const row of rows) {
    lines.push(
      `| ${statusIcon(row)} | ${escapeCell(row.file)} | ${row.lang} | ${row.paragraphCount} | ${row.hotCount} | ${row.score.toFixed(1)}% |`
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
