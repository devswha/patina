#!/usr/bin/env node
// Candidate evaluation for the 쉼표/나열/감탄 과잉 gap named in #880.
//
// MEASUREMENT ONLY, following scripts/ko-conjunction-candidate-eval.mjs: the
// candidate rule lives HERE as a pure function and is deliberately NOT wired
// into src/features, any pattern pack, or any rewrite path. Nothing is
// mutated, no LLM is called, no network is opened.
//
// #880 records that 쉼표 밀도·나열·감탄 has weak coverage across the ko packs,
// and that a rule must be measured on a hot/cold fixture before it is
// proposed, because legitimate Korean is full of lists (recipes, rosters,
// specs, statistics) that are the content, not a tell.
//
// The signature this candidate keys on is NOT comma density — it is the
// parallel-inflection run: AI service/promo Korean stacks three or more
// comma-separated adverb or adjective segments that share an inflection
// ending (친절하게, 정확하게, 신속하게 / 아름답고, 즐겁고, 편안하고). Human
// lists enumerate nouns (사과, 배, 포도 / 200g, 50g, 100g) whose final
// characters do not repeat as Korean endings.
//
// Promotion thresholds from process/pattern-freshness.md:
//   new score-only pattern : precision >= 0.70, recall >= 0.40
//   new rewrite pattern    : precision >= 0.80, recall >= 0.50
// Both also require no severe false positives.
//
// Usage: node scripts/ko-comma-excess-candidate-eval.mjs [--json]

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { splitProseSentences, splitParagraphs } from '../src/features/segment.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const MANIFEST = resolve(REPO_ROOT, 'tests/fixtures/ko-slop-gaps/comma-excess-50.jsonl');

export const SCORE_ONLY_FLOOR = Object.freeze({ precision: 0.70, recall: 0.40 });
export const REWRITE_FLOOR = Object.freeze({ precision: 0.80, recall: 0.50 });

/**
 * Korean inflection endings that carry a parallel run. A shared final
 * character only counts as parallelism when it is one of these endings —
 * "200g, 50g, 100g" shares "g" but that is a unit, not an inflection.
 */
export const KOREAN_PARALLEL_ENDINGS = Object.freeze([
  '고', '게', '이', '요', '다', '히', '니', '죠', '네', '지', '려', '해', '로',
]);

/**
 * A single comma-chain is ordinary Korean (명사 나열). The rule fires only on
 * repeated chains, or one chain with exclamatory stacking — the same
 * combination shape #879/#897 used, because hunting one list at a time would
 * flag every recipe and roster.
 */
export const CANDIDATE = Object.freeze({
  minSentences: 3,
  minChains: 2,
  singleChainExclamations: 1,
  minParallelRun: 2,
});

/**
 * Parallelism requires a shared KOREAN INFLECTION ending, not merely a shared
 * final character: "200g, 50g, 100g" shares "g" (a unit) and "한 숟갈, 두
 * 숟갈" shares "갈" (a noun) — neither is an inflection, so neither counts.
 */
function sharesParallelEnding(segmentA, segmentB) {
  const final = segmentA.slice(-1);
  return final === segmentB.slice(-1) && KOREAN_PARALLEL_ENDINGS.includes(final);
}

/**
 * A sentence carries a parallel-inflection comma chain when at least
 * `minParallelRun` of its comma-separated segments share an ending.
 * @param {string} sentence
 */
export function hasParallelChain(sentence) {
  const segments = String(sentence ?? '')
    .split(',')
    .map((segment) => segment.replace(/[!.?~\s]+$/g, '').trim())
    .filter(Boolean);
  if (segments.length < CANDIDATE.minParallelRun) return false;
  let best = 0;
  for (const pivot of segments) {
    const run = segments.filter((segment) => sharesParallelEnding(pivot, segment)).length;
    if (run > best) best = run;
  }
  return best >= CANDIDATE.minParallelRun;
}

export function countChains(text) {
  const sentences = splitParagraphs(String(text ?? ''))
    .flatMap((paragraph) => splitProseSentences(paragraph))
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const chains = sentences.filter((sentence) => hasParallelChain(sentence));
  const exclamations = (String(text ?? '').match(/!/g) ?? []).length;
  return { sentences, chains, chainCount: chains.length, total: sentences.length, exclamations };
}

export function candidateFires(text) {
  const { chainCount, total, exclamations } = countChains(text);
  if (total < CANDIDATE.minSentences) return false;
  if (chainCount >= CANDIDATE.minChains) return true;
  return chainCount >= 1 && exclamations >= CANDIDATE.singleChainExclamations;
}

function round(n, d = 4) {
  return Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : n;
}

export function loadManifest(path = MANIFEST) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

export function evaluateCandidate(docs = loadManifest()) {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  const misses = [];
  const falsePositives = [];
  for (const doc of docs) {
    const fired = candidateFires(doc.text);
    if (doc.class === 'hot') {
      if (fired) tp += 1;
      else { fn += 1; misses.push(doc.id); }
    } else if (fired) {
      fp += 1;
      falsePositives.push(doc.id);
    } else tn += 1;
  }
  const precision = tp + fp === 0 ? null : round(tp / (tp + fp));
  const recall = tp + fn === 0 ? null : round(tp / (tp + fn));
  return { tp, fp, tn, fn, precision, recall, misses, falsePositives };
}

function printReport() {
  const r = evaluateCandidate();
  const floor = (value, limit) => (value === null ? 'n/a' : value >= limit ? 'PASS' : 'FAIL');
  console.log('#880 쉼표/나열/감탄 과잉 candidate — 50-document fixture (NOT wired into the product)');
  console.log(`  documents      ${loadManifest().length} (25 hot / 25 cold)`);
  console.log(`  rule           parallel-inflection comma chain (>=${CANDIDATE.minParallelRun} segments sharing a Korean inflection ending), >=${CANDIDATE.minChains} chains, or 1 chain + >=${CANDIDATE.singleChainExclamations} exclamation mark, min ${CANDIDATE.minSentences} sentences`);
  console.log(`  TP ${r.tp}  FP ${r.fp}  TN ${r.tn}  FN ${r.fn}`);
  console.log(`  precision      ${r.precision}`);
  console.log(`  recall         ${r.recall}`);
  if (r.misses.length) console.log(`  hot misses     ${r.misses.join(', ')}`);
  if (r.falsePositives.length) console.log(`  false fires    ${r.falsePositives.join(', ')}`);
  console.log(`  score-only gate (>=${SCORE_ONLY_FLOOR.precision}/${SCORE_ONLY_FLOOR.recall})  ${floor(r.precision, SCORE_ONLY_FLOOR.precision) && floor(r.recall, SCORE_ONLY_FLOOR.recall) ? 'PASS' : 'FAIL'}`);
  console.log(`  rewrite gate    (>=${REWRITE_FLOOR.precision}/${REWRITE_FLOOR.recall})  ${floor(r.precision, REWRITE_FLOOR.precision) && floor(r.recall, REWRITE_FLOOR.recall) ? 'PASS' : 'FAIL'}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(evaluateCandidate(), null, 2));
  } else {
    printReport();
  }
}
