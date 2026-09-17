#!/usr/bin/env node
// Candidate evaluation for the 상담원 톤 (agent/counselor tone) gap named in #880.
//
// MEASUREMENT ONLY, following scripts/ko-conjunction-candidate-eval.mjs and
// scripts/ko-comma-excess-candidate-eval.mjs: the candidate rule lives HERE
// as a pure function and is deliberately NOT wired into src/features, any
// pattern pack, or any rewrite path.
//
// #880 records 상담원·치료사 말투 as a catalog gap: service-register filler
// stacked over zero content ("언제든 문의해 주세요. 도와드리겠습니다."). The
// hard part is that real customer-service replies are full of the same
// vocabulary — what separates them is anchors: a real reply resolves a
// concrete case (order numbers, amounts, dates, model names). The candidate
// therefore requires a marker RUN plus an anchor-free document, the same
// vacuity veto #905 introduced for 문두 접속사.
//
// Promotion thresholds from process/pattern-freshness.md:
//   new score-only pattern : precision >= 0.70, recall >= 0.40
//   new rewrite pattern    : precision >= 0.80, recall >= 0.50
// Both also require no severe false positives.
//
// Usage: node scripts/ko-agent-tone-candidate-eval.mjs [--json]

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { splitProseSentences, splitParagraphs } from '../src/features/segment.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const MANIFEST = resolve(REPO_ROOT, 'tests/fixtures/ko-slop-gaps/agent-tone-50.jsonl');

export const SCORE_ONLY_FLOOR = Object.freeze({ precision: 0.70, recall: 0.40 });
export const REWRITE_FLOOR = Object.freeze({ precision: 0.80, recall: 0.50 });

/**
 * Service-register markers: formulaic agent/counselor phrases that carry no
 * case content by themselves. Matched as conjugation-stable stems — "드리",
 * "기울이", "주시다" conjugate (드립니다, 기울입니다, 주시면), so each marker is
 * truncated where Korean conjugation forks.
 */
export const AGENT_TONE_MARKERS = Object.freeze([
  '도와드', '안내해 드', '확인해 드', '처리해 드', '해결해 드',
  '답변해 드', '답변드', '반영해 드', '반영하겠', '말씀해 주', '문의해 주',
  '물어보', '기다려 주', '남겨 주', '지켜봐 주', '귀 기울', '귀를 기울',
  '최선을 다', '노력하겠', '감사합', '감사드', '약속드', '성심',
  '환영합', '편하게', '응원합', '하실 수 있', '가능합',
]);

/**
 * A single marker is ordinary politeness; a real CS reply carries anchors.
 * The rule fires only on a marker run over an anchor-free document.
 */
export const CANDIDATE = Object.freeze({
  minSentences: 3,
  minMarkerCount: 4,
  minDistinctMarkers: 3,
});

const NUMERIC_ANCHOR = /\d/;
const LATIN_ENTITY = /[A-Za-z]{2,}/;

export function countAgentToneMarkers(text) {
  const source = String(text ?? '');
  const found = [];
  for (const marker of AGENT_TONE_MARKERS) {
    const occurrences = source.split(marker).length - 1;
    if (occurrences > 0) found.push({ marker, occurrences });
  }
  const count = found.reduce((total, { occurrences }) => total + occurrences, 0);
  return { count, distinct: found.length, found };
}

export function candidateFires(text) {
  const source = String(text ?? '');
  const sentences = splitParagraphs(source)
    .flatMap((paragraph) => splitProseSentences(paragraph))
    .filter(Boolean);
  if (sentences.length < CANDIDATE.minSentences) return false;
  // A real reply resolves a concrete case; numbers and Latin entities are the
  // cheap deterministic proxy for that concreteness (same veto as #905).
  if (NUMERIC_ANCHOR.test(source) || LATIN_ENTITY.test(source)) return false;
  const { count, distinct } = countAgentToneMarkers(source);
  return count >= CANDIDATE.minMarkerCount && distinct >= CANDIDATE.minDistinctMarkers;
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
  const gate = (value, limit) => (value === null ? false : value >= limit);
  console.log('#880 상담원 톤 candidate — 50-document fixture (NOT wired into the product)');
  console.log(`  documents      ${loadManifest().length} (25 hot / 25 cold)`);
  console.log(`  rule           >=${CANDIDATE.minMarkerCount} service-marker occurrences (>=${CANDIDATE.minDistinctMarkers} distinct) over an anchor-free document, min ${CANDIDATE.minSentences} sentences`);
  console.log(`  TP ${r.tp}  FP ${r.fp}  TN ${r.tn}  FN ${r.fn}`);
  console.log(`  precision      ${r.precision}`);
  console.log(`  recall         ${r.recall}`);
  if (r.misses.length) console.log(`  hot misses     ${r.misses.join(', ')}`);
  if (r.falsePositives.length) console.log(`  false fires    ${r.falsePositives.join(', ')}`);
  console.log(`  score-only gate (>=${SCORE_ONLY_FLOOR.precision}/${SCORE_ONLY_FLOOR.recall})  ${gate(r.precision, SCORE_ONLY_FLOOR.precision) && gate(r.recall, SCORE_ONLY_FLOOR.recall) ? 'PASS' : 'FAIL'}`);
  console.log(`  rewrite gate    (>=${REWRITE_FLOOR.precision}/${REWRITE_FLOOR.recall})  ${gate(r.precision, REWRITE_FLOOR.precision) && gate(r.recall, REWRITE_FLOOR.recall) ? 'PASS' : 'FAIL'}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(evaluateCandidate(), null, 2));
  } else {
    printReport();
  }
}
