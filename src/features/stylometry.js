// Burstiness CV, MATTR, and dependency-free KO diagnostics per core/stylometry.md.
// Pure functions over token arrays; no I/O.

export const DEFAULT_BURSTINESS_BANDS = { low: 0.30, high: 0.50 };
export const DEFAULT_MATTR_BANDS = { low: 0.55, high: 0.70 };
export const DEFAULT_MATTR_WINDOW = 50;
export const DEFAULT_MIN_BURSTINESS_SENTENCES = 3;
export const DEFAULT_KO_DIAGNOSTIC_BANDS = {
  minSentences: 4,
  minEojeols: 20,
  spacing: {
    maxEojeolLengthCV: 0.40,
  },
  comma: {
    maxPerSentence: 0,
  },
  posProxy: {
    minMatchedCount: 8,
    maxClassDiversity: 0.34,
  },
};

const HANGUL_RE = /[\u3131-\u318e\uac00-\ud7a3]/u;
const COMMA_RE = /[,，、]/gu;

const KO_SUFFIX_GROUPS = [
  { className: 'quote', suffixes: ['라고', '이라고'] },
  { className: 'source', suffixes: ['에게서', '한테서', '으로부터', '로부터'] },
  { className: 'instrument', suffixes: ['으로써', '로써'] },
  { className: 'standard', suffixes: ['으로서', '로서'] },
  { className: 'topic', suffixes: ['은', '는'] },
  { className: 'subject', suffixes: ['이', '가', '께서'] },
  { className: 'object', suffixes: ['을', '를'] },
  { className: 'genitive', suffixes: ['의'] },
  { className: 'location', suffixes: ['에서', '에게', '한테', '께', '에'] },
  { className: 'direction', suffixes: ['으로', '로'] },
  { className: 'conjunction', suffixes: ['와', '과', '하고', '랑'] },
  { className: 'additive', suffixes: ['도', '또한'] },
  { className: 'delimiter', suffixes: ['만', '까지', '부터', '마다'] },
  { className: 'comparison', suffixes: ['보다', '처럼'] },
  { className: 'formal_ending', suffixes: ['습니다', '습니까', '합니다', '합니까', '입니다'] },
  { className: 'polite_ending', suffixes: ['어요', '아요', '예요', '이에요', '네요', '군요', '지요'] },
  { className: 'casual_ending', suffixes: ['죠', '네', '군'] },
  { className: 'declarative_ending', suffixes: ['한다', '된다', '했다', '였다', '이다', '있다', '없다'] },
];

const KO_SUFFIX_MATCHERS = KO_SUFFIX_GROUPS
  .flatMap((group) =>
    group.suffixes.map((suffix) => ({
      className: group.className,
      suffix,
      length: Array.from(suffix).length,
    }))
  )
  .sort((a, b) => b.length - a.length);

