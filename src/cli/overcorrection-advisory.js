/**
 * Overcorrection advisory for rewrite OUTPUT: flags a rewrite that removed one
 * slop class and added another. Warning only: never changes exit codes,
 * scoring, or the rewrite text, and the detector/benchmark must not import it.
 *
 * A signal counts only when the SOURCE lacks it: every typographic dash wiped
 * from a source that used several, slang the source never used, a new
 * short-sentence cadence stack (English), or a Korean source that mixed
 * sentence-ending classes flattened onto one (exempt when the user requested a
 * register). Opt out with `overcorrection-guard: false`.
 */

import { splitTextSentences } from '../features/segment.js';

const DASH_WIPE_MIN_SOURCE = 2;
/** Typographic dashes only: em, en, and horizontal bar. ASCII hyphens are not dashes here. */
const TYPOGRAPHIC_DASH_RE = /[\u2014\u2013\u2015]/g;

/** Cadence-stack shape of rewrite pattern 38. */
const CADENCE_SHORT_MAX_WORDS = 8;
const CADENCE_SHORT_MIN_RUN = 4;
const CADENCE_FRAGMENT_MAX_WORDS = 5;
const CADENCE_FRAGMENT_MIN_RUN = 3;

/** Korean flattening gate, calibrated on tests/fixtures/ko-overcorrection/flattening-50.jsonl. */
const FLATTEN_MIN_SENTENCES = 5;
const FLATTEN_MIN_SOURCE_CLASSES = 3;
const FLATTEN_MAX_SOURCE_DOMINANCE = 0.8;

/**
 * Korean sentence-ending classes, checked longest-suffix-first. 합니다체
 * surfaces are the syllable tail 니다/니까 — the ㅂ rides as batchim on the
 * previous syllable (됩니다/드립니다/줍니다), so a fixed 합니다/습니다 list
 * would misclassify many formal sentences as plain.
 */
const KO_ENDING_CLASSES = [
  { id: 'formal', re: /(니다|니까)$/ },
  { id: 'clipped', re: /(임|음|움|함|됨|둠)$/ },
  { id: 'polite', re: /(네요|군요|요|죠)$/ },
  { id: 'question', re: /(까|니|냐|나)$/ },
  { id: 'banmal', re: /(어|여|야|자|지|네|군)$/ },
  { id: 'plain', re: /(다|라)$/ },
];

/**
 * Translationese classes appended to a flattening warning as context only;
 * requiring them to gate would silence most genuine flattening cases.
 */
const KO_CALQUE_CLASSES = [
  { id: '속격 연쇄 "A의 B의 C"', re: /[가-힣]{1,8}\s*의\s*[가-힣]{1,8}\s*의\s*[가-힣]{1,8}/ },
  { id: '"~적" 명사화', re: /[가-힣]{1,8}적(이|인|으로)?\s*[.가-힣]/ },
  { id: '"~을 제공합니다"', re: /(을|를)\s*제공(?:합니다|한다|해\s*줍니다)/ },
  { id: '"~을 가지고 있습니다"', re: /(을|를)\s*(?:가지고\s*(?:있|합)|갖고\s*(?:있|합))/ },
  { id: '"~할 수 있습니다"', re: /할\s*수\s*있/ },
  { id: '"~의 가능성"', re: /가능성/ },
];

/**
 * Does the text contain a 2026 cadence stack run? Sentence-split on the same
 * segmenter the analyzers use; a sentence counts as short at ≤8 words and as a
 * fragment at ≤5 words.
 *
 * @param {string} text
 * @returns {boolean}
 */
function hasCadenceStack(text) {
  const sentences = splitTextSentences(text);
  let shortRun = 0;
  let fragmentRun = 0;
  for (const sentence of sentences) {
    const words = sentence.split(/\s+/).filter(Boolean).length;
    if (words === 0) continue;
    shortRun = words <= CADENCE_SHORT_MAX_WORDS ? shortRun + 1 : 0;
    fragmentRun = words <= CADENCE_FRAGMENT_MAX_WORDS ? fragmentRun + 1 : 0;
    if (shortRun >= CADENCE_SHORT_MIN_RUN || fragmentRun >= CADENCE_FRAGMENT_MIN_RUN) return true;
  }
  return false;
}

