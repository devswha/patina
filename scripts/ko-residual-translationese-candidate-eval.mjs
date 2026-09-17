#!/usr/bin/env node
// Candidate evaluation for the 잔여 직역 커플링 (residual literal-translation
// coupling) gap named in #880.
//
// MEASUREMENT ONLY, following scripts/ko-conjunction-candidate-eval.mjs,
// scripts/ko-comma-excess-candidate-eval.mjs, and
// scripts/ko-agent-tone-candidate-eval.mjs: the candidate rule lives HERE as
// a pure function and is deliberately NOT wired into src/features, any
// pattern pack, or any rewrite path.
//
// #880's coverage audit records that `src/features/translationese.js` is
// advisory-only: its weak rules (provides / have / one-of / as-follows ...)
// never flip a document hot without a strong calque, and humanizer output
// often washes the strong calques out — leaving exactly the weak residue,
// coupled. The gap is that COUPLING: several individually-innocent
// translated constructions stacking in one document, most visibly the
// genitive chain "A의 B의 C" that English "of" phrases calque into.
//
// The candidate fires on weak-signal CLASSES combining (>=3 distinct classes,
// >=4 spans, >=0.25 spans/sentence). Single-class density — legal formulas,
// academic "~적", one "다음과 같습니다" — stays cold by construction.
//
// Promotion thresholds from process/pattern-freshness.md:
//   new score-only pattern : precision >= 0.70, recall >= 0.40
//   new rewrite pattern    : precision >= 0.80, recall >= 0.50
// Both also require no severe false positives.
//
// Usage: node scripts/ko-residual-translationese-candidate-eval.mjs [--json]

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { splitProseSentences, splitParagraphs } from '../src/features/segment.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const MANIFEST = resolve(REPO_ROOT, 'tests/fixtures/ko-slop-gaps/residual-translationese-50.jsonl');

export const SCORE_ONLY_FLOOR = Object.freeze({ precision: 0.70, recall: 0.40 });
export const REWRITE_FLOOR = Object.freeze({ precision: 0.80, recall: 0.50 });

/**
 * Weak translated-construction classes. Each is innocent alone — formal and
 * technical Korean uses every one of them — the tell is the coupling.
 */
export const WEAK_CLASSES = Object.freeze([
  {
    id: 'genitive-chain',
    label: '속격 연쇄 "A의 B의 C" (English of-phrases)',
    // Korean writes the chain spaced ("A의 B의 C"), and link nouns may carry
    // adjectives ("데이터의 안전한 관리의 효율성") — match two or more 의 links.
    re: /[가-힣]{1,8}(?:[가-힣]{1,6})?\s*의\s*[가-힣]{1,8}(?:[가-힣]{1,6})?\s*의\s*[가-힣]{1,8}/g,
  },
  {
    id: 'sino-adjective',
    label: '"~적" 명사화 남발 (English -al/-ic)',
    re: /[가-힣]{1,8}적(?:이|인|으로|인지|입니다|인\s)/g,
  },
  {
    id: 'provides',
    label: '"~을 제공합니다" (English provides)',
    re: /(?:을|를)\s*제공(?:합니다|한다|해\s*줍니다)/g,
  },
  {
    id: 'have',
    label: '"~을 가지고 있습니다" (English have)',
    re: /(?:을|를)\s*(?:가지고\s*(?:있|합)|갖고\s*(?:있|합))/g,
  },
  {
    id: 'possibility',
    label: '"~의 가능성/가능성을" (English possibility-of)',
    re: /가능성(?:을|의|이|이\s*있)?/g,
  },
  {
    id: 'can-modal',
    label: '"~할 수 있습니다" 남발 (English can)',
    re: /할\s*수\s*있(?:습니다|어요|습니다|다)/g,
  },
  {
    id: 'as-follows',
    label: '"다음과 같습니다" (English as follows)',
    re: /다음과\s*같(?:습니다|다|은)/g,
  },
]);

/**
 * Coupling thresholds. The genitive chain is the anchor of this rule — the
 * cold fixture (formal, legal, academic, manual Korean) never produces even
 * one chain, so every firing shape requires at least one: three chains alone,
 * or one chain coupled with a second weak class (>=2 classes, >=2 spans).
 * Single weak classes without a chain (one "다음과 같습니다", one "~적") stay cold.
 */
export const CANDIDATE = Object.freeze({
  minSentences: 3,
  genitiveChainAlone: 3,
  couplingMinChains: 1,
  couplingMinClasses: 2,
  couplingMinSpans: 2,
});

export function collectWeakSignals(text) {
  const source = String(text ?? '');
  const perClass = WEAK_CLASSES.map((klass) => {
    const spans = [...source.matchAll(klass.re)].map((m) => m[0]);
    return { id: klass.id, label: klass.label, spans };
  });
  const active = perClass.filter((entry) => entry.spans.length > 0);
  const totalSpans = active.reduce((total, entry) => total + entry.spans.length, 0);
  return { perClass, active, totalSpans };
}

export function candidateFires(text) {
  const source = String(text ?? '');
  const sentences = splitParagraphs(source)
    .flatMap((paragraph) => splitProseSentences(paragraph))
    .filter(Boolean);
  if (sentences.length < CANDIDATE.minSentences) return false;
  const { active, totalSpans } = collectWeakSignals(source);
  const genitive = active.find((entry) => entry.id === 'genitive-chain')?.spans.length ?? 0;
  if (genitive >= CANDIDATE.genitiveChainAlone) return true;
  if (genitive < CANDIDATE.couplingMinChains) return false;
  return active.length >= CANDIDATE.couplingMinClasses && totalSpans >= CANDIDATE.couplingMinSpans;
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
  console.log('#880 잔여 직역 커플링 candidate — 50-document fixture (NOT wired into the product)');
  console.log(`  documents      ${loadManifest().length} (25 hot / 25 cold)`);
  console.log(`  rule           genitive chain "A의 B의 C" anchored: >=${CANDIDATE.genitiveChainAlone} chains alone, or >=${CANDIDATE.couplingMinChains} chain coupled with >=${CANDIDATE.couplingMinClasses} weak classes and >=${CANDIDATE.couplingMinSpans} spans, min ${CANDIDATE.minSentences} sentences`);
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
