// Inspect-only discourse advisories. These never enter analyzeText().hot or
// the deterministic score. Pairwise checks skip when rewrite text is absent.

import { splitParagraphs, splitProseSentences, tokenize } from './features/segment.js';
import { assessPortability } from './features/portability.js';

export const COMPLETENESS_OMIT_TYPES = Object.freeze(['academic', 'medical', 'technical']);
export const STAR_EVENNESS_TYPES = Object.freeze(['personal-statement', 'project-writeup']);
/**
 * Registers where impersonal, swappable prose is CORRECT rather than a tell: an
 * academic abstract, a legal clause, or a formal report is supposed to read
 * without a personal point of view, so the portability probe stays quiet there.
 */
export const PORTABILITY_OMIT_TYPES = Object.freeze(['academic', 'medical', 'technical', 'legal', 'formal']);

export function omitsPortabilityAdvisory(documentType) {
  return PORTABILITY_OMIT_TYPES.includes(String(documentType || ''));
}

const CODA_RE = /배웠|깨달|의미가 있|그래서 중요한|This taught me|I learned that|\bI learned\b|the takeaway|takeaway is/i;
const HEADING_RE = /^#{1,6}\s+\S/;
const BULLET_RE = /^\s*(?:[-*+]|\d+[.)]|[가-힣][.)])\s+/;

const STAR_CUES = Object.freeze({
  s: /상황|배경|\bSituation\b|\bBackground\b|\bContext\b/i,
  t: /과제|\bTask\b|\bGoal\b/i,
  a: /방법|조치|\bAction\b|\bMethod\b/i,
  r: /결과|성과|\bResult\b|\bOutcome\b/i,
  lesson: /배웠|깨달|교훈|\bI learned\b|This taught|takeaway|\blesson\b/i,
});

export function omitsCompletenessAdvisories(documentType) {
  return COMPLETENESS_OMIT_TYPES.includes(String(documentType || ''));
}

export function allowsStarEvenness(documentType) {
  return STAR_EVENNESS_TYPES.includes(String(documentType || ''));
}

export function isLessonCoda(sentence) {
  return CODA_RE.test(String(sentence || ''));
}

function tokenSet(text, lang) {
  return new Set(tokenize(String(text || ''), { lang }).map((token) => token.toLowerCase()));
}

function jaccard(left, right) {
  if (left.size === 0 && right.size === 0) return 1;
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }
  return overlap / Math.max(1, left.size + right.size - overlap);
}

export function classifyDiscourseShape(text) {
  const source = String(text || '');
  const lines = source.split(/\r?\n/).filter((line) => line.trim());
  const headings = lines.filter((line) => HEADING_RE.test(line)).length;
  const bullets = lines.filter((line) => BULLET_RE.test(line)).length;
  const paragraphs = splitParagraphs(source);
  const closer = paragraphs.slice(-2).join('\n');
  const hasLesson = isLessonCoda(closer);
  if (headings > 0 && bullets >= 3 && !hasLesson) return 'headed-notes';
  if (headings === 0 && paragraphs.length >= 3 && hasLesson) return 'complete-prose';
  return 'other';
}

/**
 * Source→rewrite 0:1 lesson coda. Fires when the rewrite closer is a lesson
 * sentence with low overlap to every source sentence.
 *
 * @param {string} source
 * @param {string} rewrite
 * @param {{lang?: string}} [options]
 * @returns {{code: string, overlap: number, sentence: string}|null}
 */
export function detectInventedLessonCoda(source, rewrite, { lang = 'en' } = {}) {
  if (!source || !rewrite) return null;
  const rewriteSentences = splitProseSentences(rewrite);
  const sourceSentences = splitProseSentences(source);
  if (sourceSentences.length === 0 || rewriteSentences.length === 0) return null;
  const tail = rewriteSentences.slice(-2);
  let lowestOverlap = 1;
  let matched = null;
  for (const sentence of tail) {
    if (!isLessonCoda(sentence)) continue;
    const rewriteTokens = tokenSet(sentence, lang);
    const overlap = Math.max(
      ...sourceSentences.map((candidate) => jaccard(rewriteTokens, tokenSet(candidate, lang))),
    );
    if (overlap < lowestOverlap) {
      lowestOverlap = overlap;
      matched = sentence;
    }
  }
  if (!matched || lowestOverlap >= 0.28) return null;
  return {
    code: 'invented-lesson-coda',
    overlap: Number(lowestOverlap.toFixed(3)),
    sentence: matched,
  };
}

function classifyStarParagraph(paragraph) {
  for (const [role, pattern] of Object.entries(STAR_CUES)) {
    if (pattern.test(paragraph)) return role;
  }
  return null;
}

/**
 * STAR + lesson evenness. Fires only when S/T/A/R and a lesson are all
 * present and token shares are even. Does not flag STAR itself, uneven
 * human STAR, or 문제/방법/결과 notes without a lesson.
 *
 * @param {string} text
 * @param {{lang?: string}} [options]
 * @returns {{code: string, shares: Record<string, number>}|null}
 */
export function detectStarEvenness(text, { lang = 'en' } = {}) {
  const paragraphs = splitParagraphs(text);
  const tokens = { s: 0, t: 0, a: 0, r: 0, lesson: 0 };
  for (const paragraph of paragraphs) {
    const role = classifyStarParagraph(paragraph);
    if (!role) continue;
    tokens[role] += tokenize(paragraph, { lang }).length;
  }
  const values = Object.values(tokens);
  if (values.some((count) => count <= 0)) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max / min > 1.75) return null;
  const total = values.reduce((sum, count) => sum + count, 0);
  const shares = Object.fromEntries(
    Object.entries(tokens).map(([role, count]) => [role, Number((count / total).toFixed(3))]),
  );
  return { code: 'star-evenness', shares };
}

export function collectInspectionAdvisories(text, {
  language = 'en',
  documentType = 'default',
  rewrite = null,
} = {}) {
  const advisories = [];
  if (!omitsCompletenessAdvisories(documentType) && rewrite) {
    const coda = detectInventedLessonCoda(text, rewrite, { lang: language });
    if (coda) {
      advisories.push({
        code: coda.code,
        severity: 'advisory',
        scope: 'document',
        message: 'Rewrite ends with a lesson closer that does not overlap any source sentence.',
        overlap: coda.overlap,
      });
    }
  }
  if (allowsStarEvenness(documentType)) {
    const star = detectStarEvenness(text, { lang: language });
    if (star) {
      advisories.push({
        code: star.code,
        severity: 'advisory',
        scope: 'document',
        message: 'S/T/A/R and a lesson are all present with even token shares.',
        shares: star.shares,
      });
    }
  }
  // #881: point-of-view absence. Detect only — the rewrite-side version of this
  // idea failed Study 4 (H-4b not supported, meaning gate violated 50/54), so the
  // probe reports and never asks the rewriter to invent a missing detail.
  const portability = omitsPortabilityAdvisory(documentType) ? null : assessPortability(text, { lang: language });
  if (portability?.trip) {
    advisories.push({
      code: 'portable-generic-prose',
      severity: 'advisory',
      scope: 'document',
      message: 'Most sentences would stay true if the product, company, or person were swapped; the draft carries little point of view.',
      portableCount: portability.portableCount,
      sentenceCount: portability.sentenceCount,
      ratio: portability.ratio,
    });
  }
  return advisories;
}
