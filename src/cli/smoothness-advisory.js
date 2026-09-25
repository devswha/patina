/**
 * Advisory smoothness floor for rewrite OUTPUT. Warning only: never changes
 * exit codes, scoring, or the rewrite text, and the detector/benchmark must not
 * import it. It trips when sentence-length CV falls below the shipped
 * burstiness low band (read here, never retuned), or when line-length CV and
 * line-ending entropy are both extremely low (which verse can false-trip).
 * Texts under 3 sentences or 3 lines are skipped. Opt out with
 * `smoothness-floor: false`.
 */

import { burstinessCV, DEFAULT_BURSTINESS_BANDS } from '../features/stylometry.js';
import { splitTextSentences, tokenize } from '../features/segment.js';

const MIN_SENTENCES = 3;
const MIN_LINES = 3;
/** Advisory-only: almost-flat line lengths. Not a production detection band. */
const LINE_LENGTH_CV_EXTREME = 0.08;
/** Advisory-only: almost-one line-ending class, in bits. */
const LINE_ENDING_ENTROPY_EXTREME = 0.40;

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
function assessSmoothnessFloor(text, { lang = 'en' } = {}) {
  const sentences = splitTextSentences(text);
  const lines = collectLines(text);
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

function collectLines(text) {
  return String(text ?? '')
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
  if (values.length === 0) return null;
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
