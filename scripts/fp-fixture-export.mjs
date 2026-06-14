#!/usr/bin/env node
// Export accepted false-positive intake rows as suspect-zones natural fixtures.
//
// Last hop of the false-positive feedback loop: structured issue → intake JSONL
// → benchmark fixture. Only rows that are both natural-human and explicitly
// redistributable become fixtures; private text never crosses this wall.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { DEFAULT_INTAKE_INPUT, loadIntakeRows } from './rebaseline-intake.mjs';
import { MATRIX, canRedistributeText, canonicalizeClass, hashText } from './rebaseline-summary.mjs';
import { parseFixture } from './update-benchmark-ranges.mjs';
import { resolveSliceFields } from '../tests/quality/slice-metadata.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

export const DEFAULT_OUT_DIR = 'tests/fixtures/suspect-zones';
const SLUG_MAX_CHARS = 40;

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    input: DEFAULT_INTAKE_INPUT,
    outDir: DEFAULT_OUT_DIR,
    dryRun: false,
    json: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input') args.input = takeValue(argv, ++i, arg);
    else if (arg === '--out-dir') args.outDir = takeValue(argv, ++i, arg);
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

// A trailing flag without a value must fail loudly: a malformed --out-dir would
// otherwise fall back to the default and write into the real benchmark corpus.
function takeValue(argv, index, flag) {
  const value = argv[index];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

export function selectFixtureRows(rows) {
  const selected = [];
  const refused = [];
  const errors = [];

  for (const row of rows) {
    const lineNumber = row.lineNumber ?? '?';
    const raw = row.value;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(`line ${lineNumber}: record must be a JSON object`);
      continue;
    }

    const record = { ...raw, class: canonicalizeClass(raw.class) };
    const label = record.sample_id ? `line ${lineNumber} (${record.sample_id})` : `line ${lineNumber}`;

    if (record.class !== 'natural-human') {
      refused.push(`${label}: class=${record.class || '<missing>'} does not become a public fixture; only natural-human rows are exported, accepted lightly-edited reports stay manifest-only`);
      continue;
    }
    if (!canRedistributeText(record.redistribution)) {
      refused.push(`${label}: redistribution=${record.redistribution || '<missing>'} blocks a public fixture; keep the text in the private intake output`);
      continue;
    }

    if (typeof record.language === 'string') record.language = record.language.trim().toLowerCase();
    const rowErrors = [];
    if (!MATRIX.languages.includes(record.language)) {
      rowErrors.push(`language must be one of ${MATRIX.languages.join(', ')}`);
    }
    if (typeof record.text !== 'string' || record.text.trim().length === 0) {
      rowErrors.push('missing text; a public fixture needs the reproducing paragraph');
    } else if (record.text_hash && record.text_hash !== hashText(record.text)) {
      rowErrors.push(`text_hash mismatch: expected ${hashText(record.text)}`);
    }
    if (!record.source_doc) rowErrors.push('missing source_doc (GitHub issue URL)');
    if (!record.reviewer_notes) rowErrors.push('missing reviewer_notes explaining why the score is too high');

    if (rowErrors.length) errors.push(...rowErrors.map((message) => `${label}: ${message}`));
    else selected.push(record);
  }

  return { selected, refused, errors };
}

