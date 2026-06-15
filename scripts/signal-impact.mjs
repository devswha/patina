#!/usr/bin/env node
// Per-signal impact / ablation harness for the deterministic hot decision.
//
// Answers the calibration question this repo keeps asking by hand: "what does
// hot signal X buy us, and at what false-positive cost?" For a labeled manifest
// (expected_hot) joined to its text, it runs analyzeText() once per row, then
// recomputes the document hot verdict with each signal ablated to report each
// signal's MARGINAL contribution (rows it alone makes hot) plus the confusion
// matrix with/without it.
//
// Deterministic and gitignore-safe: it needs local text (private rebaseline rows
// stay local) but only ever emits aggregate metrics, never the text itself.
//
// Usage:
//   node scripts/signal-impact.mjs [--manifest <jsonl>] [--lang ko]
//        [--text <jsonl|glob> ...] [--ablate <signal>] [--json]
//
// Defaults to the KO rebaseline manifest + the standard private text sources.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzeText } from '../src/features/index.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARTIFACTS = 'artifacts/rebaseline-2025';

// Paragraph-level hot disjuncts, mirrored from src/features/index.js#analyzeText.
// Keep this list in sync when a paragraph signal is added/removed.
export const PARAGRAPH_SIGNALS = [
  ['burstiness_low', (p) => p.burstiness?.band === 'low'],
  ['mattr_low', (p) => p.mattr?.band === 'low'],
  ['lexicon_hot', (p) => Boolean(p.lexicon?.hot)],
  ['ko_diagnostics', (p) => Boolean(p.koDiagnostics?.hot)],
  ['candor', (p) => Boolean(p.candorHot)],
  ['thematic_break', (p) => Boolean(p.thematicBreakHot)],
  ['ko_ending_monotony', (p) => Boolean(p.endingMonotonyHot)],
];

// Document-level hot disjuncts.
export const DOCUMENT_SIGNALS = [
  ['markup_leakage', (a) => Boolean(a.markupLeakage?.leaked)],
  ['structural_model', (a) => a.structuralClassifier?.hot === true],
];

export const ALL_SIGNALS = [
  ...DOCUMENT_SIGNALS.map(([name]) => name),
  ...PARAGRAPH_SIGNALS.map(([name]) => name),
];

// Recompute the document hot verdict from an analysis, optionally excluding a
// set of signal names. Mirrors the OR rule in analyzeText so ablation is exact.
export function recomputeHot(analysis, excluded = new Set()) {
  for (const [name, test] of DOCUMENT_SIGNALS) {
    if (!excluded.has(name) && test(analysis)) return true;
  }
  return (analysis.paragraphs ?? []).some((paragraph) =>
    PARAGRAPH_SIGNALS.some(([name, test]) => !excluded.has(name) && test(paragraph)),
  );
}

function confusionFrom(predictions) {
  let TP = 0;
  let FP = 0;
  let FN = 0;
  let TN = 0;
  for (const { expected, predicted } of predictions) {
    if (expected && predicted) TP += 1;
    else if (!expected && predicted) FP += 1;
    else if (expected && !predicted) FN += 1;
    else TN += 1;
  }
  const n = TP + FP + FN + TN;
  const pct = (x) => Math.round(x * 1000) / 10;
  const prec = TP + FP > 0 ? TP / (TP + FP) : 0;
  const rec = TP + FN > 0 ? TP / (TP + FN) : 0;
  return {
    n,
    accuracy: pct(n ? (TP + TN) / n : 0),
    precision: pct(prec),
    recall: pct(rec),
    f1: Math.round((prec + rec > 0 ? (2 * prec * rec) / (prec + rec) : 0) * 1000) / 1000,
    fpr: pct(FP + TN > 0 ? FP / (FP + TN) : 0),
    TP,
    FP,
    FN,
    TN,
  };
}

// Core: given manifest rows (with expected_hot) and a sample_id -> text map,
// return the baseline confusion, per-signal ablation, and catch-by-family.
export function signalImpact({ rows, textById, lang }) {
  const analyzed = [];
  for (const row of rows) {
    const text = textById[row.sample_id];
    if (typeof text !== 'string' || !text.trim()) continue;
    const analysis = analyzeText(text, { lang: lang ?? row.language ?? 'en' });
    analyzed.push({ row, analysis, expected: Boolean(row.expected_hot) });
  }

  const predAll = analyzed.map((a) => ({ expected: a.expected, predicted: recomputeHot(a.analysis) }));
  const baseline = confusionFrom(predAll);

  const ablation = ALL_SIGNALS.map((signal) => {
    const excluded = new Set([signal]);
    const without = confusionFrom(
      analyzed.map((a) => ({ expected: a.expected, predicted: recomputeHot(a.analysis, excluded) })),
    );
    // Rows this signal alone keeps hot (no other signal fires): its marginal set.
    let attributableTP = 0;
    let attributableFP = 0;
    for (const a of analyzed) {
      const withSig = recomputeHot(a.analysis);
      const withoutSig = recomputeHot(a.analysis, excluded);
      if (withSig && !withoutSig) {
        if (a.expected) attributableTP += 1;
        else attributableFP += 1;
      }
    }
    return {
      signal,
      attributableTP,
      attributableFP,
      recallWithout: without.recall,
      fprWithout: without.fpr,
      f1Without: without.f1,
      deltaRecall: Math.round((baseline.recall - without.recall) * 10) / 10,
      deltaFpr: Math.round((baseline.fpr - without.fpr) * 10) / 10,
      deltaF1: Math.round((baseline.f1 - without.f1) * 1000) / 1000,
    };
  }).filter((entry) => entry.attributableTP > 0 || entry.attributableFP > 0 || entry.deltaRecall !== 0);

  const families = {};
  for (const a of analyzed) {
    const ai = a.expected;
    if (!ai) continue;
    const fam = a.row.model_family ?? 'unspecified';
    families[fam] ??= { n: 0, caught: 0 };
    families[fam].n += 1;
    if (recomputeHot(a.analysis)) families[fam].caught += 1;
  }
  const catchByFamily = Object.entries(families)
    .map(([family, v]) => ({ family, n: v.n, catch: Math.round((v.caught / v.n) * 1000) / 10 }))
    .sort((x, y) => x.family.localeCompare(y.family));

  return { lang, matched: analyzed.length, total: rows.length, baseline, ablation, catchByFamily };
}

