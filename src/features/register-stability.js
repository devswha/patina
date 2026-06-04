// Korean Register Stability (RSS) — a deterministic measure of how much the
// sentence-final REGISTER (politeness/formality level) drifts between two texts.
// This is the JS port of patina-max/composite.py's `register_stability`, so the
// Node engine can guard register the same way MAX mode does (e.g. a rewrite that
// keeps the claim but flips 평어체→존댓말 is a register-stability regression).
//
// It is a PAIRWISE metric (baseline vs candidate), not a single-text hot signal,
// so it is exported as a utility rather than folded into analyzeText.
import { splitProseSentences } from './segment.js';

// Sentence-final ending vocabulary. Order matters — longer/more-specific forms
// first so e.g. 합니다 matches 합쇼체 before 다 falls through to 해라체.
// Mirrors patina-max/composite.py _ENDING_PATTERNS.
const ENDING_PATTERNS = /** @type {Array<[string, RegExp]>} */ ([
  // 합쇼체 (deferential formal): ~ㅂ니다 / ~습니다 / ~ㅂ니까 / ~십시오
  ['hapsho', /(?:[가-힣]니다|[가-힣]니까|[가-힣]시오|십시오|십시요)$/],
  // 해요체 (polite informal)
  ['haeyo', /(?:세요|예요|이에요|에요|해요|어요|아요|네요|군요|지요|죠|[가-힣]요)$/],
  // 해라체 (plain declarative / imperative)
  ['haera', /(?:[가-힣]는다|한다|[가-힣]다|하라|마라|보라|들라|[가-힣]아라|[가-힣]어라|[가-힣]라)$/],
  // 해체 (casual / 반말)
  ['hae', /(?:해|야|아|어|네|군|지)$/],
]);

const TRAILING_PUNCT = /[\s.,!?;:。、]+$/;

function stripFences(text) {
  return String(text ?? '').replace(/```[\s\S]*?```/g, '');
}

/**
 * Count sentence-final register buckets across a text.
 * @param {string} text
 * @returns {Record<string, number>} e.g. { hapsho: 3, haera: 1 }
 */
export function endingDistribution(text) {
  const dist = /** @type {Record<string, number>} */ ({});
  for (const sentence of splitProseSentences(stripFences(text))) {
    const tail = sentence.replace(TRAILING_PUNCT, '');
    if (!tail) continue;
    let bucket = 'other';
    for (const [name, re] of ENDING_PATTERNS) {
      if (re.test(tail)) {
        bucket = name;
        break;
      }
    }
    dist[bucket] = (dist[bucket] || 0) + 1;
  }
  return dist;
}

/** Cosine similarity of two bucket-count maps (0..1). */
export function cosineSimilarity(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const k of keys) dot += (a[k] || 0) * (b[k] || 0);
  for (const v of Object.values(a)) na += v * v;
  for (const v of Object.values(b)) nb += v * v;
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * RSS: cosine similarity of the two register distributions, scaled to 0-100.
 * 100 = identical register mix; lower = the candidate drifted register.
 * @param {string} baseline
 * @param {string} candidate
 * @returns {number}
 */
export function registerStability(baseline, candidate) {
  return cosineSimilarity(endingDistribution(baseline), endingDistribution(candidate)) * 100;
}

/** The dominant (most frequent) non-"other" register bucket, or 'other'. */
export function dominantRegister(text) {
  const dist = endingDistribution(text);
  let best = 'other';
  let n = -1;
  for (const [k, v] of Object.entries(dist)) {
    if (k !== 'other' && v > n) {
      best = k;
      n = v;
    }
  }
  return best;
}

export { ENDING_PATTERNS };
