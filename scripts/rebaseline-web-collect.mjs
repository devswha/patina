#!/usr/bin/env node
// Fetch public Korean web pages into the private 2025+ rebaseline workspace.
//
// The output intentionally keeps full text in an ignored private JSONL file.
// Run scripts/rebaseline-score.mjs afterward to publish only hash/metadata and
// deterministic outcome fields.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { MATRIX } from './rebaseline-summary.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

export const DEFAULT_SOURCE_INPUT = 'artifacts/rebaseline-2025/sources.ko-public.jsonl';
export const DEFAULT_PRIVATE_OUTPUT = 'artifacts/rebaseline-2025/private/web-human-controls.generated.private.jsonl';
export const DEFAULT_MIN_CHARS = 90;
export const DEFAULT_MAX_CHARS = 700;
export const DEFAULT_MAX_PER_SOURCE = 8;
export const DEFAULT_TARGET_PER_REGISTER = 50;
export const DEFAULT_DELAY_MS = 250;

const HANGUL_RE = /[\u3131-\u318e\uac00-\ud7a3]/gu;
const BAD_BOILERPLATE_RE = /(본문듣기|말하기 속도|글자크기|인쇄하기|공유하기|목록|검색|닫기|저작권자|무단 전재|재배포 금지|자료출처|문의:|페이스북|트위터|카카오|Copyright|All rights reserved|View all|Apply now)/iu;

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    input: DEFAULT_SOURCE_INPUT,
    output: DEFAULT_PRIVATE_OUTPUT,
    minChars: DEFAULT_MIN_CHARS,
    maxChars: DEFAULT_MAX_CHARS,
    maxPerSource: DEFAULT_MAX_PER_SOURCE,
    targetPerRegister: DEFAULT_TARGET_PER_REGISTER,
    delayMs: DEFAULT_DELAY_MS,
    collectedAt: new Date().toISOString().slice(0, 10),
    dryRun: false,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input') args.input = argv[++i];
    else if (arg === '--output') args.output = argv[++i];
    else if (arg === '--min-chars') args.minChars = Number(argv[++i]);
    else if (arg === '--max-chars') args.maxChars = Number(argv[++i]);
    else if (arg === '--max-per-source') args.maxPerSource = Number(argv[++i]);
    else if (arg === '--target-per-register') args.targetPerRegister = Number(argv[++i]);
    else if (arg === '--delay-ms') args.delayMs = Number(argv[++i]);
    else if (arg === '--collected-at') args.collectedAt = argv[++i];
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  for (const [name, value] of Object.entries({
    minChars: args.minChars,
    maxChars: args.maxChars,
    maxPerSource: args.maxPerSource,
    targetPerRegister: args.targetPerRegister,
    delayMs: args.delayMs,
  })) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  }
  if (args.minChars > args.maxChars) throw new Error('minChars cannot exceed maxChars');
  if (Number.isNaN(Date.parse(args.collectedAt))) throw new Error('collected-at must be an ISO-like date');

  return args;
}

export function loadSourceRows(inputPath = DEFAULT_SOURCE_INPUT) {
  const abs = resolveRepoPath(inputPath);
  const result = {
    path: abs,
    relativePath: toRepoRelative(abs),
    rows: [],
    errors: [],
  };

  if (!existsSync(abs)) {
    result.errors.push(`source input not found: ${result.relativePath}`);
    return result;
  }

  const lines = readFileSync(abs, 'utf8').split(/\r?\n/u);
  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const line = lines[index].trim();
    if (!line || line.startsWith('#')) continue;

    try {
      result.rows.push({ lineNumber, value: normalizeSource(JSON.parse(line), lineNumber) });
    } catch (error) {
      result.errors.push(`line ${lineNumber}: ${error.message}`);
    }
  }

  return result;
}

function normalizeSource(input, lineNumber) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('source row must be a JSON object');
  }
  const source = { ...input };
  for (const field of ['source_id', 'url', 'register', 'source_title', 'source_license']) {
    if (typeof source[field] !== 'string' || source[field].trim() === '') {
      throw new Error(`${field} is required`);
    }
    source[field] = source[field].trim();
  }
  if (!MATRIX.registers.includes(source.register)) {
    throw new Error(`register must be one of ${MATRIX.registers.join(', ')}`);
  }
  try {
    const parsed = new URL(source.url);
    if (parsed.protocol !== 'https:') throw new Error('source url must use https');
  } catch (error) {
    throw new Error(`invalid url on line ${lineNumber}: ${error.message}`);
  }
  if (source.source_published_at && Number.isNaN(Date.parse(source.source_published_at))) {
    throw new Error('source_published_at must be an ISO-like date when present');
  }
  if (source.max_rows !== undefined && (!Number.isFinite(Number(source.max_rows)) || Number(source.max_rows) < 0)) {
    throw new Error('max_rows must be a non-negative number when present');
  }
  source.max_rows = source.max_rows === undefined ? null : Number(source.max_rows);
  source.sample_prefix = typeof source.sample_prefix === 'string' && source.sample_prefix.trim()
    ? source.sample_prefix.trim()
    : `ko-human-web-${slugify(source.source_id)}`;
  source.source_kind = typeof source.source_kind === 'string' && source.source_kind.trim()
    ? source.source_kind.trim()
    : 'public-web';
  return source;
}