export function nextFixtureNumber(naturalDir, lang) {
  if (!existsSync(naturalDir)) return 1;
  const numberRe = new RegExp(`^${lang}-nat-(\\d+)`, 'u');
  let max = 0;
  for (const file of readdirSync(naturalDir)) {
    const match = file.match(numberRe);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

export function fixtureSlug(record) {
  if (record.fixture_slug) return slugify(record.fixture_slug) || 'fp-report';
  const issue = String(record.source_doc ?? '').match(/\/issues\/(\d+)/u);
  if (issue) return `fp-issue-${issue[1]}`;
  const sampleSlug = slugify(record.sample_id);
  return sampleSlug ? `fp-${sampleSlug}` : 'fp-report';
}

function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .slice(0, SLUG_MAX_CHARS)
    .replace(/^-+|-+$/gu, '');
}

export function buildFixtureFile(record, fixtureId) {
  // B2 slice metadata (Wave 0.2): retain register/domain when present and
  // always record the mapper-resolved generator/edited so exported fixtures
  // populate B2 slices instead of collapsing to `unspecified`. model_family /
  // edit_depth are kept as provenance aliases when present.
  const slice = resolveSliceFields(record);
  const meta = {
    fixture_id: fixtureId,
    language: record.language,
    class: 'natural',
    expected_hot: false,
  };
  if (record.register) meta.register = record.register;
  if (record.domain) meta.domain = record.domain;
  meta.generator = slice.generator;
  meta.edited = slice.edited;
  if (record.model_family) meta.model_family = record.model_family;
  if (record.edit_depth) meta.edit_depth = record.edit_depth;
  meta.why_designed_this_way = [
    'Accepted false-positive report promoted to a natural control fixture.',
    `Source: ${record.source_doc}`,
    `Reviewer notes: ${String(record.reviewer_notes).trim()}`,
  ].join('\n');
  meta.topic = fixtureTopic(record);
  return `---\n${yaml.dump(meta, { lineWidth: -1 })}---\n\n${record.text.trim()}\n`;
}

function fixtureTopic(record) {
  // record.register is a corpus register ("blog"), not a topic; never pass it through as one.
  const topic = record.topic
    ? String(record.topic)
    : `false-positive report${record.register ? ` (register: ${record.register})` : ''}`;
  return topic.replace(/\s*\n\s*/gu, ' ');
}

// Index existing fixtures through the same parse path the ranges refresh uses,
// so re-running the exporter against a cumulative intake file stays idempotent.
export function indexExistingFixtures(naturalDir) {
  const byBodyHash = new Map();
  const bySourceDoc = new Map();
  if (!existsSync(naturalDir)) return { byBodyHash, bySourceDoc };
  for (const file of readdirSync(naturalDir)) {
    if (!file.endsWith('.md')) continue;
    const path = join(naturalDir, file);
    let parsed;
    try {
      parsed = parseFixture(path);
    } catch {
      continue; // not a frontmatter fixture; nothing to dedupe against
    }
    const relativePath = toRepoRelative(path);
    byBodyHash.set(hashText(parsed.body), relativePath);
    const source = String(parsed.meta?.why_designed_this_way ?? '').match(/^Source:\s*(.+?)\s*$/mu);
    if (source) bySourceDoc.set(source[1], relativePath);
  }
  return { byBodyHash, bySourceDoc };
}

export function planFixtureExports(selected, options = {}) {
  const outDir = resolveRepoPath(options.outDir || DEFAULT_OUT_DIR);
  const counters = {};
  const existing = {};
  const files = [];
  const alreadyExported = [];
  for (const record of selected) {
    const lang = record.language;
    const naturalDir = join(outDir, lang, 'natural');
    if (existing[lang] === undefined) existing[lang] = indexExistingFixtures(naturalDir);

    const label = record.sample_id || fixtureSlug(record);
    const bodyHash = hashText(record.text.trim());
    const bodyMatch = existing[lang].byBodyHash.get(bodyHash);
    const sourceMatch = existing[lang].bySourceDoc.get(String(record.source_doc).trim());
    if (bodyMatch || sourceMatch) {
      alreadyExported.push(bodyMatch
        ? `${label}: body text already exported as \`${bodyMatch}\``
        : `${label}: source_doc already exported as \`${sourceMatch}\``);
      continue;
    }

    if (counters[lang] === undefined) counters[lang] = nextFixtureNumber(naturalDir, lang);
    const number = String(counters[lang]++).padStart(2, '0');
    const fixtureId = `${lang}-nat-${number}-${fixtureSlug(record)}`;
    const path = join(naturalDir, `${fixtureId}.md`);
    const relativePath = toRepoRelative(path);
    files.push({
      record,
      fixtureId,
      path,
      relativePath,
      content: buildFixtureFile(record, fixtureId),
    });
    // Identical bodies repeated within one intake file must not duplicate either.
    // source_doc is intentionally not added here: one issue may carry several
    // distinct paragraphs in a single run.
    existing[lang].byBodyHash.set(bodyHash, relativePath);
  }
  return { files, alreadyExported };
}

export function writeFixtureFiles(files) {
  const written = [];
  for (const file of files) {
    // Licensing wall: even a crafted plan must not publish private text.
    if (!canRedistributeText(file.record?.redistribution)) {
      throw new Error(`refusing to write non-redistributable text as a fixture: ${file.fixtureId}`);
    }
    if (existsSync(file.path)) {
      throw new Error(`refusing to overwrite existing fixture: ${file.relativePath}`);
    }
    mkdirSync(dirname(file.path), { recursive: true });
    writeFileSync(file.path, file.content);
    written.push(file.relativePath);
  }
  return written;
}

export function runFixtureExport(options = {}) {
  const loaded = loadIntakeRows(options.input || DEFAULT_INTAKE_INPUT);
  if (loaded.errors.length) {
    return { input: loaded.relativePath, selected: [], refused: [], alreadyExported: [], errors: loaded.errors, files: [], written: [] };
  }

  const { selected, refused, errors } = selectFixtureRows(loaded.rows);
  const planned = errors.length ? { files: [], alreadyExported: [] } : planFixtureExports(selected, options);
  const written = errors.length || options.dryRun ? [] : writeFixtureFiles(planned.files);
  return { input: loaded.relativePath, selected, refused, alreadyExported: planned.alreadyExported, errors, files: planned.files, written };
}

export function renderExportSummary(result, options = {}) {
  const lines = [
    '# False-Positive Fixture Export',
    '',
    `- Input: \`${result.input || 'not recorded'}\``,
    `- Selected rows: ${result.selected.length}`,
    `- Already exported rows: ${result.alreadyExported.length}`,
    `- Refused rows: ${result.refused.length}`,
    `- Validation: **${result.errors.length ? 'FAIL' : 'PASS'}**`,
  ];
  if (options.dryRun) lines.push('- Mode: dry run (no files written)');

  if (result.files.length) {
    lines.push('', '## Fixtures', ...result.files.map((file) => `- ${options.dryRun ? 'would write' : 'wrote'} \`${file.relativePath}\``));
  }
  if (result.alreadyExported.length) {
    lines.push('', '## Already exported', ...result.alreadyExported.map((reason) => `- ${escapeMarkdown(reason)}`));
  }
  if (result.refused.length) {
    lines.push('', '## Refused', ...result.refused.map((reason) => `- ${escapeMarkdown(reason)}`));
  }
  if (result.errors.length) {
    lines.push('', '## Errors', ...result.errors.map((error) => `- ${escapeMarkdown(error)}`));
  }
  if (result.files.length && !result.errors.length) {
    lines.push('', 'Next: run `npm run benchmark:ranges` and review the expected-ranges.json diff before committing.');
  }

  return `${lines.join('\n')}\n`;
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
  console.log(`Usage: node scripts/fp-fixture-export.mjs [--input <intake.jsonl>] [--out-dir <fixtures-dir>] [--dry-run] [--json]

Promotes accepted false-positive intake rows (class natural-human, public
redistribution) into ${DEFAULT_OUT_DIR}/{lang}/natural/ fixtures, numbering
after the highest existing fixture per language. Rows that are private or
no-redistribution are refused; rows whose body text or source issue already
matches an existing fixture are skipped as already exported, so re-running
against a cumulative intake file is safe. After a real run, regenerate the
benchmark baseline with \`npm run benchmark:ranges\` and review the diff.
Default input: ${DEFAULT_INTAKE_INPUT}`);
}

function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    return;
  }

  const result = runFixtureExport(args);
  if (args.json) {
    const files = result.files.map(({ fixtureId, relativePath }) => ({ fixtureId, relativePath }));
    console.log(JSON.stringify({ ...result, files }, null, 2));
  } else {
    console.log(renderExportSummary(result, { dryRun: args.dryRun }));
  }

  if (result.errors.length) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
