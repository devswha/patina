#!/usr/bin/env node
// Phase B: attributable detector-signal evaluation.
//
// Evaluates CANDIDATE structural/density hot signals against pre-registered
// denominators WITHOUT wiring them into the analyzer. For each candidate it
// reports, per slice, the current detector's TP/FN and the *attributable* effect
// of adding the candidate as a new hot disjunct:
//   attributable_TP = positives the current detector MISSES (FN) that the
//                     candidate would newly flag hot.
//   attributable_FP = negatives the current detector currently passes (TN) that
//                     the candidate would newly flag hot (new false positives).
//
// Promotion rule (matches the approved plan): a candidate may be promoted to a
// real hot disjunct ONLY if, across the evaluated denominators,
//   attributable_TP > attributable_FP, AND
//   it introduces 0 new benchmark-natural false positives (no benchmark
//   misclassification regression), AND
//   it does not increase the human-controls FP count above baseline.
// Candidates are structural/band/density based and never hardcode corpus terms.
//
// This is MEASUREMENT ONLY: it imports analyzeText to read the current verdict
// and applies candidate PURE FUNCTIONS out-of-tree. It mutates nothing in
// src/features and calls no LLM. Output is hash/id/aggregate only.
//
// Usage: node scripts/detector-candidate-eval.mjs [--json] [--no-timestamp]

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeText } from '../src/features/index.js';
import { splitProseSentences } from '../src/features/segment.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const CORPUS_DIR = process.env.PATINA_CORPUS_DIR
  ? resolve(process.env.PATINA_CORPUS_DIR)
  : resolve(REPO_ROOT, 'artifacts/persona-calibration-2026');
const FIXTURES_ROOT = resolve(REPO_ROOT, 'tests/fixtures/suspect-zones');

function round(n, d = 4) {
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : n;
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

// ----- Candidate signals (pure, structural/density, no corpus terms) -----

// Count tricolon / rule-of-three coordinations like "a, b, and c" / "a, b, c".
function ruleOfThreeCount(text) {
  let count = 0;
  for (const s of splitProseSentences(text)) {
    // x, y, and z  /  x, y and z  /  x、y、z (CJK enumerations)
    if (/\b[\w'’-]+,\s+[\w'’-]+,?\s+(?:and|or)\s+[\w'’-]+/i.test(s)) count += 1;
    if (/[^\s、]+、[^\s、]+、[^\s、]+/.test(s)) count += 1;
  }
  return count;
}
function candidateRuleOfThree(text) {
  const sentences = splitProseSentences(text).length || 1;
  const c = ruleOfThreeCount(text);
  // density-gated: >=3 tricolons AND >= 1 per 4 sentences
  return c >= 3 && c / sentences >= 0.25;
}

// Decorative structure density: ratio of heading/bullet/divider lines to total
// non-blank lines, gated to multi-line documents.
function candidateDecorativeStructure(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 8) return false;
  const decorative = lines.filter((l) =>
    /^#{1,6}\s+\S/.test(l) || /^[-*+]\s+\S/.test(l) || /^\d+[.)]\s+\S/.test(l) ||
    /^(?:-{3,}|\*{3,}|_{3,})$/.test(l) || /^\*\*[^*]+\*\*:?$/.test(l)
  ).length;
  return decorative / lines.length >= 0.5;
}

// Emoji-per-item density: many list items each carrying an emoji.
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u;
function candidateEmojiPerItem(text) {
  const items = text.split('\n').map((l) => l.trim()).filter((l) => /^(?:[-*+]|\d+[.)])\s+\S/.test(l));
  if (items.length < 3) return false;
  const withEmoji = items.filter((l) => EMOJI_RE.test(l)).length;
  return withEmoji >= 3 && withEmoji / items.length >= 0.6;
}

export function decidePromotion({ attributableTP, attributableFP, newBenchmarkNaturalFP, newHumanControlFP }) {
  const promote = attributableTP > attributableFP && newBenchmarkNaturalFP === 0 && newHumanControlFP === 0;
  return { promote, decision: promote ? "PROMOTE" : "HOLD" };
}

const CANDIDATES = {
  ruleOfThree: candidateRuleOfThree,
  decorativeStructure: candidateDecorativeStructure,
  emojiPerItem: candidateEmojiPerItem,
};

// ----- Denominators (pre-registered) -----

function loadDenominators() {
  const syco = readJsonl(join(CORPUS_DIR, 'sycophancy-corpus.jsonl'))
    .map((r) => ({ text: r.phrase ?? '', lang: r.lang || 'en', expectedHot: true, slice: 'sycophancy' }));
  const tells = readJsonl(join(CORPUS_DIR, 'tells-corpus.jsonl'))
    .map((r) => ({ text: r.phrase ?? '', lang: r.lang || 'en', expectedHot: true, slice: r.category === 'structural' ? 'structural_tells' : 'lexical_tells' }));

  // human-controls: negatives (expected NOT hot). raw bodies are gitignored.
  const humans = [];
  const rawDir = join(CORPUS_DIR, 'human-controls/raw');
  for (const rec of readJsonl(join(CORPUS_DIR, 'human-controls/ko.jsonl'))) {
    const p = join(rawDir, `${rec.id}.txt`);
    if (existsSync(p)) humans.push({ text: readFileSync(p, 'utf8'), lang: rec.lang || 'ko', expectedHot: false, slice: 'human_controls' });
  }

  // benchmark fixtures: ai = positive, natural = negative.
  const fixtures = [];
  for (const lang of ['ko', 'en', 'zh', 'ja']) {
    for (const [cls, expectedHot] of [['ai', true], ['natural', false]]) {
      const dir = join(FIXTURES_ROOT, lang, cls);
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
        let body = readFileSync(join(dir, file), 'utf8');
        const m = /^---\n[\s\S]*?\n---\s*\n([\s\S]*)$/.exec(body);
        if (m) body = m[1];
        fixtures.push({ text: body, lang, expectedHot, slice: expectedHot ? 'benchmark_ai' : 'benchmark_natural' });
      }
    }
  }
  return [...syco, ...tells, ...humans, ...fixtures];
}

