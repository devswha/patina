#!/usr/bin/env node
// Rebaseline manifest checker for the 2025+ corpus protocol.
//
// This script validates metadata-only JSONL manifests, reports matrix coverage,
// and keeps public performance claims blocked until corpus size + outcome fields
// meet the process gate in process/pattern-freshness.md.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

export const SCHEMA_VERSION = 1;
export const DEFAULT_INPUT = 'artifacts/rebaseline-2025/rebaseline-2026.scored.public.jsonl';
export const DEFAULT_REPORT_DIR = 'docs/benchmarks';
export const DEFAULT_REPORT_BASENAME = 'rebaseline-latest';

export const MATRIX = {
  languages: ['ko', 'en', 'zh', 'ja'],
  classes: ['ai-like', 'natural-human', 'lightly-edited-ai', 'heavily-edited-ai'],
  registers: ['blog', 'academic-summary', 'product-doc', 'chat-update', 'technical-how-to'],
  generatorFamilies: ['gpt-family', 'claude-family', 'gemini-family', 'open-weight'],
};

export const TARGETS = {
  protocolPerLanguageClassRegister: 25,
  claimPerCell: 100,
  claimLanguages: 2,
  claimGeneratorFamilies: 3,
};

const REQUIRED_FIELDS = [
  'sample_id',
  'language',
  'class',
  'register',
  'model_family',
  'provider',
  'model',
  'generated_at',
  'prompt_id',
  'decoding',
  'postprocess',
  'redistribution',
  'text_hash',
];

const CLASS_ALIASES = new Map([
  ['ai', 'ai-like'],
  ['ai_like', 'ai-like'],
  ['ai-like', 'ai-like'],
  ['generated', 'ai-like'],
  ['human', 'natural-human'],
  ['natural', 'natural-human'],
  ['natural/human', 'natural-human'],
  ['natural-human', 'natural-human'],
  ['lightly edited ai', 'lightly-edited-ai'],
  ['lightly-edited-ai', 'lightly-edited-ai'],
  ['lightly_edited_ai', 'lightly-edited-ai'],
  ['heavily edited ai', 'heavily-edited-ai'],
  ['heavily-edited-ai', 'heavily-edited-ai'],
  ['heavily_edited_ai', 'heavily-edited-ai'],
]);

const REGISTER_ALIASES = new Map([
  ['blog', 'blog'],
  ['academic summary', 'academic-summary'],
  ['academic-summary', 'academic-summary'],
  ['product doc', 'product-doc'],
  ['product-doc', 'product-doc'],
  ['chat update', 'chat-update'],
  ['chat/update', 'chat-update'],
  ['chat-update', 'chat-update'],
  ['technical how-to', 'technical-how-to'],
  ['technical howto', 'technical-how-to'],
  ['technical-how-to', 'technical-how-to'],
]);

const MODEL_FAMILY_ALIASES = new Map([
  ['gpt', 'gpt-family'],
  ['gpt-family', 'gpt-family'],
  ['openai', 'gpt-family'],
  ['claude', 'claude-family'],
  ['claude-family', 'claude-family'],
  ['anthropic', 'claude-family'],
  ['gemini', 'gemini-family'],
  ['gemini-family', 'gemini-family'],
  ['google', 'gemini-family'],
  ['open weight', 'open-weight'],
  ['open-weight', 'open-weight'],
  ['open_weight', 'open-weight'],
  ['human', 'human-reference'],
  ['human-reference', 'human-reference'],
]);

const TEXT_ALLOWED_REDIS = new Set(['repo-ok', 'redistributable', 'public', 'public-domain', 'cc0', 'cc-by']);
const TEXT_BLOCKED_REDIS = new Set(['metadata-only', 'private', 'no-redistribution', 'hash-only']);
const POSITIVE_CLASSES = new Set(['ai-like', 'lightly-edited-ai', 'heavily-edited-ai']);
const SHA256_RE = /^sha256:[0-9a-f]{64}$/u;

export function canRedistributeText(redistribution) {
  return TEXT_ALLOWED_REDIS.has(normalizeToken(redistribution));
}

