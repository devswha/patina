import { FAKE_CANDOR_MIN, THEMATIC_BREAK_MIN } from './discourse-tells.js';
import { DEFAULT_LEXICON_DENSITY_THRESHOLD } from './lexicon-core.js';
import { DEFAULT_BURSTINESS_BANDS, DEFAULT_MATTR_BANDS } from './stylometry.js';

/**
 * Average the strongest deterministic signal for each paragraph.
 *
 * This is diagnostic-only. It intentionally does not replace the existing
 * hot-paragraph ratio used by gates and reconciliation.
 *
 * @param {object[]} [paragraphs] Analyzer paragraph payloads.
 * @param {object} [options] Thresholds used by the analyzer.
 * @returns {number} 0..100 average signal strength.
 */
export function summarizeSignalStrength(paragraphs = [], options = {}) {
  if (!Array.isArray(paragraphs) || paragraphs.length === 0) return 0;
  const total = paragraphs.reduce(
    (sum, paragraph) => sum + paragraphSignalStrength(paragraph, options),
    0
  );
  return total / paragraphs.length;
}

/**
 * Score how deep a paragraph is inside its strongest deterministic trigger.
 *
 * @param {object} [paragraph] Analyzer paragraph payload.
 * @param {object} [options] Thresholds used by the analyzer.
 * @returns {number} 0..100 paragraph signal strength.
 */
export function paragraphSignalStrength(paragraph = {}, options = {}) {
  const burstiness = lowBandStrength(
    paragraph.burstiness?.cv,
    resolveLowThreshold(options.burstinessBands, DEFAULT_BURSTINESS_BANDS.low),
    paragraph.burstiness?.band
  );
  const mattr = lowBandStrength(
    paragraph.mattr?.value,
    resolveLowThreshold(options.mattrBands, DEFAULT_MATTR_BANDS.low),
    paragraph.mattr?.band
  );
  const lexicon = highThresholdStrength(
    paragraph.lexicon?.density,
    resolveThreshold(
      options.lexiconDensityThreshold,
      DEFAULT_LEXICON_DENSITY_THRESHOLD
    ),
    paragraph.lexicon?.hot
  );
  const koDiagnostics =
    paragraph.koDiagnostics?.hot &&
    typeof paragraph.koDiagnostics?.strength === 'number' &&
    Number.isFinite(paragraph.koDiagnostics.strength)
      ? paragraph.koDiagnostics.strength
      : 0;
  // Discourse-tell attribution (#391): candorHot/thematicBreakHot make a
  // paragraph hot, so they must carry strength here too — otherwise a
  // discourse-only hot paragraph would rank at 0, contradicting the hot
  // verdict. Strength is the paragraph's tell count normalized by the
  // document density gate (FAKE_CANDOR_MIN / THEMATIC_BREAK_MIN): a paragraph
  // carrying enough tells to clear the gate alone scores 100.
  const discourse = Math.max(
    discourseTellStrength(paragraph.candorHot, paragraph.candorCount, FAKE_CANDOR_MIN),
    discourseTellStrength(
      paragraph.thematicBreakHot,
      paragraph.thematicBreakCount,
      THEMATIC_BREAK_MIN
    )
  );
  return Math.max(burstiness, mattr, lexicon, koDiagnostics, discourse);
}

function discourseTellStrength(isHot, count, docThreshold) {
  if (!isHot) return 0;
  if (!docThreshold || docThreshold <= 0) return 0;
  // Hot implies >= 1 carried tell; floor the count so older payloads without
  // counts still register a nonzero strength.
  const carried = Math.max(
    typeof count === 'number' && Number.isFinite(count) ? count : 0,
    1
  );
  return clampPercent((carried / docThreshold) * 100);
}

function resolveLowThreshold(bands, fallback) {
  return resolveThreshold(bands?.low, fallback);
}

function resolveThreshold(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function lowBandStrength(value, threshold, band) {
  if (band !== 'low' || typeof value !== 'number' || !Number.isFinite(value)) return 0;
  if (!threshold || threshold <= 0) return 0;
  return clampPercent((1 - value / threshold) * 100);
}

function highThresholdStrength(value, threshold, isHot) {
  if (!isHot || typeof value !== 'number' || !Number.isFinite(value)) return 0;
  if (!threshold || threshold <= 0) return 0;
  return clampPercent(((value - threshold) / threshold) * 100);
}

function clampPercent(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}
