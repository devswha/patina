#!/usr/bin/env node
// Generate private modern-model samples for the 2026 rebaseline protocol.
//
// The output is raw text and MUST stay under artifacts/rebaseline-2025/private/.
// Run the claim-manifest builder afterward to produce public-safe hash-only rows.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

export const DEFAULT_OUTPUT = 'artifacts/rebaseline-2025/private/modern-generations.private.jsonl';
export const DEFAULT_PER_CELL = 100;
export const DEFAULT_BATCH_SIZE = 50;
export const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000;
export const REGISTERS = ['blog', 'academic-summary', 'product-doc', 'chat-update', 'technical-how-to'];

export const MODEL_CONFIGS = {
  'gpt-family': {
    provider: 'codex-cli',
    model: 'gpt-5.5',
    command: 'codex',
  },
  'claude-family': {
    provider: 'claude-cli',
    model: 'claude-sonnet-4-6',
    command: 'claude',
  },
  'gemini-family': {
    provider: 'gemini-cli',
    model: 'gemini-2.5-pro',
    command: 'gemini',
  },
};

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    output: DEFAULT_OUTPUT,
    perCell: DEFAULT_PER_CELL,
    batchSize: DEFAULT_BATCH_SIZE,
    languages: ['ko', 'en'],
    families: ['gpt-family', 'claude-family', 'gemini-family'],
    generatedAt: localDate(),
    timeoutMs: DEFAULT_TIMEOUT_MS,
    resume: true,
    dryRun: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--output') args.output = argv[++i];
    else if (arg === '--per-cell') args.perCell = parsePositiveInt(argv[++i], '--per-cell');
    else if (arg === '--batch-size') args.batchSize = parsePositiveInt(argv[++i], '--batch-size');
    else if (arg === '--languages') args.languages = splitList(argv[++i]);
    else if (arg === '--families') args.families = splitList(argv[++i]);
    else if (arg === '--generated-at') args.generatedAt = argv[++i];
    else if (arg === '--timeout-ms') args.timeoutMs = parsePositiveInt(argv[++i], '--timeout-ms');
    else if (arg === '--no-resume') args.resume = false;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  for (const lang of args.languages) {
    if (!['ko', 'en'].includes(lang)) throw new Error(`Unsupported generation language for #155: ${lang}`);
  }
  for (const family of args.families) {
    if (!MODEL_CONFIGS[family]) throw new Error(`Unsupported generation family: ${family}`);
  }
  return args;
}

export function buildPrompt({ language, family, start, count, generatedAt }) {
  const end = start + count - 1;
  const langName = language === 'ko' ? 'Korean' : 'English';
  const lengthRule = language === 'ko'
    ? '140-230 Korean characters, 2-4 complete sentences'
    : '55-85 English words, 2-4 complete sentences';
  const familyLabel = family.replace('-family', '');
  const rows = Array.from({ length: count }, (_, index) => {
    const n = start + index;
    return {
      id: sampleId(language, family, n),
      register: REGISTERS[(n - 1) % REGISTERS.length],
    };
  });

  return `You are a JSON-only data generator. Generate benchmark text samples in ${langName}.

Purpose: collect ordinary assistant-written text for a deterministic AI-text detector rebaseline. Do not mention benchmarks, detectors, Patina, or this instruction. Do not intentionally humanize, obfuscate, add typos, or imitate a specific person. Write the kind of polished content this ${familyLabel} assistant would normally produce.

Return exactly one syntactically valid JSON array and nothing else. The first character of your answer must be "[" and the last character must be "]". No markdown fences, comments, labels, explanations, or plain-text samples outside JSON. Each item must have exactly these keys: "id", "register", "text".

Rules:
- Generate IDs ${sampleId(language, family, start)} through ${sampleId(language, family, end)}.
- Use the register assigned below for each id.
- Each text is one paragraph only: no headings, bullet lists, tables, quotes, or line breaks inside text.
- Each text length: ${lengthRule}.
- Use varied concrete topics across software, work, study, public services, personal routines, and product documentation.
- Avoid personally identifying information, copyrighted excerpts, URLs, and code blocks.
- Date context for mundane examples: ${generatedAt}.

Assigned rows:
${JSON.stringify(rows, null, 2)}
`;
}

export function parseModelItems(raw, { expectedIds = [] } = {}) {
  const text = extractJsonText(raw);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`model output was not parseable JSON (${error.message})`);
  }
  if (!Array.isArray(parsed)) throw new Error('model output must be a JSON array');

  const expected = new Set(expectedIds);
  const items = [];
  const seen = new Set();
  for (const [index, item] of parsed.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const id = String(item.id || '').trim();
    const register = String(item.register || '').trim();
    const itemText = normalizeGeneratedText(item.text);
    if (!id || !register || !itemText) continue;
    if (expected.size && !expected.has(id)) continue;
    if (!REGISTERS.includes(register)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({ id, register, text: itemText, sourceIndex: index });
  }
  return items;
}

