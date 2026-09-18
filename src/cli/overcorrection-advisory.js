/**
 * Overcorrection advisory for rewrite OUTPUT (#882, parent #878).
 *
 * Warning only: never changes exit codes, scoring, or rewrite text. This is the
 * mirror of `smoothness-advisory.js` (#820) — that one flags output that became
 * too even, this one flags output that acquired a NEW slop class while removing
 * the old one.
 *
 * `analyzeText` / `src/features/analyzer.js` / the benchmark MUST NOT import
 * this module: it is a CLI rewrite note comparing source to output, not a
 * detector claim about either one.
 *
 * Two signals ship in this stage, both taken from #882's acceptance fixtures:
 *
 * 1. DASH WIPE — the source leaned on typographic dashes and the rewrite has
 *    none left. Anti-slop tools that ban em dashes outright produce exactly
 *    this, and human writers do use dashes, so removing every one of them is
 *    worth a note. Deliberately NOT a ban: one surviving dash clears the check,
 *    and a source with fewer than DASH_WIPE_MIN_SOURCE dashes is never judged,
 *    because dropping a lone dash is ordinary editing.
 *
 * 2. INTRODUCED SLANG — a slang / forced-spoken marker appears in the rewrite
 *    that the source never used. Forcing casual register is the other half of
 *    the same failure ("add soul" passes that mint new slop).
 *
 * 3. INTRODUCED CADENCE STACK — the rewrite output carries a 2026 cadence tell
 *    (#898's rewrite pattern 38 shape: a run of 4+ consecutive short sentences
 *    of ≤8 words, or a run of 3+ consecutive ≤5-word fragments) that the source
 *    did not have. Only NEW stacks count: a punchy draft that keeps its own
 *    rhythm stays silent. English only — pattern 38 is an EN promotion and the
 *    KO/ZH/JA cadence tell has no measured fixture yet (#880 non-goal).
 *
 * Both lists are intentionally short and high-precision. A marker only counts
 * when the SOURCE lacks it, so a casual draft that keeps its own voice is
 * silent. Korean-flattening checks are NOT in this stage.
 *
 * Opt out with `overcorrection-guard: false`. A missing key is enabled.
 *
 * Failure modes (advisory stays silent or can false-trip):
 * - A rewrite that legitimately restructures dash asides into sentences trips
 *   the dash signal. That is the intended note, not a claim the edit is wrong.
 * - Quoted speech that contains slang reads as introduced slang when the quote
 *   is new to the rewrite.
 */

import { splitProseSentences, splitParagraphs } from '../features/segment.js';

export const DASH_WIPE_MIN_SOURCE = 2;
/** Typographic dashes only: em, en, and horizontal bar. ASCII hyphens are not dashes here. */
const TYPOGRAPHIC_DASH_RE = /[\u2014\u2013\u2015]/g;

/** Cadence-stack shape from rewrite pattern 38 (#898). */
export const CADENCE_SHORT_MAX_WORDS = 8;
export const CADENCE_SHORT_MIN_RUN = 4;
export const CADENCE_FRAGMENT_MAX_WORDS = 5;
export const CADENCE_FRAGMENT_MIN_RUN = 3;

/**
 * Does the text contain a 2026 cadence stack run? Sentence-split on the same
 * segmenter the analyzers use; a sentence counts as short at ≤8 words and as a
 * fragment at ≤5 words.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function hasCadenceStack(text) {
  const sentences = splitParagraphs(String(text ?? ''))
    .flatMap((paragraph) => splitProseSentences(paragraph))
    .map((sentence) => sentence.trim())
    .filter(Boolean);
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

/** Latin-script slang and forced-spoken markers, matched on word boundaries. */
export const EN_SLANG_MARKERS = Object.freeze([
  'bro', 'bruh', 'ngl', 'tbh', 'lowkey', 'highkey', 'af',
  'gonna', 'wanna', 'gotta', 'kinda', 'sorta', "ain't", "y'all",
]);

/** Korean slang / chat markers. Matched as substrings: Korean has no word boundaries. */
export const KO_SLANG_MARKERS = Object.freeze([
  'ㅋㅋ', 'ㅎㅎ', 'ㄹㅇ', '찐', '개꿀', '레알', '핵꿀',
]);

/**
 * Warn when a rewrite traded the source's slop for a new one. Advisory only.
 *
 * @param {{ original?: string, text?: string, config?: object, logger?: { warn?: Function }, lang?: string }} [opts]
 * @returns {object|null} Assessment when the warning fires; otherwise null.
 */
export function warnIfOvercorrected({ original, text, config = {}, logger, lang = 'en' } = {}) {
  if (config['overcorrection-guard'] === false) return null;
  try {
    const assessment = assessOvercorrection(original, text, { lang });
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
 * @param {{ lang?: string }} [opts]
 * @returns {{ trip: boolean, reasons: string[], sourceDashes: number, rewriteDashes: number, addedSlang: string[] }|null}
 */
export function assessOvercorrection(original, rewrite, { lang = 'en' } = {}) {
  if (typeof original !== 'string' || typeof rewrite !== 'string') return null;
  if (!original.trim() || !rewrite.trim()) return null;

  const sourceDashes = countMatches(original, TYPOGRAPHIC_DASH_RE);
  const rewriteDashes = countMatches(rewrite, TYPOGRAPHIC_DASH_RE);
  const addedSlang = introducedSlang(original, rewrite, lang);
  const cadenceIntroduced = lang === 'en' && hasCadenceStack(rewrite) && !hasCadenceStack(original);

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
  if (reasons.length === 0) return null;
  return { trip: true, reasons, sourceDashes, rewriteDashes, addedSlang, cadenceIntroduced };
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
