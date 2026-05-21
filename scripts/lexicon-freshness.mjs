#!/usr/bin/env node
// Validate lexicon per-entry provenance and produce public-safe lift reports
// from local/private JSONL corpora. Raw text is never written to reports.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

import { computeDensity } from '../src/features/lexicon.js';
import { tokenize } from '../src/features/segment.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DEFAULT_LEXICON_DIR = 'lexicon';
const REQUIRED_PROVENANCE_FIELDS = ['entry', 'kind', 'added', 'source', 'last_validated', 'lift', 'status'];
const HOT_CLASSES = new Set(['ai', 'ai-like', 'synthetic-ai', 'generated', 'lightly-edited-ai', 'heavily-edited-ai']);
const COLD_CLASSES = new Set(['human', 'natural', 'natural-human', 'human-reference']);

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    check: false,
    input: null,
    lang: 'en',
    sourceId: null,
    sourceNote: null,
    validatedAt: new Date().toISOString().slice(0, 10),
    outputJson: null,
    outputMd: null,
    sourceUrls: [],
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--check') args.check = true;
    else if (arg === '--input') args.input = argv[++i];
    else if (arg === '--lang') args.lang = argv[++i];
    else if (arg === '--source-id') args.sourceId = argv[++i];
    else if (arg === '--source-note') args.sourceNote = argv[++i];
    else if (arg === '--validated-at') args.validatedAt = argv[++i];
    else if (arg === '--output-json') args.outputJson = argv[++i];
    else if (arg === '--output-md') args.outputMd = argv[++i];
    else if (arg === '--source-url') args.sourceUrls.push(argv[++i]);
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (!args.check && !args.input) args.check = true;
  return args;
}

export function parseFrontmatterFile(path) {
  const raw = readFileSync(path, 'utf8');
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?/u);
  if (!match) return { meta: {}, body: raw, raw };
  return {
    meta: yaml.load(match[1]) || {},
    body: raw.slice(match[0].length),
    raw,
  };
}

export function parseLexiconEntries(body) {
  const strict = [];
  const phrases = [];
  let mode = null;
  for (const rawLine of body.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('## ')) {
      const heading = line.toLowerCase();
      if (heading.includes('strict matches')) mode = 'strict';
      else if (heading.includes('multi-word phrases')) mode = 'phrase';
      else mode = null;
      continue;
    }
    if (mode && line.startsWith('- ')) {
      const entry = line.slice(2).trim().normalize('NFC');
      if (entry) (mode === 'strict' ? strict : phrases).push(entry);
    }
  }
  return { strict, phrases, all: [...strict.map((entry) => ({ kind: 'strict', entry })), ...phrases.map((entry) => ({ kind: 'phrase', entry }))] };
}