function mean(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function coefficientOfVariation(values) {
  if (!Array.isArray(values) || values.length < 2) return null;
  const avg = mean(values);
  if (!avg) return null;
  const variance = values.reduce((acc, x) => acc + (x - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance) / avg;
}

function cleanKoreanEojeol(chunk) {
  return chunk
    .normalize('NFC')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

function koreanEojeols(paragraph) {
  if (!paragraph) return [];
  return paragraph
    .split(/\s+/u)
    .map(cleanKoreanEojeol)
    .filter((token) => HANGUL_RE.test(token));
}

function koreanLength(token) {
  return Array.from(token.replace(/[^\u3131-\u318e\uac00-\ud7a3]/gu, '')).length;
}

// Coefficient of variation of sentence token counts.
// Returns null when the paragraph has fewer than 2 sentences or mean is 0.
export function burstinessCV(sentenceTokenCounts) {
  if (!Array.isArray(sentenceTokenCounts) || sentenceTokenCounts.length < 2) return null;
  const n = sentenceTokenCounts.length;
  const mean = sentenceTokenCounts.reduce((a, b) => a + b, 0) / n;
  if (mean === 0) return null;
  const variance =
    sentenceTokenCounts.reduce((acc, x) => acc + (x - mean) ** 2, 0) / n;
  return Math.sqrt(variance) / mean;
}

// Moving Average Type-Token Ratio (window default 50).
// Falls back to simple TTR when token count < window.
export function mattr(tokens, window = DEFAULT_MATTR_WINDOW) {
  if (!Array.isArray(tokens) || tokens.length === 0) return null;
  const lower = tokens.map((t) => t.toLowerCase());
  if (lower.length < window) {
    return new Set(lower).size / lower.length;
  }
  let sum = 0;
  let count = 0;
  for (let i = 0; i + window <= lower.length; i++) {
    const slice = lower.slice(i, i + window);
    sum += new Set(slice).size / window;
    count++;
  }
  return sum / count;
}

export function koreanSpacingFeatures(paragraph) {
  const eojeols = koreanEojeols(paragraph);
  const lengths = eojeols.map(koreanLength).filter((length) => length > 0);
  const eojeolCount = lengths.length;

  return {
    eojeolCount,
    meanEojeolLength: mean(lengths),
    eojeolLengthCV: coefficientOfVariation(lengths),
    singleSyllableRatio:
      eojeolCount > 0 ? lengths.filter((length) => length === 1).length / eojeolCount : null,
    longEojeolRatio:
      eojeolCount > 0 ? lengths.filter((length) => length >= 7).length / eojeolCount : null,
  };
}

export function commaDensity(paragraph, sentenceCount = null) {
  const commaCount = (paragraph.match(COMMA_RE) ?? []).length;
  const charCount = Array.from(paragraph.replace(/\s+/gu, '')).length;

  return {
    count: commaCount,
    perSentence: sentenceCount > 0 ? commaCount / sentenceCount : null,
    per100Chars: charCount > 0 ? (commaCount / charCount) * 100 : null,
  };
}

export function koreanPosDiversityProxy(paragraph) {
  const eojeols = koreanEojeols(paragraph);
  const matches = [];

  for (const token of eojeols) {
    const match = KO_SUFFIX_MATCHERS.find(
      (candidate) => token.length > candidate.suffix.length && token.endsWith(candidate.suffix)
    );
    if (match) {
      matches.push({ className: match.className, suffix: match.suffix });
    }
  }

  const matchedCount = matches.length;
  const classes = [...new Set(matches.map((match) => match.className))].sort();
  const suffixes = [...new Set(matches.map((match) => match.suffix))].sort();

  return {
    proxy: 'suffix',
    eojeolCount: eojeols.length,
    matchedCount,
    coverage: eojeols.length > 0 ? matchedCount / eojeols.length : null,
    distinctClassCount: classes.length,
    classDiversity: matchedCount > 0 ? classes.length / matchedCount : null,
    distinctSuffixCount: suffixes.length,
    suffixDiversity: matchedCount > 0 ? suffixes.length / matchedCount : null,
    classes,
  };
}

export function classifyKoreanDiagnostics({
  sentenceCount = 0,
  spacing,
  comma,
  posDiversity,
} = {}, bands = DEFAULT_KO_DIAGNOSTIC_BANDS) {
  const thresholds = mergeKoreanDiagnosticBands(bands);
  const reasons = [];

  const hasEnoughText =
    sentenceCount >= thresholds.minSentences &&
    (spacing?.eojeolCount ?? 0) >= thresholds.minEojeols;
  if (!hasEnoughText) {
    return { hot: false, strength: 0, reasons, thresholds };
  }

  const spacingStrength = lowThresholdStrength(
    spacing?.eojeolLengthCV,
    thresholds.spacing.maxEojeolLengthCV
  );
  if (spacingStrength > 0) reasons.push('regular-eojeol-length');

  const commaStrength = lowThresholdStrength(
    comma?.perSentence,
    thresholds.comma.maxPerSentence
  );
  if (commaStrength > 0) reasons.push('low-comma-density');

  const posHasCoverage =
    (posDiversity?.matchedCount ?? 0) >= thresholds.posProxy.minMatchedCount;
  const posStrength = posHasCoverage
    ? lowThresholdStrength(
        posDiversity?.classDiversity,
        thresholds.posProxy.maxClassDiversity
      )
    : 0;
  if (posStrength > 0) reasons.push('low-suffix-class-diversity');

  const componentStrengths = [spacingStrength, commaStrength, posStrength];
  const hot = componentStrengths.every((value) => value > 0);

  return {
    hot,
    strength: hot ? Math.min(...componentStrengths) : 0,
    reasons: hot ? reasons : [],
    thresholds,
  };
}

export function classifyBurstiness(cv, bands = DEFAULT_BURSTINESS_BANDS) {
  if (cv == null) return null;
  if (cv < bands.low) return 'low';
  if (cv > bands.high) return 'high';
  return 'mid';
}

export function classifyMattr(value, bands = DEFAULT_MATTR_BANDS) {
  if (value == null) return null;
  if (value < bands.low) return 'low';
  if (value > bands.high) return 'high';
  return 'mid';
}

function mergeKoreanDiagnosticBands(bands = {}) {
  return {
    minSentences: resolveNumber(bands.minSentences, DEFAULT_KO_DIAGNOSTIC_BANDS.minSentences),
    minEojeols: resolveNumber(bands.minEojeols, DEFAULT_KO_DIAGNOSTIC_BANDS.minEojeols),
    spacing: {
      maxEojeolLengthCV: resolveNumber(
        bands.spacing?.maxEojeolLengthCV,
        DEFAULT_KO_DIAGNOSTIC_BANDS.spacing.maxEojeolLengthCV
      ),
    },
    comma: {
      maxPerSentence: resolveNumber(
        bands.comma?.maxPerSentence,
        DEFAULT_KO_DIAGNOSTIC_BANDS.comma.maxPerSentence
      ),
    },
    posProxy: {
      minMatchedCount: resolveNumber(
        bands.posProxy?.minMatchedCount,
        DEFAULT_KO_DIAGNOSTIC_BANDS.posProxy.minMatchedCount
      ),
      maxClassDiversity: resolveNumber(
        bands.posProxy?.maxClassDiversity,
        DEFAULT_KO_DIAGNOSTIC_BANDS.posProxy.maxClassDiversity
      ),
    },
  };
}

function resolveNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function lowThresholdStrength(value, threshold) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  if (threshold === 0) return value <= 0 ? 100 : 0;
  if (!threshold || threshold < 0 || value > threshold) return 0;
  return Math.max(0, Math.min(100, (1 - value / threshold) * 100));
}
