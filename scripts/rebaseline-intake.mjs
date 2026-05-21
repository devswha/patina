#!/usr/bin/env node
// Local/private intake helper for the 2025+ rebaseline protocol.
//
// Reads JSONL rows, computes missing sha256 hashes from local text, and writes a
// public manifest that strips full text whenever redistribution is not allowed.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canRedistributeText, hashText, validateRecord } from './rebaseline-summary.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

export const DEFAULT_INTAKE_INPUT = 'artifacts/rebaseline-2025/intake.local.jsonl';
export const DEFAULT_PUBLIC_OUTPUT = 'artifacts/rebaseline-2025/manifest.public.jsonl';
export const DEFAULT_PRIVATE_OUTPUT = 'artifacts/rebaseline-2025/private/generations.private.jsonl';

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    input: DEFAULT_INTAKE_INPUT,
    publicOutput: DEFAULT_PUBLIC_OUTPUT,
    privateOutput: DEFAULT_PRIVATE_OUTPUT,
    dryRun: false,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input') args.input = argv[++i];
    else if (arg === '--public-output') args.publicOutput = argv[++i];
    else if (arg === '--private-output') args.privateOutput = argv[++i];
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

export function loadIntakeRows(inputPath = DEFAULT_INTAKE_INPUT) {
  const abs = resolveRepoPath(inputPath);
  const result = {
    path: abs,
    relativePath: toRepoRelative(abs),
    rows: [],
    errors: [],
  };

  if (!existsSync(abs)) {
    result.errors.push(`intake input not found: ${result.relativePath}`);
    return result;
  }

  const lines = readFileSync(abs, 'utf8').split(/\r?\n/u);
  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const line = lines[index].trim();
    if (!line) continue;

    try {
      result.rows.push({ lineNumber, value: JSON.parse(line) });
    } catch (error) {
      result.errors.push(`line ${lineNumber}: invalid JSON (${error.message})`);
    }
  }

  return result;
}

export function sanitizeIntakeRows(rows) {
  const publicRecords = [];
  const privateRecords = [];
  const errors = [];
  const warnings = [];

  for (const row of rows) {
    const lineNumber = row.lineNumber ?? '?';
    const raw = row.value;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(`line ${lineNumber}: record must be a JSON object`);
      continue;
    }

    const record = { ...raw };
    const label = record.sample_id ? `line ${lineNumber} (${record.sample_id})` : `line ${lineNumber}`;
    const carriesText = typeof record.text === 'string' && record.text.length > 0;

    if (carriesText) {
      const observedHash = hashText(record.text);
      if (record.text_hash && record.text_hash !== observedHash) {
        errors.push(`${label}: text_hash mismatch: expected ${observedHash}`);
      } else {
        record.text_hash = observedHash;
      }
    }

    const publicRecord = { ...record };
    const textAllowed = carriesText && canRedistributeText(record.redistribution);
    if (carriesText && !textAllowed) {
      delete publicRecord.text;
      privateRecords.push(record);
    }
    if (!canRedistributeText(record.redistribution) && !record.source_review && !record.reviewer_notes) {
      warnings.push(`${label}: add source_review or reviewer_notes for non-public redistribution status`);
    }

    const checked = validateRecord(publicRecord);
    errors.push(...checked.errors.map((message) => `${label}: ${message}`));
    warnings.push(...checked.warnings.map((message) => `${label}: ${message}`));

    if (checked.errors.length === 0) publicRecords.push(checked.record);
  }

  return { publicRecords, privateRecords, errors, warnings };
}

export function processIntake(options = {}) {
  const loaded = loadIntakeRows(options.input || DEFAULT_INTAKE_INPUT);
  if (loaded.errors.length) {
    return {
      input: loaded.relativePath,
      publicRecords: [],
      privateRecords: [],
      errors: loaded.errors,
      warnings: [],
    };
  }

  return {
    input: loaded.relativePath,
    ...sanitizeIntakeRows(loaded.rows),
  };
}

export function writeIntakeOutputs(result, options = {}) {
  if (result.errors.length) {
    throw new Error('refusing to write invalid rebaseline intake outputs');
  }

  const publicOutput = options.publicOutput || DEFAULT_PUBLIC_OUTPUT;
  const privateOutput = options.privateOutput || DEFAULT_PRIVATE_OUTPUT;
  const publicPath = resolveRepoPath(publicOutput);
  const privatePath = resolveRepoPath(privateOutput);

  writeJsonl(publicPath, result.publicRecords);
  let privateWritten = null;
  if (result.privateRecords.length > 0) {
    writeJsonl(privatePath, result.privateRecords);
    privateWritten = toRepoRelative(privatePath);
  }

  return {
    publicOutput: toRepoRelative(publicPath),
    privateOutput: privateWritten,
  };
}

export function renderIntakeSummary(result, written = null) {
  const lines = [
    '# Rebaseline Intake Summary',
    '',
    `- Input: \`${result.input || 'not recorded'}\``,
    `- Public rows: ${result.publicRecords.length}`,
    `- Private rows: ${result.privateRecords.length}`,
    `- Validation: **${result.errors.length ? 'FAIL' : 'PASS'}**`,
  ];

  if (written) {
    lines.push(`- Public output: \`${written.publicOutput}\``);
    lines.push(`- Private output: ${written.privateOutput ? `\`${written.privateOutput}\`` : 'not written'}`);
  }

  if (result.errors.length) {
    lines.push('', '## Errors', ...result.errors.map((error) => `- ${escapeMarkdown(error)}`));
  }
  if (result.warnings.length) {
    lines.push('', '## Warnings', ...result.warnings.map((warning) => `- ${escapeMarkdown(warning)}`));
  }

  return `${lines.join('\n')}\n`;
}

function writeJsonl(path, records) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, records.map((record) => JSON.stringify(record)).join('\n') + (records.length ? '\n' : ''));
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
  console.log(`Usage: node scripts/rebaseline-intake.mjs --input <intake.jsonl> [--public-output <manifest.jsonl>] [--private-output <private.jsonl>] [--dry-run] [--json]

Computes missing text_hash values and writes a sanitized public manifest.
Full text is kept in the public manifest only when redistribution is allowed.
Default input: ${DEFAULT_INTAKE_INPUT}`);
}

function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    return;
  }

  const result = processIntake({ input: args.input });
  const written = !args.dryRun && result.errors.length === 0
    ? writeIntakeOutputs(result, { publicOutput: args.publicOutput, privateOutput: args.privateOutput })
    : null;

  if (args.json) {
    console.log(JSON.stringify({ ...result, written }, null, 2));
  } else {
    console.log(renderIntakeSummary(result, written));
  }

  if (result.errors.length) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
