#!/usr/bin/env node
// Candidate evaluation for the Korean flattening overcorrection signal named
// in #882 ("한국어 어투를 한 형태로 과도하게 평탄화하면서 직역만 남김").
//
// MEASUREMENT ONLY, following scripts/ko-agent-tone-candidate-eval.mjs and
// scripts/ko-residual-translationese-candidate-eval.mjs: the candidate rule
// lives HERE as a pure function and is deliberately NOT wired into
// src/cli/overcorrection-advisory.js, src/features, any pattern pack, or any
// rewrite path.
//
// Unlike the #880 units this fixture is a PAIR corpus — the guard compares a
// source to its rewrite, the same shape as
// tests/fixtures/number-swap-calibration/number-swap-50.jsonl. The signal is
// the COLLAPSE of sentence-ending variety: a source that genuinely mixed
// speech levels (합니다체/한다체/해요체/명사형/의문) flattened into a single
// ending class the source never fully had. A punchy, already-uniform source
// has nothing to lose and stays silent — the same source-guard logic the
// dash-wipe signal (#890) uses.
//
// Variants:
//   v1 collapse       — rewrite is single-ending (dominance 1.00)
//   v2 dominance      — rewrite dominance >= 0.90
//   v3 collapse+calque— v1 AND the rewrite newly carries >= 2 distinct weak
//                        translationese classes (the "직역만 남김" half)
//
// Promotion thresholds from process/pattern-freshness.md:
//   new score-only pattern : precision >= 0.70, recall >= 0.40
//   new rewrite pattern    : precision >= 0.80, recall >= 0.50
// The advisory prints user-visible warnings, so the stricter rewrite floor is
// the bar this unit reports against.
//
// Usage: node scripts/ko-overcorrection-flattening-candidate-eval.mjs [--json]

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { splitProseSentences, splitParagraphs } from '../src/features/segment.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const MANIFEST = resolve(REPO_ROOT, 'tests/fixtures/ko-overcorrection/flattening-50.jsonl');

export const SCORE_ONLY_FLOOR = Object.freeze({ precision: 0.70, recall: 0.40 });
export const REWRITE_FLOOR = Object.freeze({ precision: 0.80, recall: 0.50 });

export const CANDIDATE = Object.freeze({
  /** Minimum classifiable sentences on BOTH sides before the guard judges. */
  minSentences: 5,
  /** The source must genuinely mix speech levels before flattening is a loss. */
  minSourceClasses: 3,
  /** An already-dominant source (>=80% one ending) is not varied enough to defend. */
  maxSourceDominance: 0.8,
  /** v2: how much of the rewrite may pile onto one ending class. */
  dominanceThreshold: 0.9,
  /** v3: corroborating calque classes the rewrite newly carries. */
  minCalqueGain: 2,
});

/**
 * Sentence-ending classes, checked longest-suffix-first so 합니다 never falls
 * through to the plain-다 catch-all.
 */
export const ENDING_CLASSES = Object.freeze([
  { id: 'formal', label: '합니다체 (-ㅂ니다/-습니/-니까; 표면형은 항상 니다/니까)', re: /(니다|니까)$/ },
  { id: 'clipped', label: '명사형 종결 (-임/-음/-움/-함/-됨/-둠)', re: /(임|음|움|함|됨|둠)$/ },
  { id: 'polite', label: '해요체 (-요/-죠/-네요/-군요)', re: /(네요|군요|요|죠)$/ },
  { id: 'question', label: '의문 종결 (-까/-니/-냐/-나)', re: /(까|니|냐|나)$/ },
  { id: 'banmal', label: '해체/반말 (-어/-야/-자/-지/-네/-군)', re: /(어|여|야|자|지|네|군)$/ },
  { id: 'plain', label: '평서형 (-다/-라)', re: /(다|라)$/ },
]);

/**
 * Weak translationese classes for the v3 coupling check — the same classes
 * scripts/ko-residual-translationese-candidate-eval.mjs couples, kept local so
 * this measurement unit stays self-contained.
 */
export const CALQUE_CLASSES = Object.freeze([
  { id: 'genitive-chain', re: /[가-힣]{1,8}\s*의\s*[가-힣]{1,8}\s*의\s*[가-힣]{1,8}/ },
  { id: 'sino-adjective', re: /[가-힣]{1,8}적(이|인|으로)?\s*[.가-힣]/ },
  { id: 'provides', re: /(을|를)\s*제공(?:합니다|한다|해\s*줍니다)/ },
  { id: 'have', re: /(을|를)\s*(가지고\s*있|갖고\s*있)/ },
  { id: 'can-modal', re: /할\s*수\s*있/ },
  { id: 'possibility', re: /가능성/ },
]);

/**
 * Classify one sentence's ending; null when the sentence carries no Korean
 * sentence-final ending (numbers, Latin tails, clipped nouns that are not
 * 명사형 종결).
 *
 * @param {string} sentence
 * @returns {string|null}
 */