export function blocksRedistributableText(redistribution) {
  const normalized = normalizeToken(redistribution);
  return TEXT_BLOCKED_REDIS.has(normalized) || !TEXT_ALLOWED_REDIS.has(normalized);
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {
    input: DEFAULT_INPUT,
    json: false,
    write: false,
    outputDir: DEFAULT_REPORT_DIR,
    basename: DEFAULT_REPORT_BASENAME,
    requireClaimReady: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input') args.input = argv[++i];
    else if (arg === '--json') args.json = true;
    else if (arg === '--write') args.write = true;
    else if (arg === '--output-dir') args.outputDir = argv[++i];
    else if (arg === '--basename') args.basename = argv[++i];
    else if (arg === '--require-claim-ready') args.requireClaimReady = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

export function hashText(text) {
  return `sha256:${createHash('sha256').update(String(text)).digest('hex')}`;
}

export function loadManifest(inputPath = DEFAULT_INPUT) {
  const abs = resolve(REPO_ROOT, inputPath);
  const rel = relative(REPO_ROOT, abs) || inputPath;
  const result = {
    schemaVersion: SCHEMA_VERSION,
    path: abs,
    relativePath: rel,
    records: [],
    errors: [],
    warnings: [],
  };

  if (!existsSync(abs)) {
    result.errors.push(`manifest not found: ${rel}`);
    return result;
  }

  const seen = new Set();
  const lines = readFileSync(abs, 'utf8').split(/\r?\n/u);
  for (let index = 0; index < lines.length; index++) {
    const lineNumber = index + 1;
    const line = lines[index].trim();
    if (!line) continue;

    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      result.errors.push(`line ${lineNumber}: invalid JSON (${error.message})`);
      continue;
    }

    const checked = validateRecord(parsed);
    for (const warning of checked.warnings) result.warnings.push(`line ${lineNumber}: ${warning}`);
    for (const error of checked.errors) result.errors.push(`line ${lineNumber}: ${error}`);

    let duplicate = false;
    if (checked.record.sample_id) {
      if (seen.has(checked.record.sample_id)) {
        result.errors.push(`line ${lineNumber}: duplicate sample_id ${checked.record.sample_id}`);
        duplicate = true;
      }
      seen.add(checked.record.sample_id);
    }

    if (checked.errors.length === 0 && !duplicate) result.records.push(checked.record);
  }

  return result;
}

export function validateRecord(input) {
  const errors = [];
  const warnings = [];
  const isObject = input && typeof input === 'object' && !Array.isArray(input);
  const record = isObject ? { ...input } : {};

  if (!isObject) {
    errors.push('record must be a JSON object');
    return { record, errors, warnings };
  }

  for (const field of REQUIRED_FIELDS) {
    if (record[field] === undefined || record[field] === null || record[field] === '') {
      errors.push(`missing required field: ${field}`);
    }
  }

  record.language = normalizeToken(record.language);
  if (record.language && !MATRIX.languages.includes(record.language)) {
    errors.push(`language must be one of ${MATRIX.languages.join(', ')}`);
  }

  record.class = canonicalize(record.class, CLASS_ALIASES);
  if (record.class && !MATRIX.classes.includes(record.class)) {
    errors.push(`class must be one of ${MATRIX.classes.join(', ')}`);
  }

  record.register = canonicalize(record.register, REGISTER_ALIASES);
  if (record.register && !MATRIX.registers.includes(record.register)) {
    errors.push(`register must be one of ${MATRIX.registers.join(', ')}`);
  }

  record.model_family = canonicalize(record.model_family, MODEL_FAMILY_ALIASES);
  if (record.model_family && !MATRIX.generatorFamilies.includes(record.model_family) && record.model_family !== 'human-reference') {
    warnings.push(`unrecognized model_family ${record.model_family}; it will not count toward the public claim gate`);
  }

  record.redistribution = normalizeToken(record.redistribution);
  if (record.redistribution && !TEXT_ALLOWED_REDIS.has(record.redistribution) && !TEXT_BLOCKED_REDIS.has(record.redistribution)) {
    warnings.push(`unrecognized redistribution ${record.redistribution}; text is treated as non-redistributable`);
  }

  if (typeof record.sample_id === 'string') record.sample_id = record.sample_id.trim();
  if (typeof record.provider === 'string') record.provider = record.provider.trim();
  if (typeof record.model === 'string') record.model = record.model.trim();
  if (typeof record.prompt_id === 'string') record.prompt_id = record.prompt_id.trim();

  if (record.generated_at && Number.isNaN(Date.parse(record.generated_at))) {
    errors.push('generated_at must be an ISO-like date or timestamp');
  }

  if (record.text_hash && !SHA256_RE.test(record.text_hash)) {
    errors.push('text_hash must use sha256:<64 lowercase hex>');
  }

  if (hasText(record)) {
    if (!TEXT_ALLOWED_REDIS.has(record.redistribution)) {
      errors.push(`text is not allowed when redistribution=${record.redistribution || '<missing>'}`);
    }
    const observed = hashText(record.text);
    if (record.text_hash && observed !== record.text_hash) {
      errors.push(`text_hash mismatch: expected ${observed}`);
    }
  }

  if (typeof record.patina_score === 'number' && (record.patina_score < 0 || record.patina_score > 100)) {
    errors.push('patina_score must be between 0 and 100');
  }

  if (record.expected_hot !== undefined && typeof record.expected_hot !== 'boolean') {
    errors.push('expected_hot must be boolean when present');
  }
  if (record.predicted_hot !== undefined && typeof record.predicted_hot !== 'boolean') {
    errors.push('predicted_hot must be boolean when present');
  }
  if ((record.expected_hot === undefined) !== (record.predicted_hot === undefined)) {
    warnings.push('expected_hot and predicted_hot should be recorded together for scored reports');
  }

  if (!isMetadataValue(record.decoding)) errors.push('decoding must be a non-empty object or string');
  if (!isMetadataValue(record.postprocess)) errors.push('postprocess must be a non-empty object or string');

  return { record, errors, warnings };
}

export function summarizeManifest(records, options = {}) {
  const byLanguage = countBy(records, (record) => record.language);
  const byClass = countBy(records, (record) => record.class);
  const byRegister = countBy(records, (record) => record.register);
  const byModelFamily = countBy(records, (record) => record.model_family);
  const protocolCells = countBy(records, (record) => protocolCellKey(record));
  const positiveClaimCells = countBy(
    records.filter((record) => POSITIVE_CLASSES.has(record.class) && MATRIX.generatorFamilies.includes(record.model_family)),
    (record) => `${record.language}|${record.model_family}`
  );
  const naturalClaimCells = countBy(
    records.filter((record) => record.class === 'natural-human'),
    (record) => record.language
  );
  const outcomeRecords = records.filter(
    (record) => typeof record.expected_hot === 'boolean' && typeof record.predicted_hot === 'boolean'
  );

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    input: options.input || null,
    targets: TARGETS,
    totalRecords: records.length,
    byLanguage,
    byClass,
    byRegister,
    byModelFamily,
    protocolCoverage: summarizeProtocolCoverage(protocolCells),
    claimGate: evaluateClaimGate({ records, positiveClaimCells, naturalClaimCells, outcomeRecords }),
    metrics: summarizeOutcomes(outcomeRecords),
    catchByLanguageFamily: summarizeCatchByLanguageFamily(outcomeRecords),
    falsePositiveByLanguage: summarizeFalsePositiveByLanguage(outcomeRecords),
    metricsByRegister: summarizeOutcomesBy(outcomeRecords, (record) => record.register),
  };
}