export async function collectSources(sources, options = {}) {
  const opts = {
    minChars: options.minChars ?? DEFAULT_MIN_CHARS,
    maxChars: options.maxChars ?? DEFAULT_MAX_CHARS,
    maxPerSource: options.maxPerSource ?? DEFAULT_MAX_PER_SOURCE,
    targetPerRegister: options.targetPerRegister ?? DEFAULT_TARGET_PER_REGISTER,
    delayMs: options.delayMs ?? DEFAULT_DELAY_MS,
    collectedAt: options.collectedAt || new Date().toISOString().slice(0, 10),
    fetchImpl: options.fetchImpl || globalThis.fetch,
  };
  if (typeof opts.fetchImpl !== 'function') throw new Error('fetch is not available in this runtime');

  const records = [];
  const errors = [];
  const warnings = [];
  const seenHashes = new Set();
  const registerCounts = Object.fromEntries(MATRIX.registers.map((register) => [register, 0]));

  for (const source of sources) {
    if (registerCounts[source.register] >= opts.targetPerRegister) continue;
    let html;
    try {
      html = await fetchHtml(source.url, opts.fetchImpl);
    } catch (error) {
      warnings.push(`${source.source_id}: ${error.message}`);
      continue;
    }

    const candidates = extractTextCandidates(html, opts);
    const sourceLimit = Math.min(
      source.max_rows ?? opts.maxPerSource,
      opts.maxPerSource,
      opts.targetPerRegister - registerCounts[source.register]
    );
    let acceptedFromSource = 0;
    for (const text of candidates) {
      if (acceptedFromSource >= sourceLimit) break;
      const textHash = hashText(text);
      if (seenHashes.has(textHash)) continue;
      seenHashes.add(textHash);
      acceptedFromSource++;
      registerCounts[source.register]++;
      records.push(buildPrivateRecord({
        source,
        text,
        textHash,
        ordinal: acceptedFromSource,
        collectedAt: opts.collectedAt,
      }));
    }

    if (acceptedFromSource === 0) {
      warnings.push(`${source.source_id}: no paragraphs accepted from ${source.url}`);
    }
    if (opts.delayMs > 0) await sleep(opts.delayMs);
  }

  return {
    records,
    errors,
    warnings,
    registerCounts,
    sources: sources.length,
  };
}

async function fetchHtml(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: {
      'user-agent': 'patina-rebaseline-corpus-builder/1.0 (+https://github.com/devswha/patina)',
      accept: 'text/html,application/xhtml+xml',
    },
  });
  if (!response || !response.ok) {
    throw new Error(`fetch failed: HTTP ${response?.status ?? 'unknown'}`);
  }
  const contentType = response.headers?.get?.('content-type') || '';
  if (contentType && !/text\/html|application\/xhtml\+xml/iu.test(contentType)) {
    throw new Error(`expected HTML but got ${contentType}`);
  }
  return response.text();
}

export function extractTextCandidates(html, options = {}) {
  const minChars = options.minChars ?? DEFAULT_MIN_CHARS;
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const plain = decodeHtmlEntities(String(html || ''))
    .replace(/<!--[\s\S]*?-->/gu, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/giu, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/giu, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/giu, ' ')
    .replace(/<(?:p|div|section|article|main|br|li|h[1-6]|tr|td|blockquote)\b[^>]*>/giu, '\n')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\u00a0/gu, ' ');

  const seen = new Set();
  const candidates = [];
  for (const raw of plain.split(/\n+/u)) {
    const text = normalizeParagraph(raw);
    if (!isUsefulKoreanParagraph(text, { minChars, maxChars })) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(text);
  }
  return candidates;
}