export function checkLexiconProvenance(options = {}) {
  const repoRoot = options.repoRoot || REPO_ROOT;
  const lexiconDir = resolve(repoRoot, options.lexiconDir || DEFAULT_LEXICON_DIR);
  const langs = options.langs || ['en', 'ko', 'zh', 'ja'];
  const errors = [];
  const warnings = [];
  const files = [];

  for (const lang of langs) {
    const lexiconPath = resolve(lexiconDir, `ai-${lang}.md`);
    if (!existsSync(lexiconPath)) {
      errors.push(`missing lexicon: ${toRepoRelative(lexiconPath, repoRoot)}`);
      continue;
    }

    const parsed = parseFrontmatterFile(lexiconPath);
    const entries = parseLexiconEntries(parsed.body).all;
    const fileLabel = toRepoRelative(lexiconPath, repoRoot);
    const provenanceRef = parsed.meta['entry-provenance'];
    if (typeof provenanceRef !== 'string' || provenanceRef.length === 0) {
      errors.push(`${fileLabel}: entry-provenance frontmatter is required`);
      continue;
    }

    if (typeof parsed.meta.entries === 'number' && parsed.meta.entries !== entries.length) {
      errors.push(`${fileLabel}: frontmatter entries=${parsed.meta.entries} but parsed ${entries.length}`);
    }

    const provenancePath = resolve(repoRoot, provenanceRef);
    if (!existsSync(provenancePath)) {
      errors.push(`${fileLabel}: provenance file not found: ${provenanceRef}`);
      continue;
    }

    let provenance;
    try {
      provenance = JSON.parse(readFileSync(provenancePath, 'utf8'));
    } catch (error) {
      errors.push(`${provenanceRef}: invalid JSON (${error.message})`);
      continue;
    }
    if (!Array.isArray(provenance)) {
      errors.push(`${provenanceRef}: provenance must be a JSON array`);
      continue;
    }

    const entryKeys = new Set(entries.map(entryKey));
    const seen = new Set();
    for (const item of provenance) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        errors.push(`${provenanceRef}: each provenance row must be an object`);
        continue;
      }
      for (const field of REQUIRED_PROVENANCE_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(item, field)) {
          errors.push(`${provenanceRef}: ${entryLabel(item)} missing field ${field}`);
        }
      }
      if (!['strict', 'phrase'].includes(item.kind)) {
        errors.push(`${provenanceRef}: ${entryLabel(item)} kind must be strict or phrase`);
      }
      if (typeof item.entry !== 'string' || item.entry.length === 0) {
        errors.push(`${provenanceRef}: entry must be a non-empty string`);
      }
      if (typeof item.source !== 'string' || item.source.length === 0) {
        errors.push(`${provenanceRef}: ${entryLabel(item)} source must be a non-empty string`);
      }
      if (typeof item.status !== 'string' || item.status.length === 0) {
        errors.push(`${provenanceRef}: ${entryLabel(item)} status must be a non-empty string`);
      }
      if (item.last_validated !== null && typeof item.last_validated !== 'string') {
        errors.push(`${provenanceRef}: ${entryLabel(item)} last_validated must be string or null`);
      }
      if (item.added !== null && typeof item.added !== 'string') {
        errors.push(`${provenanceRef}: ${entryLabel(item)} added must be string or null`);
      }

      const key = entryKey(item);
      if (seen.has(key)) errors.push(`${provenanceRef}: duplicate provenance for ${key}`);
      seen.add(key);
      if (!entryKeys.has(key)) errors.push(`${provenanceRef}: orphan provenance for ${key}`);
    }

    for (const entry of entries) {
      const key = entryKey(entry);
      if (!seen.has(key)) errors.push(`${provenanceRef}: missing provenance for ${key}`);
    }

    files.push({ file: fileLabel, provenance: provenanceRef, entries: entries.length, provenanceRows: provenance.length });
  }

  return { ok: errors.length === 0, files, errors, warnings };
}

export function loadJsonlRows(inputPath, options = {}) {
  const repoRoot = options.repoRoot || REPO_ROOT;
  const abs = resolvePath(inputPath, repoRoot);
  const rows = [];
  const errors = [];
  if (!existsSync(abs)) {
    return { input: toRepoRelative(abs, repoRoot), rows, errors: [`input not found: ${toRepoRelative(abs, repoRoot)}`] };
  }

  const lines = readFileSync(abs, 'utf8').split(/\r?\n/u);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      rows.push({ lineNumber: index + 1, value: JSON.parse(line) });
    } catch (error) {
      errors.push(`line ${index + 1}: invalid JSON (${error.message})`);
    }
  }
  return { input: toRepoRelative(abs, repoRoot), rows, errors };
}

export function mineLexiconLift(rows, entries, options = {}) {
  const lang = options.lang || 'en';
  const hotDocs = [];
  const coldDocs = [];
  const errors = [];
  const warnings = [];

  for (const row of rows) {
    const raw = row.value || row;
    const label = row.lineNumber ? `line ${row.lineNumber}` : raw.sample_id || 'row';
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(`${label}: record must be an object`);
      continue;
    }
    if ((raw.language || lang) !== lang) continue;
    if (typeof raw.text !== 'string' || raw.text.length === 0) {
      warnings.push(`${label}: skipped row without local text`);
      continue;
    }
    if (HOT_CLASSES.has(raw.class)) hotDocs.push(raw);
    else if (COLD_CLASSES.has(raw.class)) coldDocs.push(raw);
    else warnings.push(`${label}: skipped unknown class ${raw.class}`);
  }

  const hotCounts = countEntryDocumentFrequency(hotDocs, entries, lang);
  const coldCounts = countEntryDocumentFrequency(coldDocs, entries, lang);
  const decisions = entries.map((entry) => {
    const key = entryKey(entry);
    const hot = hotCounts.counts.get(key) || 0;
    const cold = coldCounts.counts.get(key) || 0;
    const hotRate = hotDocs.length ? hot / hotDocs.length : 0;
    const coldRate = coldDocs.length ? cold / coldDocs.length : 0;
    const lift = cold === 0 ? (hot === 0 ? 0 : 'Infinity') : round(hotRate / coldRate, 3);
    const numericLift = lift === 'Infinity' ? Infinity : lift;
    const keep = hot > 0 && numericLift >= 4 && coldRate <= 0.05;
    return {
      kind: entry.kind,
      entry: entry.entry,
      hot_docs: hot,
      cold_docs: cold,
      hot_rate: round(hotRate, 5),
      cold_rate: round(coldRate, 5),
      lift,
      decision: keep ? 'keep' : 'drop',
    };
  });

  decisions.sort((a, b) => a.decision.localeCompare(b.decision) || a.kind.localeCompare(b.kind) || a.entry.localeCompare(b.entry));

  const gate = {
    hot_docs: hotDocs.length,
    cold_docs: coldDocs.length,
    hot_registers: hotCounts.registers,
    cold_registers: coldCounts.registers,
    min_docs_per_class: 25,
    min_registers_per_class: 2,
  };
  gate.ready = gate.hot_docs >= gate.min_docs_per_class && gate.cold_docs >= gate.min_docs_per_class
    && Object.keys(gate.hot_registers).length >= gate.min_registers_per_class
    && Object.keys(gate.cold_registers).length >= gate.min_registers_per_class;

  return {
    language: lang,
    source_id: options.sourceId || null,
    source_note: options.sourceNote || null,
    source_urls: options.sourceUrls || [],
    validated_at: options.validatedAt || null,
    input: options.input || null,
    entries: entries.length,
    kept: decisions.filter((row) => row.decision === 'keep').length,
    dropped: decisions.filter((row) => row.decision === 'drop').length,
    gate,
    decisions,
    errors,
    warnings,
  };
}

