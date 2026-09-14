/**
 * Advisory smoothness floor for rewrite OUTPUT (ROADMAP Quality Phase 3).
 *
 * Warning only: never changes exit codes, scoring, or rewrite text.
 * `analyzeText` / `src/features/analyzer.js` / the benchmark MUST NOT import
 * this module — the floor is a CLI rewrite note, not a detector claim.
 *
 * Primary trip: sentence-length CV via reused `burstinessCV` falls below the
 * existing burstiness *low* band (`DEFAULT_BURSTINESS_BANDS.low` = 0.30).
 * That band is a shipped detection-side threshold; this advisory only reads
 * it. Do not retune production burstiness bands from here.
 *
 * Secondary trip: line-length CV AND line-ending entropy are both extremely
 * low. Conservative advisory-only constants (not detection thresholds):
 *   LINE_LENGTH_CV_EXTREME      = 0.08
 *   LINE_ENDING_ENTROPY_EXTREME = 0.40 bits (Shannon, log2)
 *
 * Skip when the text has fewer than 3 sentences or 3 non-empty lines (same
 * spirit as the over-editing guard: too short to judge).
 * Opt out with `smoothness-floor: false`. A missing key is enabled.
 *
 * Line-length CV reuses `burstinessCV` on per-line character counts.
 * Line-ending entropy is a local Shannon entropy of the last non-whitespace
 * character of each non-empty line — implemented here, not borrowed from
 * gn-voice (no NOTICE credit).
 *
 * Failure modes (advisory stays silent or can false-trip):
 * - Short texts (< 3 sentences or < 3 lines): skip.
 * - Markdown/list-heavy output: list lines are stripped from prose sentence
 *   samples, so a list-only rewrite often looks too short and is skipped.
 * - Poetry / song lyric / tightly metered lines: similar line lengths plus
 *   a repeated line-ending character can trip the secondary check.
 */

import { burstinessCV, DEFAULT_BURSTINESS_BANDS } from '../features/stylometry.js';
import { splitParagraphs, splitProseSentences, tokenize } from '../features/segment.js';

export const MIN_SENTENCES = 3;
export const MIN_LINES = 3;
/** Advisory-only: almost-flat line lengths. Not a production detection band. */
export const LINE_LENGTH_CV_EXTREME = 0.08;
/** Advisory-only: almost-one line-ending class, in bits. */
export const LINE_ENDING_ENTROPY_EXTREME = 0.40;

/**
 * Warn when rewrite output looks unusually even. Advisory only.
 *
 * @param {{ text?: string, config?: object, logger?: { warn?: Function }, lang?: string }} [opts]
 * @returns {object|null} Assessment when the warning fires; otherwise null.
 */
export function warnIfTooSmooth({ text, config = {}, logger, lang = 'en' } = {}) {
  if (config['smoothness-floor'] === false) return null;
  try {
    const assessment = assessSmoothnessFloor(text, { lang });
    if (!assessment?.trip) return null;
    logger?.warn?.('rewrite.smoothness_floor', {
      message: '[patina] smoothness floor: rewrite output looks unusually even '
        + `(${assessment.reasons.join(', ')}). Advisory only; output is unchanged. `
        + 'Disable this note with `smoothness-floor: false`.',
    });
    return assessment;
  } catch {
    return null; // the advisory must never break a rewrite
  }
}

/**
 * @param {string} text
 * @param {{ lang?: string }} [opts]
 * @returns {{ trip: boolean, reasons: string[], sentenceCv: number|null, lineCv: number|null, lineEndingEntropy: number|null }|null}
 */
export function assessSmoothnessFloor(text, { lang = 'en' } = {}) {
  const source = typeof text === 'string' ? text : '';
  const sentences = collectSentences(source);
  const lines = collectLines(source);
  if (sentences.length < MIN_SENTENCES || lines.length < MIN_LINES) return null;

  const sentenceTokenCounts = sentences
    .map((sentence) => tokenize(sentence, { lang }).length)
    .filter((count) => count > 0);
  const lineLengths = lines.map(characterLength);
  const endings = lines.map(lastNonWhitespaceChar).filter((ch) => ch != null);

  const sentenceCv = burstinessCV(sentenceTokenCounts);
  const lineCv = burstinessCV(lineLengths);
  const lineEndingEntropy = shannonEntropy(endings);

  const reasons = [];
  if (sentenceCv != null && sentenceCv < DEFAULT_BURSTINESS_BANDS.low) {
    reasons.push(`sentence-length CV ${formatMetric(sentenceCv)} below burstiness low band ${DEFAULT_BURSTINESS_BANDS.low}`);
  }
  const lineRhythmExtreme =
    lineCv != null
    && lineEndingEntropy != null
    && lineCv < LINE_LENGTH_CV_EXTREME
    && lineEndingEntropy < LINE_ENDING_ENTROPY_EXTREME;
  if (lineRhythmExtreme) {
    reasons.push(
      `line-length CV ${formatMetric(lineCv)} and line-ending entropy ${formatMetric(lineEndingEntropy)} both extremely low`
    );
  }
  if (reasons.length === 0) return null;
  return { trip: true, reasons, sentenceCv, lineCv, lineEndingEntropy };
}

function collectSentences(text) {
  const paragraphs = splitParagraphs(text);
  if (paragraphs.length === 0) return [];
  return paragraphs.flatMap((paragraph) => splitProseSentences(paragraph));
}

function collectLines(text) {
  return String(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function characterLength(line) {
  return Array.from(line).length;
}

function lastNonWhitespaceChar(line) {
  const chars = Array.from(line);
  return chars.length > 0 ? chars[chars.length - 1] : null;
}

function shannonEntropy(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const counts = new Map();
  for (const value of values) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  const n = values.length;
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / n;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function formatMetric(value) {
  return Number(value).toFixed(2);
}