export function renderMarkdownReport(summary, validation = {}) {
  const validationLines = [];
  if (validation.errors?.length) {
    validationLines.push('Validation: **FAIL**');
    validationLines.push(...validation.errors.map((error) => `- ${escapeMarkdown(error)}`));
  } else {
    validationLines.push('Validation: **PASS**');
  }
  if (validation.warnings?.length) {
    validationLines.push('', 'Warnings:');
    validationLines.push(...validation.warnings.map((warning) => `- ${escapeMarkdown(warning)}`));
  }

  const claim = summary.claimGate;
  const metrics = summary.metrics;

  const markdown = `# Rebaseline Manifest Summary

- Generated at: ${summary.generatedAt}
- Input: ${summary.input ? `\`${escapeMarkdown(summary.input)}\`` : 'not recorded'}
- Records: ${summary.totalRecords}
- Protocol target: ${summary.targets.protocolPerLanguageClassRegister} samples per language × class × register cell
- Public claim target: ${summary.targets.claimPerCell} samples per claim cell, ${summary.targets.claimLanguages}+ languages, ${summary.targets.claimGeneratorFamilies}+ generator families

## Validation

${validationLines.join('\n')}

## Coverage snapshot

### By language

${renderCountTable(summary.byLanguage, MATRIX.languages)}