export async function generateModernSamples(options = {}) {
  const outputPath = resolveRepoPath(options.output || DEFAULT_OUTPUT);
  const existing = options.resume !== false ? loadExistingRows(outputPath) : new Map();
  const appended = [];
  const skipped = [];
  const errors = [];
  const tasks = [];

  for (const language of options.languages || ['ko', 'en']) {
    for (const family of options.families || ['gpt-family', 'claude-family', 'gemini-family']) {
      const perCell = options.perCell || DEFAULT_PER_CELL;
      const batchSize = Math.min(options.batchSize || DEFAULT_BATCH_SIZE, perCell);
      for (let start = 1; start <= perCell; start += batchSize) {
        const count = Math.min(batchSize, perCell - start + 1);
        const expectedIds = Array.from({ length: count }, (_, index) => sampleId(language, family, start + index));
        const missingIds = expectedIds.filter((id) => !existing.has(id));
        if (missingIds.length === 0) {
          skipped.push({ language, family, start, count, reason: 'already present' });
          continue;
        }
        tasks.push({ language, family, start, count, expectedIds: missingIds });
      }
    }
  }

  if (options.dryRun) return { output: toRepoRelative(outputPath), tasks, appended, skipped, errors };

  mkdirSync(dirname(outputPath), { recursive: true });
  for (const task of tasks) {
    const config = MODEL_CONFIGS[task.family];
    const prompt = buildPrompt({
      language: task.language,
      family: task.family,
      start: Number(task.expectedIds[0].match(/-(\d{3})$/u)?.[1] || task.start),
      count: task.expectedIds.length,
      generatedAt: options.generatedAt || localDate(),
    });
    try {
      const raw = await invokeModel(config, prompt, { timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS });
      const items = parseModelItems(raw.output, { expectedIds: task.expectedIds });
      if (items.length !== task.expectedIds.length) {
        const got = new Set(items.map((item) => item.id));
        const missing = task.expectedIds.filter((id) => !got.has(id));
        throw new Error(`expected ${task.expectedIds.length} rows, parsed ${items.length}; missing ${missing.join(', ')}`);
      }
      const records = items.map((item) => buildPrivateRecord(item, {
        language: task.language,
        family: task.family,
        config,
        generatedAt: options.generatedAt || localDate(),
        rawMeta: raw.meta,
      }));
      appendJsonl(outputPath, records);
      for (const record of records) {
        existing.set(record.sample_id, record);
        appended.push(record.sample_id);
      }
      console.error(`generated ${records.length} ${task.language}/${task.family} rows (${task.expectedIds[0]}..${task.expectedIds.at(-1)})`);
    } catch (error) {
      errors.push(`${task.language}/${task.family}/${task.start}: ${error.message}`);
      console.error(`ERROR ${task.language}/${task.family}/${task.start}: ${error.message}`);
      break;
    }
  }

  return { output: toRepoRelative(outputPath), tasks, appended, skipped, errors };
}

export function buildPrivateRecord(item, { language, family, config, generatedAt, rawMeta }) {
  return {
    sample_id: item.id,
    language,
    class: 'ai-like',
    register: item.register,
    model_family: family,
    provider: config.provider,
    model: rawMeta?.reportedModel || config.model,
    generated_at: generatedAt,
    prompt_id: `${item.id}-prompt`,
    decoding: {
      surface: config.provider,
      model_requested: config.model,
      temperature: 'provider-default',
      batch_generation: true,
    },
    postprocess: {
      extraction: 'json-array-from-model-output',
      editing_pass: 'none',
      normalized_whitespace: true,
    },
    redistribution: 'hash-only',
    source_review: {
      status: 'generated-private-text-public-hash',
      rationale: 'Locally generated model output is kept in ignored private workspace; public manifest stores hashes and aggregate scores only.',
    },
    reviewer_notes: 'Modern-model #155 rebaseline generation; raw text intentionally not committed.',
    text: item.text,
  };
}

async function invokeModel(config, prompt, options = {}) {
  if (config.provider === 'codex-cli') return invokeCodex(config, prompt, options);
  if (config.provider === 'claude-cli') return invokeClaude(config, prompt, options);
  if (config.provider === 'gemini-cli') return invokeGemini(config, prompt, options);
  throw new Error(`unsupported provider ${config.provider}`);
}

