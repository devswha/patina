// Portability probe (#881, parent #878) — deterministic, LLM-free.
//
// The field notes record slop's definition moving from vocabulary to ABSENCE OF
// POINT OF VIEW: text that is not badly written, just text anyone could have
// written. The portability test is the cheap version of that — if swapping the
// product, company, or person would leave a sentence equally true, it carries no
// point of view.
//
// DETECT ONLY, on purpose. docs/research/2026-rewrite-efficacy-study4.md tested
// the rewrite-side version of this idea (H-4b: a specificity-preservation block
// on the rewrite prompt) and the verdict was NOT supported — the constrained
// rewrite read *more* AI-like, the model obeyed the length floor in only 56% of
// documents, and guard rail 1 (the meaning gate) was violated at 50/54. Nothing
// shipped from that study. So this module reports; it never rewrites, and it
// never supplies a detail the source lacks.
//
// A sentence counts as ANCHORED when it carries at least one specificity anchor:
// a number, inline code, a quoted term, or a proper noun (a non-opening
// capitalized token in Latin script; a Latin-script run inside CJK prose, where
// product and API names are the usual carriers). Everything else is portable.
//
// False-positive control is the whole reason this fires on a RUN rather than a
// sentence. A genuine one-line summary — a README intro, an abstract opener — is
// portable by nature and must stay cold, so the probe needs several portable
// sentences AND a portable majority before it says anything.

import { splitProseSentences, splitParagraphs } from './segment.js';

/** A single generic line is not a pattern; the probe needs a run. */
export const PORTABILITY_MIN_SENTENCES = 3;
export const PORTABILITY_MIN_PORTABLE = 3;
export const PORTABILITY_MIN_RATIO = 0.6;

/**
 * Registers where impersonal, swappable prose is CORRECT rather than a tell:
 * an academic abstract, a legal clause, or a formal report is supposed to
 * read without a personal point of view, so the portability probe stays quiet
 * there. Consumers (the inspect advisory and the rewrite hint) share this
 * list so detection and hinting never disagree.
 */
export const PORTABILITY_OMIT_TYPES = Object.freeze(['academic', 'medical', 'technical', 'legal', 'formal']);

export function omitsPortabilityAdvisory(documentType) {
  return PORTABILITY_OMIT_TYPES.includes(String(documentType || ''));
}

const CJK_LANGS = new Set(['ko', 'ja', 'zh']);

/**
 * Does this sentence carry at least one concrete anchor?
 *
 * @param {string} sentence
 * @param {string} lang
 * @returns {boolean}
 */
export function hasSpecificityAnchor(sentence, lang = 'en') {
  const text = String(sentence ?? '');
  if (!text.trim()) return false;
  // Numbers, inline code, and quoted terms anchor in every language.
  if (/\d/u.test(text)) return true;
  if (/`[^`]+`/u.test(text)) return true;
  if (/["\u201C][^"\u201D]{2,}["\u201D]/u.test(text)) return true;
  if (CJK_LANGS.has(lang)) {
    // In CJK prose a Latin-script run is almost always a product, API, or
    // company name — the anchor this probe is looking for.
    return /[A-Za-z]{2,}/u.test(text);
  }
  // Latin script: a capitalized token that is not the sentence opener.
  const tokens = text.trim().split(/\s+/u);
  for (let i = 1; i < tokens.length; i += 1) {
    const bare = tokens[i].replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
    if (bare.length >= 2 && /^\p{Lu}/u.test(bare)) return true;
  }
  return false;
}

/**
 * Assess how much of a text would survive swapping its subject.
 *
 * @param {string} text
 * @param {{ lang?: string }} [options]
 * @returns {{ trip: boolean, ratio: number, portableCount: number, sentenceCount: number, portableSentences: string[] }|null}
 */
export function assessPortability(text, { lang = 'en' } = {}) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const sentences = splitParagraphs(text)
    .flatMap((paragraph) => splitProseSentences(paragraph))
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  if (sentences.length < PORTABILITY_MIN_SENTENCES) return null;

  const portableSentences = sentences.filter((sentence) => !hasSpecificityAnchor(sentence, lang));
  const portableCount = portableSentences.length;
  const ratio = portableCount / sentences.length;
  const trip = portableCount >= PORTABILITY_MIN_PORTABLE && ratio >= PORTABILITY_MIN_RATIO;

  return {
    trip,
    ratio: Math.round(ratio * 100) / 100,
    portableCount,
    sentenceCount: sentences.length,
    portableSentences: trip ? portableSentences : [],
  };
}
