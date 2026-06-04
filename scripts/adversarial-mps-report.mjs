#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzeText } from '../src/features/index.js';
import { loadLexicon } from '../src/features/lexicon.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

export const DEFAULT_INPUT = 'tests/quality/adversarial-mps/fixtures.jsonl';
export const DEFAULT_OUTPUT = 'docs/research/adversarial-mps.md';

export function parseArgs(argv = process.argv.slice(2)) {
  const args = { input: DEFAULT_INPUT, output: DEFAULT_OUTPUT, json: false, check: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--input') args.input = argv[++i];
    else if (arg === '--output') args.output = argv[++i];
    else if (arg === '--json') args.json = true;
    else if (arg === '--check') args.check = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`unknown option ${arg}`);
  }
  return args;
}

export function loadFixtures(path = DEFAULT_INPUT) {
  const fullPath = resolve(repoRoot, path);
  if (!existsSync(fullPath)) throw new Error(`fixture file not found: ${path}`);
  return readFileSync(fullPath, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return normalizeFixture(JSON.parse(line));
      } catch (err) {
        throw new Error(`${path}:${index + 1}: ${err.message}`);
      }
    });
}

function normalizeFixture(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('fixture must be an object');
  for (const key of ['id', 'lang', 'original', 'rewritten']) {
    if (typeof row[key] !== 'string' || row[key].trim() === '') throw new Error(`${key} is required`);
  }
  if (!Array.isArray(row.anchors) || row.anchors.length === 0) throw new Error('anchors must be a non-empty array');
  const anchors = row.anchors.map((anchor) => {
    if (typeof anchor !== 'string' || anchor.trim() === '') throw new Error('anchors must be non-empty strings');
    return anchor.trim();
  });
  return {
    expected_mps_min: 90,
    expected_ai_min: 60,
    ...row,
    anchors,
  };
}

export function evaluateFixtures(fixtures) {
  return fixtures.map((fixture) => {
    const mps = anchorMps(fixture);
    const ai = deterministicAiScore(fixture.rewritten, fixture.lang);
    const pass = mps.mps >= fixture.expected_mps_min && ai.score >= fixture.expected_ai_min;
    return { ...fixture, mps, ai, pass };
  });
}

export function anchorMps({ rewritten, anchors }) {
  const haystack = normalizeText(rewritten);
  const checked = anchors.map((anchor) => ({
    anchor,
    pass: haystack.includes(normalizeText(anchor)),
  }));
  const passCount = checked.filter((item) => item.pass).length;
  const totalCount = checked.length;
  return {
    pass_count: passCount,
    total_count: totalCount,
    mps: totalCount ? round1((passCount / totalCount) * 100) : 0,
    anchors: checked,
  };
}

function deterministicAiScore(text, lang) {
  const result = analyzeText(text, {
    lang,
    repoRoot,
    lexicon: loadLexicon(lang, repoRoot),
  });
  const paragraphs = Array.isArray(result.paragraphs) ? result.paragraphs : [];
  const paragraphCount = paragraphs.length;
  const hotParagraphs = paragraphs.filter((p) => p.hot).length;
  return {
    score: paragraphCount ? round1((hotParagraphs / paragraphCount) * 100) : 0,
    paragraph_count: paragraphCount,
    hot_paragraphs: hotParagraphs,
    lexicon_hits: Array.from(new Set(paragraphs.flatMap((p) => p.lexicon?.hits || []))).sort(),
    ko_diagnostics_hot: paragraphs.filter((p) => p.koDiagnostics?.hot).length,
  };
}