function loadJsonl(path) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// Build a sample_id -> text index from the standard private/local rebaseline
// sources (first occurrence wins), plus any explicit --text paths.
function buildTextIndex(extraPaths) {
  const textById = {};
  const candidates = [];
  const root = resolve(REPO_ROOT, ARTIFACTS);
  if (existsSync(root)) {
    for (const f of readdirSync(root)) {
      if (f.endsWith('.local.jsonl') || (f.endsWith('.jsonl') && f.includes('intake'))) candidates.push(join(root, f));
    }
    const priv = join(root, 'private');
    if (existsSync(priv)) {
      for (const f of readdirSync(priv)) if (f.endsWith('.jsonl')) candidates.push(join(priv, f));
    }
  }
  for (const p of [...candidates, ...extraPaths.map((p) => resolve(REPO_ROOT, p))]) {
    if (!existsSync(p)) continue;
    for (const row of loadJsonl(p)) {
      if (row.sample_id && typeof row.text === 'string' && !(row.sample_id in textById)) {
        textById[row.sample_id] = row.text;
      }
    }
  }
  return textById;
}

function parseArgs(argv) {
  const opts = { manifest: `${ARTIFACTS}/manifest.ko.scored.public.jsonl`, lang: null, text: [], json: false, ablate: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') opts.json = true;
    else if (arg === '--manifest') opts.manifest = argv[++i];
    else if (arg === '--lang') opts.lang = argv[++i];
    else if (arg === '--ablate') opts.ablate = argv[++i];
    else if (arg === '--text') opts.text.push(argv[++i]);
  }
  return opts;
}

function renderMarkdown(report, opts) {
  const b = report.baseline;
  const lines = [
    `# Signal impact — ${opts.manifest}`,
    '',
    `- lang: ${report.lang ?? '(per-row)'}`,
    `- rows: ${report.total} | text-matched: ${report.matched}`,
    '',
    '## Baseline (all signals)',
    '',
    '| accuracy | precision | recall | f1 | fpr | TP/FP/FN/TN |',
    '|---:|---:|---:|---:|---:|---|',
    `| ${b.accuracy}% | ${b.precision}% | ${b.recall}% | ${b.f1} | ${b.fpr}% | ${b.TP}/${b.FP}/${b.FN}/${b.TN} |`,
    '',
    '## Per-signal ablation',
    '',
    'attributable = rows this signal alone keeps hot (no other signal fires).',
    '',
    '| signal | attrib TP | attrib FP | ΔrecallPP | ΔfprPP | ΔF1 |',
    '|---|---:|---:|---:|---:|---:|',
    ...report.ablation.map(
      (e) => `| ${e.signal} | ${e.attributableTP} | ${e.attributableFP} | ${e.deltaRecall} | ${e.deltaFpr} | ${e.deltaF1} |`,
    ),
    '',
    '## Catch by model family (AI rows)',
    '',
    '| family | n | catch |',
    '|---|---:|---:|',
    ...report.catchByFamily.map((c) => `| ${c.family} | ${c.n} | ${c.catch}% |`),
    '',
  ];
  return lines.join('\n');
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const manifestPath = resolve(REPO_ROOT, opts.manifest);
  if (!existsSync(manifestPath)) {
    console.error(`manifest not found: ${opts.manifest}`);
    process.exit(2);
  }
  const rows = loadJsonl(manifestPath);
  const textById = buildTextIndex(opts.text);
  const report = signalImpact({ rows, textById, lang: opts.lang });
  if (report.matched === 0) {
    console.error(
      'No local text matched the manifest. This harness needs the private/local rebaseline corpus ' +
        '(artifacts/rebaseline-2025/{*.local.jsonl,private/*.jsonl}) or explicit --text sources.',
    );
    process.exit(1);
  }
  if (opts.ablate) {
    const entry = report.ablation.find((e) => e.signal === opts.ablate) ?? { signal: opts.ablate, attributableTP: 0, attributableFP: 0, deltaRecall: 0, deltaFpr: 0, deltaF1: 0 };
    console.log(opts.json ? JSON.stringify(entry, null, 2) : JSON.stringify(entry));
    return;
  }
  console.log(opts.json ? JSON.stringify(report, null, 2) : renderMarkdown(report, opts));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