export function writeLiftReport(result, options = {}) {
  const written = {};
  if (options.outputJson) {
    const outputJson = resolvePath(options.outputJson, options.repoRoot || REPO_ROOT);
    mkdirSync(dirname(outputJson), { recursive: true });
    writeFileSync(outputJson, `${JSON.stringify(result, null, 2)}\n`);
    written.json = toRepoRelative(outputJson, options.repoRoot || REPO_ROOT);
  }
  if (options.outputMd) {
    const outputMd = resolvePath(options.outputMd, options.repoRoot || REPO_ROOT);
    mkdirSync(dirname(outputMd), { recursive: true });
    writeFileSync(outputMd, renderLiftMarkdown(result));
    written.markdown = toRepoRelative(outputMd, options.repoRoot || REPO_ROOT);
  }
  return written;
}

export function renderCheckMarkdown(result) {
  const lines = [
    '# Lexicon Freshness Check',
    '',
    `- Validation: **${result.ok ? 'PASS' : 'FAIL'}**`,
    `- Files checked: ${result.files.length}`,
  ];
  if (result.files.length) {
    lines.push('', '| lexicon | provenance | entries | provenance rows |', '|---|---|---:|---:|');
    for (const file of result.files) {
      lines.push(`| \`${file.file}\` | \`${file.provenance}\` | ${file.entries} | ${file.provenanceRows} |`);
    }
  }
  if (result.errors.length) lines.push('', '## Errors', ...result.errors.map((error) => `- ${escapeMarkdown(error)}`));
  if (result.warnings.length) lines.push('', '## Warnings', ...result.warnings.map((warning) => `- ${escapeMarkdown(warning)}`));
  return `${lines.join('\n')}\n`;
}

export function renderLiftMarkdown(result) {
  const lines = [
    '# Lexicon Freshness Lift Report',
    '',
    `- Language: ${result.language}`,
    `- Source: ${result.source_id || 'not recorded'}`,
    `- Validated at: ${result.validated_at || 'not recorded'}`,
    `- Input: ${result.input || 'not recorded'}`,
    `- Entries evaluated: ${result.entries}`,
    `- Decision summary: ${result.kept} keep / ${result.dropped} drop`,
    `- Gate: **${result.gate.ready ? 'PASS' : 'BLOCKED'}** (${result.gate.hot_docs} hot docs, ${result.gate.cold_docs} cold docs)`,
  ];
  if (result.source_note) lines.push(`- Source note: ${escapeMarkdown(result.source_note)}`);
  if (result.source_urls?.length) {
    lines.push('', '## Source provenance', '');
    for (const url of result.source_urls) lines.push(`- <${url}>`);
    lines.push('- Public report policy: aggregate counts only; raw corpus rows stay local/private.');
  }

  lines.push(
    '',
    '## Register coverage',
    '',
    '| class | registers |',
    '|---|---|',
    `| hot | ${formatRegisterCounts(result.gate.hot_registers)} |`,
    `| cold | ${formatRegisterCounts(result.gate.cold_registers)} |`,
    '',
    '## Entry decisions',
    '',
    '| decision | kind | entry | hot docs | cold docs | lift | cold rate |',
    '|---|---|---|---:|---:|---:|---:|'
  );
  for (const row of result.decisions) {
    lines.push(`| ${row.decision} | ${row.kind} | ${escapeMarkdown(row.entry)} | ${row.hot_docs} | ${row.cold_docs} | ${row.lift} | ${(row.cold_rate * 100).toFixed(2)}% |`);
  }
  if (result.errors.length) lines.push('', '## Errors', ...result.errors.map((error) => `- ${escapeMarkdown(error)}`));
  if (result.warnings.length) lines.push('', '## Warnings', ...result.warnings.map((warning) => `- ${escapeMarkdown(warning)}`));
  return `${lines.join('\n')}\n`;
}

