// Short-form (SNS / marketing) punctuation tells — deterministic, LLM-free.
//
// The em-dash pattern (patterns/en-style.md #13) is an "overuse" rule: its
// long-form fire condition needs 1+ dash across 2+ consecutive paragraphs, so a
// one-paragraph tweet with a single em dash never fires and scores 0. That is
// correct for long prose, but in social/marketing short-form a single em dash is
// still a mild "AI-polished punctuation" tell a human reader notices.
//
// This module surfaces that WEAK signal without claiming the author is AI: it
// only activates for the `social`/`marketing` register on short English input,
// records the em-dash count and per-sentence density, and maps 1/2/3+ dashes to
// Low/Medium/High severity. It is intentionally kept OUT of the structural
// feature vector (src/features/structural-features.js) so it cannot shift the
// dimensions of an already-trained private structural model.
//
// Kept separate from the coarse per-paragraph hot ratio: the scorer routes this
// through a small calibrated evidence floor (src/scoring.js
// computeShortFormEvidenceFloor), never through paragraph.hot, so one dash in a
// one-paragraph reply cannot manufacture a 100.

import { splitParagraphs, splitProseSentences } from './segment.js';

export const DEFAULT_SHORT_FORM_LIMITS = Object.freeze({
  maxNonWhitespaceChars: 200,
  maxProseSentences: 4,
});

// Registers/profiles where clipped punctuation reads as an AI-polish tell.
const SHORT_FORM_PROFILES = new Set(['social', 'marketing']);

// Remove dash contexts that are legitimate even in short-form: fenced/inline
// code and em dashes inside quoted dialogue (interrupted speech). Everything
// else is a "countable" prose dash.
function removeIgnoredDashContexts(text) {
  return String(text ?? '')
    // Fenced then inline code — never prose punctuation.
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/`[^`\n]*`/gu, ' ')
    // Conservative quoted-dialogue exclusion for paired straight/curly quotes.
    .replace(/["\u201C][^"\u201D\n]*\u2014[^"\u201D\n]*["\u201D]/gu, (span) =>
      span.replace(/\u2014/gu, ' ')
    );
}

/**
 * Detect short-form (social/marketing) punctuation tells in English text.
 *
 * @param {string} text Raw input text.
 * @param {object} [options] Detection options.
 * @param {string} [options.lang='en'] Language code; only `en` is eligible.
 * @param {string} [options.profile='default'] Active profile.
 * @param {string|null} [options.register=null] Explicit register override.
 * @param {object} [options.limits] Short-form size limits.
 * @returns {object} Short-form signal payload (never throws).
 */
export function detectEnglishShortFormTells(
  text,
  {
    lang = 'en',
    profile = 'default',
    register = null,
    limits = DEFAULT_SHORT_FORM_LIMITS,
  } = {}
) {
  const normalized = String(text ?? '').normalize('NFC');
  const paragraphs = splitParagraphs(normalized);
  const sentences = paragraphs.flatMap((p) => splitProseSentences(p));
  const nonWhitespaceChars = [...normalized.replace(/\s/gu, '')].length;

  const registerEligible =
    register === 'social' ||
    SHORT_FORM_PROFILES.has(String(profile).toLowerCase());

  const eligible =
    lang === 'en' &&
    registerEligible &&
    nonWhitespaceChars <= limits.maxNonWhitespaceChars &&
    sentences.length >= 1 &&
    sentences.length <= limits.maxProseSentences;

  const countable = removeIgnoredDashContexts(normalized);
  const emDashCount = (countable.match(/\u2014/gu) ?? []).length;
  // 1 -> Low, 2 -> Medium, 3+ -> High. Only when eligible; otherwise inert.
  const severity = eligible ? Math.min(3, emDashCount) : 0;

  return {
    eligible,
    profile,
    register,
    nonWhitespaceChars,
    sentenceCount: sentences.length,
    emDash: {
      detected: severity > 0,
      count: emDashCount,
      perSentence: sentences.length > 0 ? emDashCount / sentences.length : 0,
      severity,
    },
  };
}