### By class

${renderCountTable(summary.byClass, MATRIX.classes)}

### By register

${renderCountTable(summary.byRegister, MATRIX.registers)}

### By model family

${renderCountTable(summary.byModelFamily, [...MATRIX.generatorFamilies, 'human-reference'])}

## Protocol matrix

- Populated language × class × register cells: ${summary.protocolCoverage.populatedCells}/${summary.protocolCoverage.totalCells}
- Cells meeting ${summary.targets.protocolPerLanguageClassRegister}+ samples: ${summary.protocolCoverage.cellsMeetingTarget}
- Empty cells: ${summary.protocolCoverage.emptyCells}
- Underfilled populated cells: ${summary.protocolCoverage.underfilledCells.length}

${renderUnderfilled(summary.protocolCoverage.underfilledCells, 12)}

## Public performance claim gate

Public performance claim: **${claim.ready ? 'READY' : 'BLOCKED'}**

${claim.blockers.length ? renderBlockerTable(claim.blockers) : 'Gate conditions met by this manifest.'}

${renderClaimGateStats(claim, metrics, summary.targets)}

## Outcome metrics

${metrics.total ? renderMetrics(metrics) : 'No complete `expected_hot` + `predicted_hot` outcome rows yet. This manifest is corpus metadata, not a benchmark claim.'}

