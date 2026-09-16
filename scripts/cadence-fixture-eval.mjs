#!/usr/bin/env node
// Promotion measurement for the #879 short-form cadence signal.
//
// MEASUREMENT ONLY, in the same spirit as scripts/detector-candidate-eval.mjs:
// it imports the shipped pure detector, runs it over a checked-in synthetic
// manifest, and prints aggregates. It mutates nothing, calls no LLM, opens no
// network connection, and never writes to src/.
//
// The manifest is the 50-document evaluation fixture required by
// process/pattern-freshness.md before a candidate can be promoted:
//   - 25 hot documents where the signal is expected to fire
//   - 25 cold matched control documents where it must not fire
//   - two registers (social, marketing)
//   - synthetic text authored for this repo, so it is redistributable
//
// Promotion thresholds from that document:
//   new score-only pattern : precision >= 0.70, recall >= 0.40
//   new rewrite pattern    : precision >= 0.80, recall >= 0.50
// Both also require no severe false positives.
//
// Usage: node scripts/cadence-fixture-eval.mjs [--json]

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectEnglishShortFormTells } from '../src/features/short-form.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const MANIFEST = resolve(REPO_ROOT, 'tests/fixtures/cadence/en-cadence-50.jsonl');

export const SCORE_ONLY_FLOOR = Object.freeze({ precision: 0.70, recall: 0.40 });
export const REWRITE_FLOOR = Object.freeze({ precision: 0.80, recall: 0.50 });

function round(n, d = 4) {
  return Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : n;
}

export function loadManifest(path = MANIFEST) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

export function evaluateCadenceFixture(documents) {
  const rows = documents.map((doc) => {
    const result = detectEnglishShortFormTells(doc.text, { lang: 'en', documentType: doc.register });
    return {
      id: doc.id,
      expected: doc.class === 'hot',
      predicted: Boolean(result?.cadence?.detected),
      eligible: Boolean(result?.eligible),
      severity: result?.cadence?.severity ?? 0,
      signals: result?.cadence?.signals ?? [],
      why: doc.why,
      text: doc.text,
    };
  });

  const tp = rows.filter((r) => r.expected && r.predicted);
  const fp = rows.filter((r) => !r.expected && r.predicted);
  const fn = rows.filter((r) => r.expected && !r.predicted);
  const tn = rows.filter((r) => !r.expected && !r.predicted);
  const precision = tp.length + fp.length > 0 ? tp.length / (tp.length + fp.length) : 0;
  const recall = tp.length + fn.length > 0 ? tp.length / (tp.length + fn.length) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  return {
    counts: { total: rows.length, hot: tp.length + fn.length, cold: fp.length + tn.length },
    // An ineligible document is a FIXTURE defect: the detector never even ran on
    // it, so it would silently inflate the cold side.
    ineligible: rows.filter((r) => !r.eligible).map((r) => r.id),
    tp: tp.length,
    fp: fp.length,
    tn: tn.length,
    fn: fn.length,
    precision: round(precision),
    recall: round(recall),
    f1: round(f1),
    gates: {
      scoreOnly: precision >= SCORE_ONLY_FLOOR.precision && recall >= SCORE_ONLY_FLOOR.recall,
      rewrite: precision >= REWRITE_FLOOR.precision && recall >= REWRITE_FLOOR.recall,
    },
    falsePositives: fp.map((r) => ({ id: r.id, signals: r.signals, why: r.why, text: r.text })),
    falseNegatives: fn.map((r) => ({ id: r.id, why: r.why, text: r.text })),
  };
}

function main() {
  const report = evaluateCadenceFixture(loadManifest());
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log('#879 cadence signal — 50-document promotion fixture');
  console.log(`  documents      ${report.counts.total} (${report.counts.hot} hot / ${report.counts.cold} cold)`);
  if (report.ineligible.length > 0) {
    console.log(`  INELIGIBLE     ${report.ineligible.join(', ')}  <- fixture defect, detector never ran`);
  }
  console.log(`  TP ${report.tp}  FP ${report.fp}  TN ${report.tn}  FN ${report.fn}`);
  console.log(`  precision      ${report.precision}`);
  console.log(`  recall         ${report.recall}`);
  console.log(`  f1             ${report.f1}`);
  console.log(`  score-only gate (>=${SCORE_ONLY_FLOOR.precision}/${SCORE_ONLY_FLOOR.recall})  ${report.gates.scoreOnly ? 'PASS' : 'FAIL'}`);
  console.log(`  rewrite gate    (>=${REWRITE_FLOOR.precision}/${REWRITE_FLOOR.recall})  ${report.gates.rewrite ? 'PASS' : 'FAIL'}`);
  if (report.falsePositives.length > 0) {
    console.log('\n  false positives (cold documents the signal fired on):');
    for (const row of report.falsePositives) {
      console.log(`    ${row.id}  [${row.signals.join('+')}]  ${row.text}`);
    }
  }
  if (report.falseNegatives.length > 0) {
    console.log('\n  false negatives (hot documents the signal missed):');
    for (const row of report.falseNegatives) {
      console.log(`    ${row.id}  ${row.text}`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