function countEntryDocumentFrequency(docs, entries, lang) {
  const counts = new Map(entries.map((entry) => [entryKey(entry), 0]));
  const registers = {};
  for (const doc of docs) {
    const register = doc.register || 'unspecified';
    registers[register] = (registers[register] || 0) + 1;
    const tokens = tokenize(doc.text, { lang });
    for (const entry of entries) {
      const lexicon = {
        lang,
        strict: entry.kind === 'strict' ? [entry.entry] : [],
        phrases: entry.kind === 'phrase' ? [entry.entry] : [],
      };
      if (computeDensity(doc.text, tokens, lexicon).matches > 0) {
        counts.set(entryKey(entry), (counts.get(entryKey(entry)) || 0) + 1);
      }
    }
  }
  return { counts, registers: sortObject(registers) };
}

function loadEntriesForLang(lang, repoRoot = REPO_ROOT) {
  const file = resolve(repoRoot, 'lexicon', `ai-${lang}.md`);
  const parsed = parseFrontmatterFile(file);
  return parseLexiconEntries(parsed.body).all;
}

function formatRegisterCounts(registers = {}) {
  const entries = Object.entries(registers);
  if (!entries.length) return '—';
  return entries.map(([key, value]) => `${escapeMarkdown(key)}=${value}`).join(', ');
}

function sortObject(value) {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

function entryKey(row) {
  return `${row.kind}:${row.entry}`;
}

function entryLabel(row) {
  return row?.entry ? `${row.kind || '?'}:${row.entry}` : 'row';
}

function resolvePath(path, repoRoot = REPO_ROOT) {
  if (path.startsWith('/')) return path;
  return resolve(repoRoot, path);
}

function toRepoRelative(path, repoRoot = REPO_ROOT) {
  return relative(repoRoot, path) || basename(path);
}

function round(value, digits = 3) {
  return Math.round(value * 10 ** digits) / 10 ** digits;
}

function escapeMarkdown(value) {
  return String(value ?? '—').replace(/\|/gu, '\\|').replace(/\n/gu, ' ');
}

function printHelp() {
  console.log(`Usage: node scripts/lexicon-freshness.mjs [--check] [--input <private.jsonl>] [options]

Default mode validates lexicon/ai-*.md entry-provenance sidecars.
When --input is provided, it also computes an EN hot/cold document-frequency
lift report from local JSONL rows. Reports never include raw text.

Options:
  --check                    Validate lexicon provenance sidecars
  --input <path>             Local/private JSONL corpus with text fields
  --lang <lang>              Language to mine (default: en)
  --source-id <id>           Stable source id for the report
  --source-note <text>       Human-readable source note
  --source-url <url>         Source URL for the report (repeatable)
  --validated-at <date>      Validation date (default: today)
  --output-json <path>       Write public-safe aggregate JSON
  --output-md <path>         Write public-safe Markdown report
  --json                     Print JSON instead of Markdown`);
}

function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    return;
  }

  const outputs = {};
  let failed = false;
  if (args.check) {
    const check = checkLexiconProvenance();
    outputs.check = check;
    if (!args.json) console.log(renderCheckMarkdown(check));
    if (!check.ok) failed = true;
  }

  if (args.input) {
    const loaded = loadJsonlRows(args.input);
    const entries = loadEntriesForLang(args.lang);
    const report = loaded.errors.length
      ? { language: args.lang, errors: loaded.errors, warnings: [], decisions: [], gate: { ready: false, hot_docs: 0, cold_docs: 0, hot_registers: {}, cold_registers: {} }, entries: 0, kept: 0, dropped: 0 }
      : mineLexiconLift(loaded.rows, entries, {
          lang: args.lang,
          input: loaded.input,
          sourceId: args.sourceId,
          sourceNote: args.sourceNote,
          sourceUrls: args.sourceUrls,
          validatedAt: args.validatedAt,
        });
    const written = report.errors.length === 0 ? writeLiftReport(report, { outputJson: args.outputJson, outputMd: args.outputMd }) : {};
    outputs.report = report;
    outputs.written = written;
    if (!args.json) {
      console.log(renderLiftMarkdown(report));
      for (const path of Object.values(written)) console.log(`Wrote ${path}`);
    }
    if (report.errors.length) failed = true;
  }

  if (args.json) console.log(JSON.stringify(outputs, null, 2));
  if (failed) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