/**
 * Classify one Korean sentence's ending; null when the sentence carries no
 * Korean sentence-final ending (numbers, Latin tails).
 *
 * @param {string} sentence
 * @returns {string|null}
 */
function classifyKoEnding(sentence) {
  const tail = String(sentence ?? '').trim().replace(/[.!?\u2026~\u3002\uff01\uff1f"'\u201d\u2019)]+$/g, '');
  if (!tail) return null;
  if (!/[가-힣]/.test(tail[tail.length - 1])) return null;
  for (const cls of KO_ENDING_CLASSES) {
    if (cls.re.test(tail)) return cls.id;
  }
  return null;
}

/**
 * Korean ending-variety profile: classifiable sentence count, distinct ending
 * classes, and the top class's dominance share.
 *
 * @param {string} text
 * @returns {{ n: number, distinct: number, dominance: number, topClass: string|null }}
 */
function koEndingProfile(text) {
  const sentences = splitTextSentences(text);
  const counts = {};
  let n = 0;
  for (const sentence of sentences) {
    const cls = classifyKoEnding(sentence);
    if (!cls) continue;
    counts[cls] = (counts[cls] || 0) + 1;
    n += 1;
  }
  const entries = Object.entries(counts);
  const distinct = entries.length;
  const [topClass, topCount] = entries.sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  const dominance = n === 0 ? 0 : topCount / n;
  return { n, distinct, dominance, topClass };
}

/**
 * Does the measured v1 flattening rule fire? Source guard first: a source with
 * too few classifiable sentences, fewer than three ending classes, or one class
 * already above 0.80 dominance has nothing to defend — the dash-wipe logic
 * applied to speech levels. A register the user requested is exempt.
 *
 * @param {string} original
 * @param {string} rewrite
 * @param {{ registerRequested?: boolean }} [opts]
 * @returns {{ flattened: boolean, sourceClasses: number, collapsedTo: string|null, gainedCalques: string[] }|null}
 */
function assessKoFlattening(original, rewrite, { registerRequested = false } = {}) {
  if (registerRequested) return null;
  const source = koEndingProfile(original);
  const output = koEndingProfile(rewrite);
  if (source.n < FLATTEN_MIN_SENTENCES || output.n < FLATTEN_MIN_SENTENCES) return null;
  if (source.distinct < FLATTEN_MIN_SOURCE_CLASSES) return null;
  if (source.dominance > FLATTEN_MAX_SOURCE_DOMINANCE) return null;
  const collapsed = output.dominance === 1 && output.distinct === 1;
  if (!collapsed) return null;
  const gainedCalques = KO_CALQUE_CLASSES
    .filter(({ re }) => re.test(String(rewrite ?? '')) && !re.test(String(original ?? '')))
    .map(({ id }) => id);
  return { flattened: true, sourceClasses: source.distinct, collapsedTo: output.topClass, gainedCalques };
}

/** Latin-script slang and forced-spoken markers, matched on word boundaries. */
const EN_SLANG_MARKERS = [
  'bro', 'bruh', 'ngl', 'tbh', 'lowkey', 'highkey', 'af',
  'gonna', 'wanna', 'gotta', 'kinda', 'sorta', "ain't", "y'all",
];

/** Korean slang / chat markers. Matched as substrings: Korean has no word boundaries. */
const KO_SLANG_MARKERS = [
  'ㅋㅋ', 'ㅎㅎ', 'ㄹㅇ', '찐', '개꿀', '레알', '핵꿀',
];

/**
 * Warn when a rewrite traded the source's slop for a new one. Advisory only.
 *
 * @param {{ original?: string, text?: string, config?: object, logger?: { warn?: Function }, lang?: string, registerRequested?: boolean }} [opts]
 * @returns {object|null} Assessment when the warning fires; otherwise null.
 */
export function warnIfOvercorrected({ original, text, config = {}, logger, lang = 'en', registerRequested = false } = {}) {
  if (config['overcorrection-guard'] === false) return null;
  try {
    const assessment = assessOvercorrection(original, text, { lang, registerRequested });
    if (!assessment?.trip) return null;
    logger?.warn?.('rewrite.overcorrection_guard', {
      message: '[patina] overcorrection guard: the rewrite removed one slop class and added another '
        + `(${assessment.reasons.join(', ')}). Advisory only; output is unchanged. `
        + 'Disable this note with `overcorrection-guard: false`.',
    });
    return assessment;
  } catch {
    return null; // the advisory must never break a rewrite
  }
}

/**
 * Compare source and rewrite for overcorrection signals.
 *
 * @param {string} original
 * @param {string} rewrite
 * @param {{ lang?: string, registerRequested?: boolean }} [opts]
 * @returns {{ trip: boolean, reasons: string[], sourceDashes: number, rewriteDashes: number, addedSlang: string[], cadenceIntroduced: boolean, koFlattening: object|null }|null}
 */
export function assessOvercorrection(original, rewrite, { lang = 'en', registerRequested = false } = {}) {
  if (typeof original !== 'string' || typeof rewrite !== 'string') return null;
  if (!original.trim() || !rewrite.trim()) return null;

  const sourceDashes = countMatches(original, TYPOGRAPHIC_DASH_RE);
  const rewriteDashes = countMatches(rewrite, TYPOGRAPHIC_DASH_RE);
  const addedSlang = introducedSlang(original, rewrite, lang);
  const cadenceIntroduced = lang === 'en' && hasCadenceStack(rewrite) && !hasCadenceStack(original);
  const koFlattening = lang === 'ko' ? assessKoFlattening(original, rewrite, { registerRequested }) : null;

  const reasons = [];
  if (sourceDashes >= DASH_WIPE_MIN_SOURCE && rewriteDashes === 0) {
    reasons.push(`every typographic dash was removed (${sourceDashes} in the source, 0 in the rewrite)`);
  }
  if (addedSlang.length > 0) {
    reasons.push(`slang the source never used: ${addedSlang.join(', ')}`);
  }
  if (cadenceIntroduced) {
    reasons.push('a new short-sentence cadence stack appears in the rewrite (pattern 38 shape)');
  }
  if (koFlattening?.flattened) {
    let reason = `a source that mixed ${koFlattening.sourceClasses} sentence-ending classes was flattened `
      + `onto a single ${koFlattening.collapsedTo} ending`;
    if (koFlattening.gainedCalques.length > 0) {
      reason += ` (leaving translated phrasing the source never used: ${koFlattening.gainedCalques.slice(0, 3).join(', ')})`;
    }
    reasons.push(reason);
  }
  if (reasons.length === 0) return null;
  return { trip: true, reasons, sourceDashes, rewriteDashes, addedSlang, cadenceIntroduced, koFlattening };
}

/**
 * Slang markers present in the rewrite and absent from the source.
 *
 * @param {string} original
 * @param {string} rewrite
 * @param {string} lang
 * @returns {string[]}
 */
function introducedSlang(original, rewrite, lang) {
  const markers = lang === 'ko' ? KO_SLANG_MARKERS : EN_SLANG_MARKERS;
  const usesBoundaries = lang !== 'ko';
  const added = [];
  for (const marker of markers) {
    if (containsMarker(rewrite, marker, usesBoundaries) && !containsMarker(original, marker, usesBoundaries)) {
      added.push(marker);
    }
  }
  return added;
}

function containsMarker(text, marker, usesBoundaries) {
  if (!usesBoundaries) return text.includes(marker);
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(text);
}

function countMatches(text, re) {
  return (String(text).match(re) || []).length;
}
