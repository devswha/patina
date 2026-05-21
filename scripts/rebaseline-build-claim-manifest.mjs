#!/usr/bin/env node
// Build a public-safe scored #155 manifest from private modern-model samples
// plus reviewed human-control rows. Raw text never leaves private inputs.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { hashText, loadManifest, summarizeManifest } from './rebaseline-summary.mjs';
import { scoreRows } from './rebaseline-score.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

export const DEFAULT_GENERATED = 'artifacts/rebaseline-2025/private/modern-generations.private.jsonl';
export const DEFAULT_KO_CONTROLS = 'artifacts/rebaseline-2025/human-controls.public.jsonl';
export const DEFAULT_HAPE = 'artifacts/rebaseline-2025/private/hape-en.private.jsonl';
export const DEFAULT_OUTPUT = 'artifacts/rebaseline-2025/rebaseline-2026.scored.public.jsonl';
export const DEFAULT_KO_CONTROL_TOTAL = 100;
export const DEFAULT_EN_CONTROL_TOTAL = 100;

const HAPE_REGISTER_MAP = {
  acad: 'academic-summary',
  blog: 'blog',
};

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    generated: DEFAULT_GENERATED,
    koControls: DEFAULT_KO_CONTROLS,
    hape: DEFAULT_HAPE,
    output: DEFAULT_OUTPUT,
    scoredAt: localDate(),
    koControlTotal: DEFAULT_KO_CONTROL_TOTAL,
    enControlTotal: DEFAULT_EN_CONTROL_TOTAL,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--generated') args.generated = argv[++i];
    else if (arg === '--ko-controls') args.koControls = argv[++i];
    else if (arg === '--hape') args.hape = argv[++i];
    else if (arg === '--output') args.output = argv[++i];
    else if (arg === '--scored-at') args.scoredAt = argv[++i];
    else if (arg === '--ko-control-total') args.koControlTotal = parsePositiveInt(argv[++i], '--ko-control-total');
    else if (arg === '--en-control-total') args.enControlTotal = parsePositiveInt(argv[++i], '--en-control-total');
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

export function buildClaimManifest(options = {}) {
  const generatedRows = loadJsonl(options.generated || DEFAULT_GENERATED, { requireText: true });
  const generatedScored = scorePrivateRows(generatedRows, { scoredAt: options.scoredAt || localDate() });

  const koControls = selectKoControls(options.koControls || DEFAULT_KO_CONTROLS, options.koControlTotal || DEFAULT_KO_CONTROL_TOTAL);
  const enControlPrivateRows = selectHapeEnglishControls(options.hape || DEFAULT_HAPE, options.enControlTotal || DEFAULT_EN_CONTROL_TOTAL);
  const enControlScored = scorePrivateRows(enControlPrivateRows, { scoredAt: options.scoredAt || localDate() });

  const records = [...generatedScored.publicRecords, ...koControls, ...enControlScored.publicRecords]
    .sort((a, b) => String(a.sample_id).localeCompare(String(b.sample_id)));
  const errors = [...generatedScored.errors, ...enControlScored.errors];
  const warnings = [...generatedScored.warnings, ...enControlScored.warnings];
  const duplicateIds = findDuplicateIds(records);
  if (duplicateIds.length) errors.push(`duplicate sample_id(s): ${duplicateIds.join(', ')}`);

  return {
    records,
    errors,
    warnings,
    counts: {
      generated: generatedScored.publicRecords.length,
      koControls: koControls.length,
      enControls: enControlScored.publicRecords.length,
    },
  };
}

export function writeClaimManifest(result, output = DEFAULT_OUTPUT) {
  if (result.errors.length) throw new Error(`refusing to write invalid claim manifest: ${result.errors.join('; ')}`);
  const outputPath = resolveRepoPath(output);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, result.records.map((record) => JSON.stringify(record)).join('\n') + '\n');
  return { output: toRepoRelative(outputPath) };
}

export function selectKoControls(path = DEFAULT_KO_CONTROLS, total = DEFAULT_KO_CONTROL_TOTAL) {
  const manifest = loadManifest(path);
  if (manifest.errors.length) throw new Error(`invalid KO control manifest: ${manifest.errors.join('; ')}`);
  const controls = manifest.records.filter((record) => record.language === 'ko' && record.class === 'natural-human');
  return balancedTake(controls, total, (record) => record.register);
}