function invokeCodex(config, prompt, { timeoutMs }) {
  const dir = mkdtempSync(resolve(tmpdir(), 'patina-rb-codex-'));
  const outFile = resolve(dir, 'last-message.txt');
  return spawnCapture('codex', [
    'exec',
    '--skip-git-repo-check',
    '--sandbox', 'read-only',
    '-C', dir,
    '-m', config.model,
    '--output-last-message', outFile,
  ], { input: prompt, timeoutMs, cwd: dir })
    .then(({ stdout, stderr }) => {
      const output = existsSync(outFile) ? readFileSync(outFile, 'utf8') : stdout;
      rmSync(dir, { recursive: true, force: true });
      return { output, meta: { reportedModel: parseCodexModel(stderr) || config.model } };
    })
    .catch((error) => {
      rmSync(dir, { recursive: true, force: true });
      throw error;
    });
}

async function invokeClaude(config, prompt, { timeoutMs }) {
  const { stdout } = await spawnCapture('claude', [
    '-p',
    '--model', config.model,
    '--output-format', 'json',
    '--system-prompt', 'You are a JSON-only data generator. Return exactly the JSON value requested by the user, with no prose, markdown, or commentary.',
  ], { input: prompt, timeoutMs, cwd: REPO_ROOT });
  const payload = parseJsonObject(stdout, 'claude JSON output');
  return {
    output: payload.result || stdout,
    meta: { reportedModel: firstKey(payload.modelUsage) || config.model, usage: payload.usage || null },
  };
}

async function invokeGemini(config, prompt, { timeoutMs }) {
  const { stdout } = await spawnCapture('gemini', [
    '-p', prompt,
    '--output-format', 'json',
    '--skip-trust',
    '-m', config.model,
  ], { input: '', timeoutMs, cwd: REPO_ROOT });
  const payload = parseJsonObject(stripGeminiNoise(stdout), 'gemini JSON output');
  return {
    output: payload.response || stdout,
    meta: { reportedModel: firstKey(payload.stats?.models) || config.model, usage: payload.stats || null },
  };
}

function spawnCapture(command, args, { input = '', timeoutMs = DEFAULT_TIMEOUT_MS, cwd = REPO_ROOT } = {}) {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    proc.stdout.on('data', (chunk) => { stdout += chunk; });
    proc.stderr.on('data', (chunk) => { stderr += chunk; });
    proc.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`${command} exited with code ${code}: ${stderr.slice(0, 2000)}`));
      } else {
        resolvePromise({ stdout, stderr });
      }
    });
    proc.stdin.end(input);
  });
}

function extractJsonText(raw) {
  const trimmed = String(raw || '').trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '').trim();
  }
  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function parseJsonObject(raw, label) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${label} was not parseable (${error.message})`);
  }
}

function normalizeGeneratedText(value) {
  return String(value || '')
    .replace(/[\r\n]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function sampleId(language, family, n) {
  return `rb26-${language}-${family.replace('-family', '')}-${String(n).padStart(3, '0')}`;
}

function loadExistingRows(path) {
  const rows = new Map();
  if (!existsSync(path)) return rows;
  const lines = readFileSync(path, 'utf8').split(/\r?\n/u);
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.sample_id) rows.set(row.sample_id, row);
    } catch {}
  }
  return rows;
}

function appendJsonl(path, records) {
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
  writeFileSync(path, prefix + records.map((record) => JSON.stringify(record)).join('\n') + '\n', { flag: 'a' });
}

function stripGeminiNoise(text) {
  const lines = String(text || '').split(/\r?\n/u);
  const noiseRe = /^(Warning:|Ripgrep is not available|MCP issues detected|Loaded cached credentials)/iu;
  let i = 0;
  while (i < lines.length && (noiseRe.test(lines[i]) || lines[i].trim() === '')) i++;
  return lines.slice(i).join('\n');
}

function parseCodexModel(stderr) {
  const match = String(stderr || '').match(/^model:\s*(.+)$/mu);
  return match?.[1]?.trim() || null;
}

function firstKey(value) {
  if (!value || typeof value !== 'object') return null;
  return Object.keys(value)[0] || null;
}

function splitList(value) {
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
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
  console.log(`Usage: node scripts/rebaseline-generate-modern.mjs [--output <private.jsonl>] [--per-cell 100] [--batch-size 50]

Generates private raw-text samples for #155 using logged-in codex, claude, and gemini CLIs.
Default output: ${DEFAULT_OUTPUT}

The output contains raw model text and is intended to stay gitignored under artifacts/rebaseline-2025/private/.`);
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    return;
  }
  const result = await generateModernSamples(args);
  console.log(JSON.stringify({
    output: result.output,
    tasks: result.tasks.length,
    appended: result.appended.length,
    skipped: result.skipped.length,
    errors: result.errors,
  }, null, 2));
  if (result.errors.length) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exit(1);
  });
}