export function classifyEnding(sentence) {
  const tail = String(sentence ?? '').trim().replace(/[.!?\u2026~\u3002\uff01\uff1f"'\u201d\u2019)]+$/g, '');
  if (!tail) return null;
  const last = tail[tail.length - 1];
  if (!/[가-힣]/.test(last)) return null;
  for (const cls of ENDING_CLASSES) {
    if (cls.re.test(tail)) return cls.id;
  }
  return null;
}

/**
 * Ending-variety profile of a text: how many sentences are classifiable, how
 * many distinct ending classes appear, and what share the top class holds.
 *
 * @param {string} text
 * @returns {{ n: number, distinct: number, counts: Record<string, number>, dominance: number }}
 */
export function endingProfile(text) {
  const sentences = splitParagraphs(String(text ?? ''))
    .flatMap((paragraph) => splitProseSentences(paragraph))
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const counts = {};
  let n = 0;
  for (const sentence of sentences) {
    const cls = classifyEnding(sentence);
    if (!cls) continue;
    counts[cls] = (counts[cls] || 0) + 1;
    n += 1;
  }
  const distinct = Object.keys(counts).length;
  const dominance = n === 0 ? 0 : Math.max(...Object.values(counts)) / n;
  return { n, distinct, counts, dominance };
}

/**
 * Calque classes present in `b` and absent from `a`.
 *
 * @param {string} a
 * @param {string} b
 * @returns {string[]}
 */
export function gainedCalqueClasses(a, b) {
  return CALQUE_CLASSES.filter(({ re }) => re.test(String(b ?? '')) && !re.test(String(a ?? ''))).map(({ id }) => id);
}

/**
 * Does the flattening candidate fire for this (source, rewrite) pair?
 * Advisory-shaped: a rewrite the user explicitly requested (register axis)
 * is never judged — the product guard reads the same flag from config.
 *
 * @param {string} original
 * @param {string} rewrite
 * @param {{ registerRequested?: boolean, variant?: 'v1'|'v2'|'v3' }} [opts]
 * @returns {boolean}
 */
export function candidateFires(original, rewrite, { registerRequested = false, variant = 'v1' } = {}) {
  if (registerRequested) return false;
  if (typeof original !== 'string' || typeof rewrite !== 'string') return false;
  const src = endingProfile(original);
  const out = endingProfile(rewrite);
  if (src.n < CANDIDATE.minSentences || out.n < CANDIDATE.minSentences) return false;
  if (src.distinct < CANDIDATE.minSourceClasses) return false;
  if (src.dominance > CANDIDATE.maxSourceDominance) return false;
  const collapsed = out.dominance === 1 && out.distinct === 1;
  if (variant === 'v1') return collapsed;
  if (variant === 'v2') return out.dominance >= CANDIDATE.dominanceThreshold;
  if (variant === 'v3') {
    return collapsed && gainedCalqueClasses(original, rewrite).length >= CANDIDATE.minCalqueGain;
  }
  return false;
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

/**
 * Score every variant against the pair corpus.
 *
 * @param {Array<{id:string,class:string,original:string,rewrite:string,registerRequested?:boolean}>} [docs]
 * @returns {Record<'v1'|'v2'|'v3', {tp:number,fp:number,tn:number,fn:number,precision:number|null,recall:number|null,misses:string[],falsePositives:string[]}>}
 */
export function evaluateCandidate(docs = loadManifest()) {
  const variants = /** @type {const} */ (['v1', 'v2', 'v3']);
  const result = {};
  for (const variant of variants) {
    let tp = 0, fp = 0, tn = 0, fn = 0;
    const misses = [];
    const falsePositives = [];
    for (const doc of docs) {
      const fired = candidateFires(doc.original, doc.rewrite, {
        registerRequested: Boolean(doc.registerRequested),
        variant,
      });
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
    result[variant] = { tp, fp, tn, fn, precision, recall, misses, falsePositives };
  }
  return result;
}

function printReport() {
  const docs = loadManifest();
  const report = evaluateCandidate(docs);
  const gate = (value, limit) => (value === null ? false : value >= limit);
  console.log('#882 한국어 어투 평탄화 candidate — 50-pair fixture (NOT wired into the product)');
  console.log(`  pairs          ${docs.length} (25 hot / 25 cold, of which ${docs.filter((d) => d.registerRequested).length} register-requested cold)`);
  console.log(`  rule           source >=${CANDIDATE.minSentences} sentences, >=${CANDIDATE.minSourceClasses} ending classes, dominance <=${CANDIDATE.maxSourceDominance}; rewrite collapsed per variant`);
  for (const [variant, r] of Object.entries(report)) {
    console.log(`  -- ${variant}`);
    console.log(`     TP ${r.tp}  FP ${r.fp}  TN ${r.tn}  FN ${r.fn}  precision ${r.precision}  recall ${r.recall}`);
    if (r.misses.length) console.log(`     hot misses  ${r.misses.join(', ')}`);
    if (r.falsePositives.length) console.log(`     false fires ${r.falsePositives.join(', ')}`);
    console.log(`     rewrite gate (>=${REWRITE_FLOOR.precision}/${REWRITE_FLOOR.recall})  ${gate(r.precision, REWRITE_FLOOR.precision) && gate(r.recall, REWRITE_FLOOR.recall) ? 'PASS' : 'FAIL'}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(evaluateCandidate(), null, 2));
  } else {
    printReport();
  }
}