export function selectHapeEnglishControls(path = DEFAULT_HAPE, total = DEFAULT_EN_CONTROL_TOTAL) {
  const rows = loadJsonl(path, { requireText: true })
    .filter((row) => row.language === 'en' && row.class === 'natural-human' && HAPE_REGISTER_MAP[row.register]);
  const selected = balancedTake(rows, total, (row) => row.register);
  return selected.map((row, index) => {
    const canonicalRegister = HAPE_REGISTER_MAP[row.register];
    const ordinal = String(index + 1).padStart(3, '0');
    return {
      sample_id: `rb26-en-human-hape-${ordinal}`,
      language: 'en',
      class: 'natural-human',
      register: canonicalRegister,
      model_family: 'human-reference',
      provider: 'human-ai-parallel-corpus',
      model: 'human-chunk-2',
      generated_at: normalizeDate(row.generated_at) || '2024-01-01',
      prompt_id: `hape-${row.prompt_id || row.sample_id || ordinal}`,
      decoding: 'not-applicable',
      postprocess: {
        editing_pass: 'none',
        extraction: 'HAP-E human chunk_2',
        source_register: row.register,
      },
      redistribution: 'hash-only',
      source_review: {
        status: 'external-mit-hash-only',
        rationale: 'HAP-E is MIT-licensed, but this manifest keeps text hash-only for consistency with the #155 public benchmark surface.',
        license_basis: 'MIT dataset card/repository; raw text remains in ignored private workspace.',
      },
      reviewer_notes: 'English human-control sample from HAP-E paired corpus; raw text intentionally not committed.',
      source_dataset: 'browndw/human-ai-parallel-corpus',
      source_url: 'https://huggingface.co/datasets/browndw/human-ai-parallel-corpus',
      text: row.text,
      text_hash: row.text_hash || hashText(row.text),
    };
  });
}

function scorePrivateRows(rows, { scoredAt }) {
  return scoreRows(
    rows.map((value, index) => ({ lineNumber: index + 1, value })),
    { scoredAt, repoRoot: REPO_ROOT }
  );
}

function loadJsonl(path, { requireText = false } = {}) {
  const abs = resolveRepoPath(path);
  if (!existsSync(abs)) throw new Error(`JSONL input not found: ${toRepoRelative(abs)}`);
  const rows = [];
  const lines = readFileSync(abs, 'utf8').split(/\r?\n/u);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    let row;
    try {
      row = JSON.parse(line);
    } catch (error) {
      throw new Error(`${toRepoRelative(abs)}:${index + 1}: invalid JSON (${error.message})`);
    }
    if (requireText && (typeof row.text !== 'string' || row.text.trim() === '')) {
      throw new Error(`${toRepoRelative(abs)}:${index + 1}: row requires private text`);
    }
    rows.push(row);
  }
  return rows;
}

function balancedTake(rows, total, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row) || 'unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const keys = [...groups.keys()].sort();
  const selected = [];
  let cursor = 0;
  while (selected.length < total && keys.length) {
    const key = keys[cursor % keys.length];
    const group = groups.get(key);
    if (group.length) selected.push(group.shift());
    if (!group.length) {
      groups.delete(key);
      keys.splice(keys.indexOf(key), 1);
      if (!keys.length) break;
      cursor %= keys.length;
    } else {
      cursor++;
    }
  }
  if (selected.length < total) throw new Error(`needed ${total} rows but selected ${selected.length}`);
  return selected;
}

function findDuplicateIds(records) {
  const seen = new Set();
  const dupes = new Set();
  for (const record of records) {
    if (seen.has(record.sample_id)) dupes.add(record.sample_id);
    seen.add(record.sample_id);
  }
  return [...dupes].sort();
}

function normalizeDate(value) {
  if (!value) return null;
  const text = String(value);
  if (/^\d{4}$/u.test(text)) return `${text}-01-01`;
  if (/^\d{4}-\d{2}-\d{2}$/u.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function parsePositiveInt(value, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${label} must be a positive integer`);
  return n;
}

function localDate() {
  const now = new Date();
  const offsetMs = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offsetMs).toISOString().slice(0, 10);
}

function resolveRepoPath(path) {
  return resolve(REPO_ROOT, path);
}

function toRepoRelative(path) {
  return relative(REPO_ROOT, path) || path;
}

function printHelp() {
  console.log(`Usage: node scripts/rebaseline-build-claim-manifest.mjs [--generated <private.jsonl>] [--output <public.jsonl>]

Builds the public-safe #155 manifest from private modern-model generations,
Korean public-web human controls, and private HAP-E English human controls.
Default output: ${DEFAULT_OUTPUT}`);
}

function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    return;
  }
  const result = buildClaimManifest(args);
  const written = result.errors.length ? null : writeClaimManifest(result, args.output);
  const manifest = written ? loadManifest(written.output) : { records: [], errors: [] };
  const summary = written ? summarizeManifest(manifest.records, { input: written.output }) : null;
  const payload = {
    written,
    counts: result.counts,
    errors: [...result.errors, ...(manifest.errors || [])],
    warnings: result.warnings,
    claimReady: summary?.claimGate?.ready ?? false,
    claimBlockers: summary?.claimGate?.blockers ?? [],
  };
  if (args.json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(`# Rebaseline Claim Manifest\n`);
    console.log(`- Output: ${written ? `\`${written.output}\`` : 'not written'}`);
    console.log(`- Records: ${result.records.length}`);
    console.log(`- Generated rows: ${result.counts.generated}`);
    console.log(`- KO controls: ${result.counts.koControls}`);
    console.log(`- EN controls: ${result.counts.enControls}`);
    console.log(`- Claim ready: ${payload.claimReady ? 'yes' : 'no'}`);
    if (payload.claimBlockers.length) console.log(`- Blockers: ${payload.claimBlockers.join('; ')}`);
    if (payload.errors.length) console.log(`- Errors: ${payload.errors.join('; ')}`);
    if (payload.warnings.length) console.log(`- Warnings: ${payload.warnings.join('; ')}`);
  }
  if (payload.errors.length) process.exit(1);
  if (!payload.claimReady) process.exit(2);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
