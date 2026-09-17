#!/usr/bin/env node
// Calibration for the number-safety role-swap gap named in #872.
//
// MEASUREMENT ONLY, following scripts/ko-conjunction-candidate-eval.mjs and
// scripts/detector-candidate-eval.mjs: the candidate rules live HERE as pure
// functions and are deliberately NOT wired into src/features/meaning-proxy.js,
// the web number-safety gate, or the CLI numeric-claim overlay. #872 says the
// fix "needs a calibration round (false-positive risk on reordered but
// faithful lists)" and must not be folded into the CLI overlay — this file is
// that calibration round.
//
// The shipping contract compares an unsorted multiset of canonical numeric
// claims, so "shipped 3 features, fixed 12 bugs" -> "shipped 12 features,
// fixed 3 bugs" compares equal. The candidates below bind each numeric token
// to its local context word(s) and fire only when a SHARED context carries a
// different value on each side — the signature of crossed bindings. Faithful
// reorders preserve the (value, context) pairs; predicate drift (grew ->
// increased) shares no context, so it stays silent by construction.
//
// Usage: node scripts/number-swap-candidate-eval.mjs [--json]

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const MANIFEST = resolve(REPO_ROOT, 'tests/fixtures/number-swap-calibration/number-swap-50.jsonl');

// Clock times bind as one token ("9:05"), or the digit split would invent
// two claims out of one time.
const TIME_TOKEN = /\b\d{1,2}:\d{2}\b/g;
const NUMBER_TOKEN = /[-+−]?\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;

// Function words that never identify a claim's role. Kept tiny and explicit;
// content words (nouns, verbs, units, entities) are the binding surface.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'while', 'was', 'were', 'is', 'are',
  'at', 'by', 'of', 'in', 'on', 'to', 'per', 'for', 'with', 'this', 'that',
  'stayed', 'later', 'another',
  '은', '는', '이', '가', '을', '를', '은', '이고', '그리고', '하지만', '면서',
  '에', '에서', '으로', '로', '의', '만', '도', '과', '와', '이었', '였', '압니',
]);

const CONTEXT_WORD = /[A-Za-z]+|[\uAC00-\uD7A3]{1,4}/g;

// Korean particles attach to content words (회고는, 년에, 스탠드업은) and would
// break context equality between otherwise identical bindings.
const KO_PARTICLES = ['에서', '으로', '이고', '하고', '랑은', '은', '는', '이', '가', '을', '를', '에', '의', '와', '과', '도', '만', '고'];

export function stripKoreanParticle(word) {
  for (const particle of KO_PARTICLES) {
    if (word.length > particle.length && word.endsWith(particle)) {
      return word.slice(0, -particle.length);
    }
  }
  return word;
}

function normalizeContext(word) {
  return stripKoreanParticle(word.toLowerCase());
}

/**
 * @param {string} text
 * @returns {{value: string, index: number}[]}
 */
export function extractNumericTokens(text) {
  const source = String(text ?? '');
  const occupied = [];
  const tokens = [];
  for (const m of source.matchAll(TIME_TOKEN)) {
    occupied.push([m.index, m.index + m[0].length]);
    tokens.push({ value: m[0], index: m.index });
  }
  for (const m of source.matchAll(NUMBER_TOKEN)) {
    if (occupied.some(([s, e]) => m.index >= s && m.index < e)) continue;
    tokens.push({ value: m[0].replace(/,/g, ''), index: m.index });
  }
  return tokens;
}

/**
 * Nearest content word for a token: scan outward one token at a time, right
 * side first at equal distance, skipping punctuation, spaces, %, and
 * stopwords. Korean units (년, 명, 개, 일, 분, 만…) and Latin entities are
 * content by design — they are exactly what swaps cross ("2024년 고객 30명"
 * -> "30년 고객 2024명").
 */
export function nearestContext(text, index, radius = 3) {
  const before = [...text.slice(0, index).matchAll(CONTEXT_WORD)].map((m) => m[0]);
  const after = [...text.slice(index).matchAll(CONTEXT_WORD)].map((m) => m[0]);
  for (let d = 1; d <= radius; d++) {
    const right = after[d - 1];
    if (right && !STOPWORDS.has(right.toLowerCase())) return normalizeContext(right);
    const left = before[before.length - d];
    if (left && !STOPWORDS.has(left.toLowerCase())) return normalizeContext(left);
  }
  return null;
}

/**
 * The two nearest content words on each side of the token (v3). Shared unit
 * nouns (dollars, 개, 년에) hide the real binder one slot further out
 * (Plan A/B, 버전 2/5); a second slot on each side reaches it.
 */
export function nearestContexts(text, index, perSide = 2, radius = 5) {
  const before = [...text.slice(0, index).matchAll(CONTEXT_WORD)].map((m) => m[0]);
  const after = [...text.slice(index).matchAll(CONTEXT_WORD)].map((m) => m[0]);
  const left = [];
  for (let i = before.length - 1; i >= 0 && left.length < perSide && radius - (before.length - 1 - i) >= 0; i--) {
    const word = before[i];
    if (!STOPWORDS.has(word.toLowerCase())) left.push(normalizeContext(word));
  }
  const right = [];
  for (let i = 0; i < after.length && right.length < perSide; i++) {
    const word = after[i];
    if (!STOPWORDS.has(word.toLowerCase())) right.push(normalizeContext(word));
  }
  return [...right, ...left];
}