export function evaluateCandidates() {
  const items = loadDenominators().map((it) => ({
    ...it,
    currentHot: analyzeText(it.text, { lang: it.lang, repoRoot: REPO_ROOT }).hot === true,
  }));

  // Pre-seed the pre-registered denominators so they always appear with a stable
  // schema even when a slice has 0 evaluated rows (e.g. human-controls raw bodies
  // are gitignored and absent in CI).
  const PRE_REGISTERED = { sycophancy: true, lexical_tells: true, structural_tells: true, human_controls: false, benchmark_ai: true, benchmark_natural: false };
  const slices = {};
  for (const [name, expectedHot] of Object.entries(PRE_REGISTERED)) {
    slices[name] = { total: 0, expectedHot, currentTP: 0, currentFN: 0, currentFP: 0, currentTN: 0 };
  }
  for (const it of items) {
    const s = (slices[it.slice] ??= { total: 0, expectedHot: it.expectedHot, currentTP: 0, currentFN: 0, currentFP: 0, currentTN: 0 });
    s.total += 1;
    if (it.expectedHot) { if (it.currentHot) s.currentTP += 1; else s.currentFN += 1; }
    else if (it.currentHot) s.currentFP += 1; else s.currentTN += 1;
  }

  const candidates = {};
  for (const [name, fn] of Object.entries(CANDIDATES)) {
    let attributableTP = 0;       // positives currently FN that candidate flags
    let attributableFP = 0;       // negatives currently TN that candidate flags
    let newBenchmarkNaturalFP = 0;
    let newHumanControlFP = 0;
    const perSlice = {};
    for (const it of items) {
      const fires = fn(it.text);
      const ps = (perSlice[it.slice] ??= { fires: 0, attrTP: 0, attrFP: 0 });
      if (fires) ps.fires += 1;
      if (it.expectedHot && !it.currentHot && fires) { attributableTP += 1; ps.attrTP += 1; }
      if (!it.expectedHot && !it.currentHot && fires) {
        attributableFP += 1; ps.attrFP += 1;
        if (it.slice === 'benchmark_natural') newBenchmarkNaturalFP += 1;
        if (it.slice === 'human_controls') newHumanControlFP += 1;
      }
    }
    const { promote, decision } = decidePromotion({ attributableTP, attributableFP, newBenchmarkNaturalFP, newHumanControlFP });
    candidates[name] = {
      attributableTP, attributableFP,
      newBenchmarkNaturalFP, newHumanControlFP,
      promote,
      decision,
      perSlice,
    };
  }

  return {
    schema: 'patina.detector-candidate-eval.v1',
    note: 'Candidates are evaluated out-of-tree; none is wired into analyzeText unless promoted by a separate consensus. Measurement only.',
    promotionRule: 'attributable_TP > attributable_FP AND new benchmark-natural FP == 0 AND new human-control FP == 0',
    denominators: Object.fromEntries(Object.entries(slices).map(([k, v]) => [k, {
      total: v.total, expectedHot: v.expectedHot,
      currentTP: v.currentTP, currentFN: v.currentFN, currentFP: v.currentFP, currentTN: v.currentTN,
      currentRecall: v.expectedHot ? round(v.currentTP / (v.currentTP + v.currentFN || 1)) : null,
    }])),
    candidates,
    promoted: Object.entries(candidates).filter(([, v]) => v.promote).map(([k]) => k),
  };
}

function main() {
  const args = process.argv.slice(2);
  const report = evaluateCandidates();
  if (!args.includes('--no-timestamp')) report.generated_at = new Date().toISOString();
  if (args.includes('--json')) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return;
  }
  process.stdout.write('# Detector candidate evaluation (Phase B, measurement-only)\n\n');
  process.stdout.write('promotion rule: ' + report.promotionRule + '\n\n');
  for (const [name, c] of Object.entries(report.candidates)) {
    process.stdout.write(`${name.padEnd(20)} attrTP=${c.attributableTP} attrFP=${c.attributableFP} newBenchNatFP=${c.newBenchmarkNaturalFP} newHumanFP=${c.newHumanControlFP} -> ${c.decision}\n`);
  }
  process.stdout.write('\npromoted: ' + (report.promoted.length ? report.promoted.join(', ') : '(none — detector left unchanged, FP-safe)') + '\n');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try { main(); } catch (err) { process.stderr.write(`detector-candidate-eval: ${err.message}\n`); process.exit(1); }
}