function normalizeText(text) {
  return String(text || '').normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

export function summarize(rows) {
  const total = rows.length;
  const passing = rows.filter((r) => r.pass).length;
  return {
    total,
    passing,
    failing: total - passing,
    min_mps: rows.length ? Math.min(...rows.map((r) => r.mps.mps)) : 0,
    min_ai: rows.length ? Math.min(...rows.map((r) => r.ai.score)) : 0,
  };
}

export function formatMarkdown(rows, { input = DEFAULT_INPUT } = {}) {
  const summary = summarize(rows);
  const lines = [];
  lines.push('# Adversarial MPS audit');
  lines.push('');
  lines.push('This report checks whether a rewrite can preserve explicit meaning anchors while still looking AI-like. It is a repo-owned adversarial fixture set, not a public model-performance claim.');
  lines.push('');
  lines.push(`Fixture source: \`${input}\``);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- Fixtures: ${summary.total}`);
  lines.push(`- Passing adversarial cases: ${summary.passing}/${summary.total}`);
  lines.push(`- Minimum anchor-MPS proxy: ${summary.min_mps.toFixed(1)}`);
  lines.push(`- Minimum deterministic AI score: ${summary.min_ai.toFixed(1)}`);
  lines.push('- Gate: MPS proxy ≥90 and deterministic AI score ≥60.');
  lines.push('');
  lines.push('## Results');
  lines.push('');
  lines.push('| id | lang | register | MPS proxy | AI score | hot paragraphs | status |');
  lines.push('|---|---|---|---:|---:|---:|---|');
  for (const row of rows) {
    lines.push(`| ${cell(row.id)} | ${cell(row.lang)} | ${cell(row.register || '')} | ${row.mps.mps.toFixed(1)} | ${row.ai.score.toFixed(1)} | ${row.ai.hot_paragraphs}/${row.ai.paragraph_count} | ${row.pass ? 'pass' : 'fail'} |`);
  }
  lines.push('');
  lines.push('## Interpretation');
  lines.push('');
  lines.push('The audit confirms the known gap: an anchor-preservation floor can pass text that still retains AI-marker density. MPS should remain a meaning-safety floor, not a humanness score. A complementary anti-gaming check should penalize repeated AI-marker recurrence after rewrite, especially when MPS is high.');
  lines.push('');
  lines.push('## Proposed MPS-v2 companion check');
  lines.push('');
  lines.push('Keep MPS unchanged for semantic safety, then add an independent recurrence gate:');
  lines.push('');
  lines.push('1. Score the original and rewritten text with deterministic `analyzeText`.');
  lines.push('2. If `MPS ≥ 90` and rewritten AI score remains `≥ 60`, mark the candidate as `style_not_improved`.');
  lines.push('3. In Ouroboros selection, prefer candidates that pass MPS and lower the AI score; do not let high MPS alone rescue a visibly AI-like rewrite.');
  lines.push('4. Report preserved anchors and recurring AI markers separately so users can decide whether to edit more or keep the register.');
  return `${lines.join('\n')}\n`;
}

function cell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

export function writeReport(rows, { output = DEFAULT_OUTPUT, input = DEFAULT_INPUT } = {}) {
  const outPath = resolve(repoRoot, output);
  mkdirSync(dirname(outPath), { recursive: true });
  const markdown = formatMarkdown(rows, { input });
  writeFileSync(outPath, markdown);
  return { path: relative(repoRoot, outPath), markdown };
}

function printHelp() {
  console.log(`Usage: node scripts/adversarial-mps-report.mjs [--input <fixtures.jsonl>] [--output <report.md>] [--check] [--json]\n\nValidates hand-built adversarial MPS fixtures: MPS proxy >= 90 and deterministic AI score >= 60.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const args = parseArgs();
    if (args.help) {
      printHelp();
      process.exit(0);
    }
    const rows = evaluateFixtures(loadFixtures(args.input));
    if (args.json) console.log(JSON.stringify({ summary: summarize(rows), rows }, null, 2));
    else {
      const result = writeReport(rows, { input: args.input, output: args.output });
      console.log(`Wrote ${result.path}`);
      console.log(JSON.stringify(summarize(rows)));
    }
    if (args.check && rows.some((row) => !row.pass)) process.exitCode = 1;
  } catch (err) {
    console.error(`adversarial-mps-report: ${err.message}`);
    process.exitCode = 1;
  }
}