function isUsefulKoreanParagraph(text, { minChars, maxChars }) {
  const chars = Array.from(text);
  if (chars.length < minChars || chars.length > maxChars) return false;
  if (BAD_BOILERPLATE_RE.test(text)) return false;
  const hangulCount = (text.match(HANGUL_RE) || []).length;
  if (hangulCount < 25) return false;
  const letterish = chars.filter((char) => /[\p{L}\p{N}]/u.test(char)).length || 1;
  if (hangulCount / letterish < 0.35) return false;
  if ((text.match(/https?:\/\//giu) || []).length > 0) return false;
  if ((text.match(/[|{}[\]<>]/gu) || []).length > 5) return false;
  return true;
}

function buildPrivateRecord({ source, text, textHash, ordinal, collectedAt }) {
  const suffix = String(ordinal).padStart(2, '0');
  return {
    language: 'ko',
    class: 'natural-human',
    model_family: 'human-reference',
    provider: 'web-human-control',
    model: 'human-authored-web-candidate',
    generated_at: source.source_published_at || collectedAt,
    decoding: 'not-applicable',
    postprocess: {
      editing_pass: 'none',
      extraction: 'scripted web paragraph candidate',
      source_kind: source.source_kind,
    },
    redistribution: 'hash-only',
    source_review: source.source_review || {
      status: 'hash-only-web-candidate',
      rationale: 'Raw text stays in gitignored private intake. Commit only URL, license note, metadata, score, and sha256 digest until redistribution review is complete.',
      license_basis: source.source_license,
    },
    reviewer_notes: source.reviewer_notes || 'Human-control candidate from public Korean web source; not a public benchmark claim.',
    sample_id: `${source.sample_prefix}-${suffix}`,
    register: source.register,
    source_url: source.url,
    source_title: source.source_title,
    source_license: source.source_license,
    ...(source.source_published_at ? { source_published_at: source.source_published_at } : {}),
    prompt_id: `${source.sample_prefix}-${suffix}`,
    text_hash: textHash,
    text,
  };
}

export function writePrivateOutput(result, outputPath = DEFAULT_PRIVATE_OUTPUT) {
  if (result.errors.length) throw new Error('refusing to write web corpus output with collection errors');
  const abs = resolveRepoPath(outputPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, result.records.map((record) => JSON.stringify(record)).join('\n') + (result.records.length ? '\n' : ''));
  return { output: toRepoRelative(abs) };
}

export function renderSummary(result, written = null) {
  const lines = [
    '# Rebaseline Web Collect Summary',
    '',
    `- Sources: ${result.sources}`,
    `- Private rows: ${result.records.length}`,
    `- Validation: **${result.errors.length ? 'FAIL' : 'PASS'}**`,
  ];
  if (written) lines.push(`- Private output: \`${written.output}\``);
  lines.push('', '## Register counts');
  for (const register of MATRIX.registers) {
    lines.push(`- ${register}: ${result.registerCounts[register] || 0}`);
  }
  if (result.errors.length) lines.push('', '## Errors', ...result.errors.map((error) => `- ${escapeMarkdown(error)}`));
  if (result.warnings.length) lines.push('', '## Warnings', ...result.warnings.map((warning) => `- ${escapeMarkdown(warning)}`));
  return `${lines.join('\n')}\n`;
}

function normalizeParagraph(text) {
  return String(text || '')
    .replace(/\s+/gu, ' ')
    .replace(/^[·•*\\-–—\s]+/u, '')
    .trim();
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&nbsp;/giu, ' ')
    .replace(/&amp;/giu, '&')
    .replace(/&lt;/giu, '<')
    .replace(/&gt;/giu, '>')
    .replace(/&quot;/giu, '"')
    .replace(/&#39;/giu, "'")
    .replace(/&#x([0-9a-f]+);/giu, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/gu, (_, num) => String.fromCodePoint(Number.parseInt(num, 10)));
}

function hashText(text) {
  return `sha256:${createHash('sha256').update(String(text)).digest('hex')}`;
}

function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 64) || 'source';
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function resolveRepoPath(path) {
  return resolve(REPO_ROOT, path);
}

function toRepoRelative(path) {
  return relative(REPO_ROOT, path) || path;
}

function escapeMarkdown(value) {
  return String(value ?? '').replace(/\|/gu, '\\|').replace(/\n/gu, ' ');
}

function printHelp() {
  console.log(`Usage: node scripts/rebaseline-web-collect.mjs [--input <sources.jsonl>] [--output <private.jsonl>] [--target-per-register <n>] [--max-per-source <n>] [--dry-run] [--json]

Fetches public Korean web pages listed in a JSONL source inventory and writes
private raw-text rows for the 2025+ rebaseline workflow. The output path should
stay under artifacts/rebaseline-2025/private/ and must not be committed.

Default input: ${DEFAULT_SOURCE_INPUT}
Default output: ${DEFAULT_PRIVATE_OUTPUT}`);
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    return;
  }

  const loaded = loadSourceRows(args.input);
  if (loaded.errors.length) {
    const result = { sources: 0, records: [], registerCounts: {}, errors: loaded.errors, warnings: [] };
    console.log(args.json ? JSON.stringify(result, null, 2) : renderSummary(result));
    process.exitCode = 1;
    return;
  }

  const result = await collectSources(loaded.rows.map((row) => row.value), args);
  const written = !args.dryRun && result.errors.length === 0
    ? writePrivateOutput(result, args.output)
    : null;
  if (args.json) console.log(JSON.stringify({ ...result, written }, null, 2));
  else console.log(renderSummary(result, written));
  if (result.errors.length) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`rebaseline-web-collect: ${error.message}`);
    process.exitCode = 1;
  });
}