/**
 * Bind each numeric token to a bag of context words.
 * v1: the single nearest content word.
 * v2: v1 plus the content word that follows a per/당 window ("per minute"),
 *     which is where same-noun rate limits hide their real binding.
 */
/**
 * Clause-scoped dual binding (v4): v3's second slot reaches across clause
 * boundaries and binds the NEXT clause's entity, which faithful reorders
 * legitimately rearrange. Scoping the two slots to the number's own clause
 * keeps the binder local to the claim that owns the number.
 */
const CLAUSE_SPLIT = /(?<=[.;])\s+|,\s+|\s+(?:and|while|그리고|하지만|그래서|따라서|및)\s+/;

export function clausesOf(text) {
  return String(text ?? '')
    .split(CLAUSE_SPLIT)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

export function contextBindings(text, variant = 'v1') {
  const pairs = [];
  if (variant === 'v4') {
    for (const clause of clausesOf(text)) {
      for (const token of extractNumericTokens(clause)) {
        for (const context of nearestContexts(clause, token.index)) {
          pairs.push({ value: token.value, context });
        }
      }
    }
    return pairs;
  }
  for (const token of extractNumericTokens(text)) {
    if (variant === 'v3') {
      for (const context of nearestContexts(text, token.index)) {
        pairs.push({ value: token.value, context });
      }
      continue;
    }
    const primary = nearestContext(text, token.index);
    if (primary) pairs.push({ value: token.value, context: primary });
    if (variant === 'v2') {
      const after = text.slice(token.index);
      const per = after.match(/(?:per|당)\s+([A-Za-z]+|[\uAC00-\uD7A3]{1,4})/);
      if (per && !STOPWORDS.has(per[1].toLowerCase())) {
        pairs.push({ value: token.value, context: `per:${normalizeContext(per[1])}` });
      }
    }
  }
  return pairs;
}

function bindingsByContext(pairs) {
  const map = new Map();
  for (const { value, context } of pairs) {
    const inner = map.get(context) ?? new Map();
    inner.set(value, (inner.get(value) ?? 0) + 1);
    map.set(context, inner);
  }
  return map;
}

/**
 * Fire iff some context word carries different value-counts on the two sides.
 * Contexts that appear on only one side are drift, not crossing, and never
 * fire — that asymmetry is what keeps faithful paraphrases silent.
 */
export function candidateFires(original, rewrite, variant = 'v1') {
  const source = bindingsByContext(contextBindings(original, variant));
  const target = bindingsByContext(contextBindings(rewrite, variant));
  for (const [context, values] of source) {
    const other = target.get(context);
    if (!other) continue;
    if (other.size !== values.size || [...values].some(([v, n]) => other.get(v) !== n)) return true;
  }
  return false;
}

export function loadManifest(path = MANIFEST) {
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

export function evaluateCandidate(docs = loadManifest()) {
  const report = { variants: {}, rows: [] };
  for (const variant of ['v1', 'v2', 'v3', 'v4']) {
    let tp = 0, fp = 0, tn = 0, fn = 0, expectedMiss = 0, expectedMissFired = 0;
    const misses = [];
    const falsePositives = [];
    for (const doc of docs) {
      const fired = candidateFires(doc.original, doc.rewrite, variant);
      report.rows.push({ id: doc.id, class: doc.class, variant, fired });
      if (doc.class === 'swap') {
        if (fired) tp += 1; else { fn += 1; misses.push(doc.id); }
      } else if (doc.class === 'miss') {
        if (fired) expectedMissFired += 1; else expectedMiss += 1;
      } else if (fired) {
        fp += 1;
        falsePositives.push(doc.id);
      } else tn += 1;
    }
    const precision = tp + fp === 0 ? null : tp / (tp + fp);
    const recall = tp + fn === 0 ? null : tp / (tp + fn);
    report.variants[variant] = { tp, fp, tn, fn, precision, recall, misses, falsePositives, expectedMiss, expectedMissFired };
  }
  return report;
}

function printReport() {
  const report = evaluateCandidate();
  console.log('#872 number-safety role-swap calibration — 50-pair fixture (NOT wired into the product)');
  for (const [variant, r] of Object.entries(report.variants)) {
    console.log(`\n${variant}: ${variant === 'v1' ? 'nearest content word' : variant === 'v2' ? 'nearest content word + per/당 window' : variant === 'v3' ? 'two nearest content words each side, particles stripped' : 'clause-scoped two-slot binding'}`);
    console.log(`  TP ${r.tp}  FP ${r.fp}  TN ${r.tn}  FN ${r.fn}`);
    console.log(`  precision      ${r.precision}`);
    console.log(`  recall         ${r.recall}`);
    if (r.misses.length) console.log(`  swaps missed   ${r.misses.join(', ')}`);
    if (r.falsePositives.length) console.log(`  false fires    ${r.falsePositives.join(', ')}`);
    console.log(`  expected misses (antonym polarity, non-goal) held: ${r.expectedMiss}, fired anyway: ${r.expectedMissFired}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(evaluateCandidate(), null, 2));
  } else {
    printReport();
  }
}