${metrics.total ? `### Catch rate by language × model family\n\n${renderCatchByLanguageFamily(summary.catchByLanguageFamily)}\n\n### False-positive rate by language\n\n${renderFalsePositiveByLanguage(summary.falsePositiveByLanguage)}\n\n### By register\n\n${renderMetricsByRegister(summary.metricsByRegister)}` : ''}
`;
  return `${markdown.trimEnd()}\n`;
}

export function writeReportFiles(summary, validation = {}, options = {}) {
  const outputDir = options.outputDir || DEFAULT_REPORT_DIR;
  const basename = options.basename || DEFAULT_REPORT_BASENAME;
  if (!/^[a-z0-9._-]+$/iu.test(basename)) {
    throw new Error(`Invalid report basename: ${basename}`);
  }

  const absDir = resolve(REPO_ROOT, outputDir);
  mkdirSync(absDir, { recursive: true });

  const markdown = renderMarkdownReport(summary, validation);
  const payload = {
    ...summary,
    validation: {
      errors: validation.errors || [],
      warnings: validation.warnings || [],
    },
  };
  const markdownPath = resolve(absDir, `${basename}.md`);
  const jsonPath = resolve(absDir, `${basename}.json`);
  writeFileSync(markdownPath, markdown);
  writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);

  return {
    markdownPath,
    jsonPath,
    relativeMarkdownPath: relative(REPO_ROOT, markdownPath),
    relativeJsonPath: relative(REPO_ROOT, jsonPath),
  };
}

function summarizeProtocolCoverage(protocolCells) {
  const expectedKeys = [];
  for (const language of MATRIX.languages) {
    for (const cls of MATRIX.classes) {
      for (const register of MATRIX.registers) {
        expectedKeys.push(`${language}|${cls}|${register}`);
      }
    }
  }

  const underfilledCells = [];
  let cellsMeetingTarget = 0;
  let emptyCells = 0;
  for (const key of expectedKeys) {
    const count = protocolCells[key] || 0;
    if (count === 0) emptyCells++;
    else if (count >= TARGETS.protocolPerLanguageClassRegister) cellsMeetingTarget++;
    else underfilledCells.push({ key, count });
  }

  return {
    totalCells: expectedKeys.length,
    populatedCells: expectedKeys.length - emptyCells,
    emptyCells,
    cellsMeetingTarget,
    underfilledCells,
  };
}

function evaluateClaimGate({ records, positiveClaimCells, naturalClaimCells, outcomeRecords }) {
  const qualifiedPositiveCells = Object.entries(positiveClaimCells)
    .filter(([, count]) => count >= TARGETS.claimPerCell)
    .map(([key, count]) => ({ key, count }));
  const qualifiedNaturalCells = Object.entries(naturalClaimCells)
    .filter(([, count]) => count >= TARGETS.claimPerCell)
    .map(([key, count]) => ({ key, count }));
  const positiveLanguages = new Set(qualifiedPositiveCells.map(({ key }) => key.split('|')[0]));
  const positiveFamilies = new Set(qualifiedPositiveCells.map(({ key }) => key.split('|')[1]));
  const naturalLanguages = new Set(qualifiedNaturalCells.map(({ key }) => key));
  const outcomeComplete = records.length > 0 && outcomeRecords.length === records.length;
  const blockers = [];

  if (positiveLanguages.size < TARGETS.claimLanguages) {
    blockers.push(
      `positive corpus has ${positiveLanguages.size}/${TARGETS.claimLanguages} languages with n≥${TARGETS.claimPerCell}`
    );
  }
  if (positiveFamilies.size < TARGETS.claimGeneratorFamilies) {
    blockers.push(
      `positive corpus has ${positiveFamilies.size}/${TARGETS.claimGeneratorFamilies} generator families with n≥${TARGETS.claimPerCell}`
    );
  }
  if (naturalLanguages.size < TARGETS.claimLanguages) {
    blockers.push(
      `natural/human corpus has ${naturalLanguages.size}/${TARGETS.claimLanguages} languages with n≥${TARGETS.claimPerCell}`
    );
  }
  if (!outcomeComplete) {
    blockers.push('expected_hot and predicted_hot outcome rows are incomplete; run a scored report before README claims');
  }
  if (records.length === 0) blockers.push('manifest has no records');

  return {
    ready: blockers.length === 0,
    blockers,
    qualifiedPositiveCells,
    qualifiedNaturalCells,
  };
}

function summarizeOutcomes(records) {
  const metrics = { tp: 0, fp: 0, fn: 0, tn: 0, total: records.length };
  for (const record of records) {
    if (record.predicted_hot && record.expected_hot) metrics.tp++;
    else if (record.predicted_hot && !record.expected_hot) metrics.fp++;
    else if (!record.predicted_hot && record.expected_hot) metrics.fn++;
    else metrics.tn++;
  }

  const accuracy = metrics.total ? (metrics.tp + metrics.tn) / metrics.total : 0;
  const precision = metrics.tp + metrics.fp ? metrics.tp / (metrics.tp + metrics.fp) : 0;
  const recall = metrics.tp + metrics.fn ? metrics.tp / (metrics.tp + metrics.fn) : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  const falsePositiveRate = metrics.fp + metrics.tn ? metrics.fp / (metrics.fp + metrics.tn) : 0;
  const falseNegativeRate = metrics.fn + metrics.tp ? metrics.fn / (metrics.fn + metrics.tp) : 0;
  const positiveTotal = metrics.tp + metrics.fn;
  const naturalTotal = metrics.fp + metrics.tn;
  return {
    ...metrics,
    accuracy: round(accuracy),
    precision: round(precision),
    recall: round(recall),
    f1: round(f1),
    falsePositiveRate: round(falsePositiveRate),
    falseNegativeRate: round(falseNegativeRate),
    accuracyCi: wilsonInterval(metrics.tp + metrics.tn, metrics.total),
    recallCi: wilsonInterval(metrics.tp, positiveTotal),
    falsePositiveRateCi: wilsonInterval(metrics.fp, naturalTotal),
  };
}

function summarizeOutcomesBy(records, keyFn) {
  const groups = {};
  for (const record of records) {
    const key = keyFn(record) || 'unknown';
    if (!groups[key]) groups[key] = [];
    groups[key].push(record);
  }

  return Object.fromEntries(
    Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, group]) => [key, summarizeOutcomes(group)])
  );
}

function summarizeCatchByLanguageFamily(records) {
  const positive = records.filter((record) => POSITIVE_CLASSES.has(record.class));
  const grouped = groupBy(positive, (record) => `${record.language}|${record.model_family}`);
  return Object.fromEntries(
    Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, group]) => {
        const caught = group.filter((record) => record.predicted_hot).length;
        return [key, {
          language: key.split('|')[0],
          modelFamily: key.split('|')[1],
          n: group.length,
          caught,
          missed: group.length - caught,
          catchRate: round(caught / group.length),
          catchRateCi: wilsonInterval(caught, group.length),
        }];
      })
  );
}

function summarizeFalsePositiveByLanguage(records) {
  const natural = records.filter((record) => record.class === 'natural-human');
  const grouped = groupBy(natural, (record) => record.language);
  return Object.fromEntries(
    Object.entries(grouped)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([language, group]) => {
        const falsePositives = group.filter((record) => record.predicted_hot).length;
        return [language, {
          language,
          n: group.length,
          falsePositives,
          trueNegatives: group.length - falsePositives,
          falsePositiveRate: round(falsePositives / group.length),
          falsePositiveRateCi: wilsonInterval(falsePositives, group.length),
        }];
      })
  );
}

function wilsonInterval(successes, n, z = 1.959963984540054) {
  if (!n) return { low: 0, high: 0, method: 'Wilson score interval, 95%' };
  const phat = successes / n;
  const denom = 1 + (z ** 2) / n;
  const center = (phat + (z ** 2) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((phat * (1 - phat) + (z ** 2) / (4 * n)) / n)) / denom;
  return {
    low: round(Math.max(0, center - margin)),
    high: round(Math.min(1, center + margin)),
    method: 'Wilson score interval, 95%',
  };
}

function countBy(records, fn) {
  const out = {};
  for (const record of records) {
    const key = fn(record);
    if (!key) continue;
    out[key] = (out[key] || 0) + 1;
  }
  return out;
}

function groupBy(records, fn) {
  const out = {};
  for (const record of records) {
    const key = fn(record);
    if (!key) continue;
    if (!out[key]) out[key] = [];
    out[key].push(record);
  }
  return out;
}

function protocolCellKey(record) {
  return `${record.language}|${record.class}|${record.register}`;
}

function normalizeToken(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : value;
}

function canonicalize(value, aliases) {
  const normalized = normalizeToken(value);
  if (typeof normalized !== 'string') return normalized;
  return aliases.get(normalized) || normalized;
}

function hasText(record) {
  return typeof record.text === 'string' && record.text.length > 0;
}

function isMetadataValue(value) {
  if (typeof value === 'string') return value.trim().length > 0;
  if (value && typeof value === 'object' && !Array.isArray(value)) return Object.keys(value).length > 0;
  return false;
}

function renderCountTable(counts, preferredOrder) {
  const keys = [...new Set([...preferredOrder, ...Object.keys(counts).sort()])];
  const rows = keys.map((key) => `| ${escapeMarkdown(key)} | ${counts[key] || 0} |`);
  return ['| value | n |', '|---|---:|', ...rows].join('\n');
}

function renderUnderfilled(cells, limit) {
  if (cells.length === 0) return 'No underfilled populated protocol cells.';
  const rows = cells
    .slice(0, limit)
    .map(({ key, count }) => `| ${escapeMarkdown(key.replaceAll('|', ' × '))} | ${count} |`);
  const suffix = cells.length > limit ? `\n\n_${cells.length - limit} more underfilled cells omitted._` : '';
  return ['| cell | n |', '|---|---:|', ...rows].join('\n') + suffix;
}

function renderBlockerTable(blockers) {
  return [
    '| blocker |',
    '|---|',
    ...blockers.map((item) => `| ${escapeMarkdown(item)} |`),
  ].join('\n');
}

function renderClaimGateStats(claim, metrics, targets) {
  return [
    '| claim-gate count | value |',
    '|---|---:|',
    `| qualified positive cells (language × generator family, n≥${targets.claimPerCell}) | ${claim.qualifiedPositiveCells.length} |`,
    `| qualified natural-language cells (language, n≥${targets.claimPerCell}) | ${claim.qualifiedNaturalCells.length} |`,
    `| outcome rows with expected/predicted labels | ${metrics.total} |`,
  ].join('\n');
}

function renderMetrics(metrics) {
  return [
    '| metric | value |',
    '|---|---:|',
    `| accuracy | ${pct(metrics.accuracy)} |`,
    `| accuracy CI | ${pct(metrics.accuracyCi.low)}–${pct(metrics.accuracyCi.high)} |`,
    `| precision | ${pct(metrics.precision)} |`,
    `| recall | ${pct(metrics.recall)} |`,
    `| recall CI | ${pct(metrics.recallCi.low)}–${pct(metrics.recallCi.high)} |`,
    `| F1 | ${metrics.f1.toFixed(3)} |`,
    `| false positive rate | ${pct(metrics.falsePositiveRate)} |`,
    `| false positive rate CI | ${pct(metrics.falsePositiveRateCi.low)}–${pct(metrics.falsePositiveRateCi.high)} |`,
    `| false negative rate | ${pct(metrics.falseNegativeRate)} |`,
    `| TP/FP/FN/TN | ${metrics.tp}/${metrics.fp}/${metrics.fn}/${metrics.tn} |`,
  ].join('\n');
}

function renderMetricsByRegister(metricsByRegister = {}) {
  const keys = [...new Set([...MATRIX.registers, ...Object.keys(metricsByRegister).sort()])];
  const rows = keys
    .filter((key) => metricsByRegister[key])
    .map((key) => {
      const metrics = metricsByRegister[key];
      return `| ${escapeMarkdown(key)} | ${metrics.total} | ${pct(metrics.falsePositiveRate)} | ${pct(metrics.falseNegativeRate)} | ${metrics.tp}/${metrics.fp}/${metrics.fn}/${metrics.tn} |`;
    });
  if (!rows.length) return 'No register-level outcome rows yet.';
  return [
    '| register | n | FP rate | FN rate | TP/FP/FN/TN |',
    '|---|---:|---:|---:|---:|',
    ...rows,
  ].join('\n');
}

function renderCatchByLanguageFamily(cells = {}) {
  const rows = Object.values(cells)
    .sort((a, b) => `${a.language}|${a.modelFamily}`.localeCompare(`${b.language}|${b.modelFamily}`))
    .map((cell) => `| ${escapeMarkdown(cell.language)} | ${escapeMarkdown(cell.modelFamily)} | ${cell.n} | ${pct(cell.catchRate)} | ${pct(cell.catchRateCi.low)}–${pct(cell.catchRateCi.high)} | ${cell.caught}/${cell.missed} |`);
  if (!rows.length) return 'No positive outcome rows yet.';
  return [
    '| language | model family | n | catch rate | 95% CI | caught/missed |',
    '|---|---|---:|---:|---:|---:|',
    ...rows,
  ].join('\n');
}

function renderFalsePositiveByLanguage(cells = {}) {
  const rows = Object.values(cells)
    .sort((a, b) => a.language.localeCompare(b.language))
    .map((cell) => `| ${escapeMarkdown(cell.language)} | ${cell.n} | ${pct(cell.falsePositiveRate)} | ${pct(cell.falsePositiveRateCi.low)}–${pct(cell.falsePositiveRateCi.high)} | ${cell.falsePositives}/${cell.trueNegatives} |`);
  if (!rows.length) return 'No natural-human outcome rows yet.';
  return [
    '| language | n | false-positive rate | 95% CI | FP/TN |',
    '|---|---:|---:|---:|---:|',
    ...rows,
  ].join('\n');
}

function pct(value) {
  return `${((value || 0) * 100).toFixed(1)}%`;
}

function round(n, digits = 3) {
  return Math.round(n * 10 ** digits) / 10 ** digits;
}

function escapeMarkdown(value) {
  return String(value ?? '—').replace(/\|/gu, '\\|').replace(/\n/gu, ' ');
}

function printHelp() {
  console.log(`Usage: node scripts/rebaseline-summary.mjs [--input <manifest.jsonl>] [--json] [--write] [--require-claim-ready]

Validates a 2025+ rebaseline JSONL manifest and prints coverage/claim-gate status.
Use --write to refresh ${DEFAULT_REPORT_DIR}/${DEFAULT_REPORT_BASENAME}.{md,json}.
Default input: ${DEFAULT_INPUT}`);
}

function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    return;
  }

  const manifest = loadManifest(args.input);
  const summary = summarizeManifest(manifest.records, { input: manifest.relativePath });
  const validation = { errors: manifest.errors, warnings: manifest.warnings };
  const written = args.write
    ? writeReportFiles(summary, validation, { outputDir: args.outputDir, basename: args.basename })
    : null;

  if (args.json) {
    console.log(JSON.stringify({ ...summary, validation, written }, null, 2));
  } else {
    console.log(renderMarkdownReport(summary, validation));
    if (written) {
      console.log(`Wrote ${written.relativeMarkdownPath}`);
      console.log(`Wrote ${written.relativeJsonPath}`);
    }
  }

  if (manifest.errors.length) process.exit(1);
  if (args.requireClaimReady && !summary.claimGate.ready) process.exit(2);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
