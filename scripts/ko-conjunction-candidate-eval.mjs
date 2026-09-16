#!/usr/bin/env node
// Candidate evaluation for the 문두 접속사 남발 gap named in #880.
//
// MEASUREMENT ONLY, following scripts/detector-candidate-eval.mjs: the candidate
// rule lives HERE as a pure function and is deliberately NOT wired into
// src/features, any pattern pack, or any rewrite path. Nothing is mutated, no
// LLM is called, no network is opened.
//
// #880 records that 문두 접속사 has zero coverage across all seven ko packs, and
// that tightening a KO fire condition without a fixture causes false positives
// that collide with the #882 overcorrection guard. So the rule is measured before
// it is proposed, not after it ships.
//
// Promotion thresholds from process/pattern-freshness.md:
//   new score-only pattern : precision >= 0.70, recall >= 0.40
//   new rewrite pattern    : precision >= 0.80, recall >= 0.50
// Both also require no severe false positives.
//
// Usage: node scripts/ko-conjunction-candidate-eval.mjs [--json]

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { splitProseSentences, splitParagraphs } from '../src/features/segment.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const MANIFEST = resolve(REPO_ROOT, 'tests/fixtures/cadence-ko/ko-conjunction-50.jsonl');

export const SCORE_ONLY_FLOOR = Object.freeze({ precision: 0.70, recall: 0.40 });
export const REWRITE_FLOOR = Object.freeze({ precision: 0.80, recall: 0.50 });

/**
 * Sentence-initial connectives. Kept to unambiguous discourse connectives: words
 * that join a sentence to the previous one and can usually be deleted or folded
 * in. Deliberately excludes 바로/사실/정말 and similar emphasis adverbs, which open
 * sentences in ordinary human Korean.
 */
export const KO_SENTENCE_INITIAL_CONJUNCTIONS = Object.freeze([
  '그리고', '그러나', '그런데', '하지만', '또한', '또', '따라서', '그래서',
  '그러므로', '게다가', '한편', '즉', '물론', '다만', '결국', '그럼에도',
]);

/**
 * The candidate rule. A single connective opener is ordinary Korean, so this
 * fires only on a RUN plus a majority — the same combination shape #879 used,
 * for the same reason: #880 warns that hunting this tell one sentence at a time
 * makes prose more mechanical, not less.
 */
export const CANDIDATE = Object.freeze({
  minSentences: 3,
  minOpeners: 3,
  minRatio: 0.6,
});

export function countConnectiveOpeners(text) {
  const sentences = splitParagraphs(String(text ?? ''))
    .flatMap((paragraph) => splitProseSentences(paragraph))
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const openers = sentences.filter((sentence) =>
    KO_SENTENCE_INITIAL_CONJUNCTIONS.some((word) => sentence.startsWith(word))
  );
  return { sentences, openers, count: openers.length, total: sentences.length };
}

export function candidateFires(text) {
  const { count, total } = countConnectiveOpeners(text);
  if (total < CANDIDATE.minSentences) return false;
  return count >= CANDIDATE.minOpeners && count / total >= CANDIDATE.minRatio;
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

export function evaluateCandidate(documents) {
  const rows = documents.map((doc) => {
    const stats = countConnectiveOpeners(doc.text);
    return {
      id: doc.id,
      expected: doc.class === 'hot',
      predicted: candidateFires(doc.text),
      openers: stats.count,
      sentences: stats.total,
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
    falsePositives: fp.map((r) => ({ id: r.id, openers: r.openers, sentences: r.sentences, why: r.why, text: r.text })),
    falseNegatives: fn.map((r) => ({ id: r.id, openers: r.openers, sentences: r.sentences, text: r.text })),
  };
}

function main() {
  const report = evaluateCandidate(loadManifest());
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log('#880 문두 접속사 candidate — 50-document fixture (NOT wired into the product)');
  console.log(`  documents      ${report.counts.total} (${report.counts.hot} hot / ${report.counts.cold} cold)`);
  console.log(`  rule           >=${CANDIDATE.minOpeners} connective openers AND >=${CANDIDATE.minRatio} of sentences, min ${CANDIDATE.minSentences} sentences`);
  console.log(`  TP ${report.tp}  FP ${report.fp}  TN ${report.tn}  FN ${report.fn}`);
  console.log(`  precision      ${report.precision}`);
  console.log(`  recall         ${report.recall}`);
  console.log(`  f1             ${report.f1}`);
  console.log(`  score-only gate (>=${SCORE_ONLY_FLOOR.precision}/${SCORE_ONLY_FLOOR.recall})  ${report.gates.scoreOnly ? 'PASS' : 'FAIL'}`);
  console.log(`  rewrite gate    (>=${REWRITE_FLOOR.precision}/${REWRITE_FLOOR.recall})  ${report.gates.rewrite ? 'PASS' : 'FAIL'}`);
  if (report.falsePositives.length > 0) {
    console.log('\n  false positives (cold documents the candidate fired on):');
    for (const row of report.falsePositives) {
      console.log(`    ${row.id}  ${row.openers}/${row.sentences} openers  ${row.text}`);
    }
  }
  if (report.falseNegatives.length > 0) {
    console.log('\n  false negatives (hot documents the candidate missed):');
    for (const row of report.falseNegatives) {
      console.log(`    ${row.id}  ${row.openers}/${row.sentences} openers  ${row.text}`);
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
