// Short-form (SNS / marketing) punctuation tells — deterministic, LLM-free.
//
// The em-dash pattern (patterns/en-style.md #13) is an "overuse" rule: its
// long-form fire condition needs 1+ dash across 2+ consecutive paragraphs, so a
// one-paragraph tweet with a single em dash never fires and scores 0. That is
// correct for long prose, but in social/marketing short-form a single em dash is
// still a mild "AI-polished punctuation" tell a human reader notices.
//
// This module surfaces that WEAK signal without claiming the author is AI: it
// only activates for the `social`/`marketing` Document Type on short English input,
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

// Document types where clipped punctuation reads as an AI-polish tell.
const SHORT_FORM_DOCUMENT_TYPES = new Set(['social', 'marketing']);

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
    )
    // Numeric ranges (2020—2024, 10—20%) are span punctuation, not an aside.
    .replace(/\d\s*\u2014\s*(?=\d)/gu, ' ');
}

/** 2026 cadence pack (#879, parent #878): short-form phrasings that carry the tell alone. */
export const CADENCE_PHRASE_RES = Object.freeze([
  /\bthat matters\b/i,
  /\byou don't have\b[^.!?]{0,40}[.,]\s*you have\b/i,
]);

/** A "short punchy sentence" for stack purposes, in whitespace tokens. */
export const SHORT_STACK_MAX_TOKENS = 8;
export const SHORT_STACK_MIN_RUN = 4;
/** A tighter parallel fragment run ("Generic ideas. No point of view."). */
export const SET_GROUP_MAX_TOKENS = 5;
export const SET_GROUP_MIN_RUN = 3;

function tokenCount(sentence) {
  return String(sentence).trim().split(/\s+/u).filter(Boolean).length;
}

function longestRun(sentences, maxTokens) {
  let best = 0;
  let run = 0;
  for (const sentence of sentences) {
    if (tokenCount(sentence) <= maxTokens) {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best;
}

// An aside that carries neither a number nor a proper noun adds no information.
// Asides that DO carry one are ordinary punctuation and stay cold.
function hasInformationlessAside(text) {
  const asides = [...String(text).matchAll(/\u2014([^\u2014\n.!?]{1,60})/gu)].map((m) => m[1]);
  return asides.some((aside) => !/\d/u.test(aside) && !/\b[A-Z][a-z]{2,}/u.test(aside));
}

function hasAllCapsCloser(sentences) {
  const last = String(sentences[sentences.length - 1] ?? '').trim();
  return /\b[A-Z]{3,}[.!?]?$/u.test(last);
}

/**
 * Detect short-form (social/marketing) punctuation tells in English text.
 *
 * @param {string} text Raw input text.
 * @param {object} [options] Detection options.
 * @param {string} [options.lang='en'] Language code; only `en` is eligible.
 * @param {string} [options.documentType='default'] Active document type.
 * @param {object} [options.limits] Short-form size limits.
 * @returns {object} Short-form signal payload (never throws).
 */
export function detectEnglishShortFormTells(
  text,
  {
    lang = 'en',
    documentType = 'default',
    limits = DEFAULT_SHORT_FORM_LIMITS,
  } = {}
) {
  const normalized = String(text ?? '').normalize('NFC');
  const paragraphs = splitParagraphs(normalized);
  const sentences = paragraphs.flatMap((p) => splitProseSentences(p));
  const nonWhitespaceChars = normalized.replace(/\s/gu, '').length;
  const documentTypeEligible = SHORT_FORM_DOCUMENT_TYPES.has(String(documentType).toLowerCase());

  const eligible =
    lang === 'en' &&
    documentTypeEligible &&
    nonWhitespaceChars <= limits.maxNonWhitespaceChars &&
    sentences.length >= 1 &&
    sentences.length <= limits.maxProseSentences;

  const countable = removeIgnoredDashContexts(normalized);
  const emDashCount = (countable.match(/\u2014/gu) ?? []).length;

  // 2026 cadence combination. Fires only on CO-OCCURRING structural signals, or on
  // a short-form phrase that carries the tell by itself — a lone dash or a single
  // short sentence must never be enough (#879 false-positive risk).
  const cadenceSignals = [];
  if (longestRun(sentences, SHORT_STACK_MAX_TOKENS) >= SHORT_STACK_MIN_RUN) cadenceSignals.push('short-stack');
  if (longestRun(sentences, SET_GROUP_MAX_TOKENS) >= SET_GROUP_MIN_RUN) cadenceSignals.push('set-group');
  if (hasInformationlessAside(countable)) cadenceSignals.push('empty-aside');
  if (hasAllCapsCloser(sentences)) cadenceSignals.push('all-caps-closer');
  const phraseHit = CADENCE_PHRASE_RES.some((re) => re.test(normalized));
  if (phraseHit) cadenceSignals.push('short-form-phrase');
  const structuralCount = cadenceSignals.filter((name) => name !== 'short-form-phrase').length;
  const cadenceDetected = eligible && (structuralCount >= 2 || phraseHit);
  // Always outranks the lone-dash weak signal (severity 1) when it fires at all.
  const cadenceSeverity = cadenceDetected ? Math.min(3, Math.max(2, structuralCount)) : 0;
  // 1 -> Low, 2 -> Medium, 3+ -> High. Only when eligible; otherwise inert.
  const severity = eligible ? Math.min(3, emDashCount) : 0;

  return {
    eligible,
    documentType,
    nonWhitespaceChars,
    sentenceCount: sentences.length,
    emDash: {
      detected: severity > 0,
      count: emDashCount,
      perSentence: sentences.length > 0 ? emDashCount / sentences.length : 0,
      severity,
    },
    cadence: {
      detected: cadenceDetected,
      severity: cadenceSeverity,
      signals: cadenceDetected ? cadenceSignals : [],
    },
  };
}
