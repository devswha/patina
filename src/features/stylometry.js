// Burstiness CV, MATTR, and dependency-free KO diagnostics per core/stylometry.md.
// Pure functions over token arrays; no I/O.
import { splitParagraphs, splitProseSentences } from './segment.js';
// Interference regexes are owned by catalog/ko-interference.js — never inline
// a copy here; the catalog-consumption test pins these call sites.
import { buildKoInterferenceRegex } from './catalog/ko-interference.js';

export const DEFAULT_BURSTINESS_BANDS = { low: 0.30, high: 0.50 };
export const DEFAULT_MATTR_BANDS = { low: 0.55, high: 0.70 };
export const DEFAULT_MATTR_WINDOW = 50;
export const DEFAULT_MIN_BURSTINESS_SENTENCES = 3;
export const DEFAULT_KO_DIAGNOSTIC_BANDS = {
  minSentences: 4,
  minEojeols: 20,
  spacing: {
    maxEojeolLengthCV: 0.38,
  },
  comma: {
    maxPerSentence: 1,
  },
  posProxy: {
    minMatchedCount: 10,
    maxClassDiversity: 0.26,
  },
};
export const KO_POST_EDITESE_SCHEMA = 'koPostEditese.v1';

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

const POST_EDITESE_ENDING_SUFFIXES = [
  '습니다', '습니까', '합니다', '합니까', '입니다', '어요', '아요', '예요', '이에요',
  '네요', '군요', '지요', '죠', '한다', '된다', '했다', '였다', '이다', '있다',
  '없다', '왔다', '봤다', '다',
].sort((a, b) => Array.from(b).length - Array.from(a).length);
// Canonical token for regular formal '-ㅂ니다 / -ㅂ니까' endings (됩니다, 줍니다, 합니까…)
// whose ㅂ marker fuses into the stem syllable and so isn't a literal suffix.
const POST_EDITESE_FORMAL_NIDA = 'ㅂ니다';
const POST_EDITESE_FORMAL_ENDINGS = new Set(['습니다', '습니까', '합니다', '합니까', '입니다', POST_EDITESE_FORMAL_NIDA]);
const POST_EDITESE_POLITE_ENDINGS = new Set(['어요', '아요', '예요', '이에요', '네요', '군요', '지요', '죠']);
const POST_EDITESE_DECLARATIVE_DA_ENDINGS = new Set(['한다', '된다', '했다', '였다', '이다', '있다', '없다', '왔다', '봤다', '다']);

const POST_EDITESE_RELATIVE_CLAUSE_PROXY_RE = /[가-힣]+(?:하는|되는|받는|받은|쓰인|되어진|보여진|한|할|된|될|던|운|온|인|힌|진|린|킨|쓴)\s+[가-힣]+/g;
const POST_EDITESE_PROGRESSIVE_ASPECT_RE = /고\s*있(?:다|습니다|는|었|으|고|지|기)?/g;

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

export function koreanPostEditeseFeatures(text, opts = {}) {
  const lang = opts.lang ?? 'ko';
  const str = typeof text === 'string' ? text.normalize('NFC') : '';
  if (lang !== 'ko') return skippedKoPostEditese(lang, 'non-ko');
  if (str.trim().length === 0) return skippedKoPostEditese(lang, 'empty');

  const paragraphs = splitParagraphs(str);
  const totalEojeols = koreanEojeols(str);
  if (totalEojeols.length === 0) return skippedKoPostEditese(lang, 'no-hangul-eojeols');

  const paragraphRows = paragraphs.map((paragraph, index) => buildKoPostEditeseRow(paragraph, `P${index + 1}`));
  const docSentences = paragraphs.flatMap((paragraph) => splitProseSentences(paragraph));
  return {
    schema: KO_POST_EDITESE_SCHEMA,
    lang,
    analyzed: true,
    skipReason: null,
    paragraphCount: paragraphRows.length,
    sentenceCount: docSentences.length,
    eojeolCount: totalEojeols.length,
    metrics: buildKoPostEditeseMetrics(str, docSentences),
    paragraphs: paragraphRows,
  };
}

function skippedKoPostEditese(lang, skipReason) {
  return {
    schema: KO_POST_EDITESE_SCHEMA,
    lang,
    analyzed: false,
    skipReason,
    paragraphCount: 0,
    sentenceCount: 0,
    eojeolCount: 0,
    metrics: zeroKoPostEditeseMetrics(),
    paragraphs: [],
  };
}

function zeroKoPostEditeseMetrics() {
  return {
    lexical: {
      tokenCount: 0,
      typeCount: 0,
      ttr: null,
      mattr: null,
      endingTypeCount: 0,
      endingDiversity: null,
    },
    endings: {
      declarativeDaCount: 0,
      declarativeDaRatio: null,
      handaCount: 0,
      doendaCount: 0,
      idaCount: 0,
      formalEndingCount: 0,
      politeEndingCount: 0,
      endingStreakMax: 0,
    },
    interference: {
      pronounLiteralCount: 0,
      doubleParticleCount: 0,
      progressiveAspectCount: 0,
      lightVerbCount: 0,
      byPassiveCount: 0,
      doublePassiveCount: 0,
      connectiveCommaCount: 0,
      relativeClauseProxyCount: 0,
    },
    rhythm: {
      meanSentenceEojeols: null,
      sentenceEojeolCV: null,
      meanEojeolLength: null,
      eojeolLengthCV: null,
      commaPerSentence: null,
      commaPer100Chars: null,
      suffixMatchedCount: 0,
      suffixClassDiversity: null,
      suffixDiversity: null,
    },
  };
}

function buildKoPostEditeseRow(paragraph, id) {
  const sentences = splitProseSentences(paragraph);
  const eojeols = koreanEojeols(paragraph);
  return {
    id,
    sentenceCount: sentences.length,
    eojeolCount: eojeols.length,
    metrics: buildKoPostEditeseMetrics(paragraph, sentences),
  };
}

function buildKoPostEditeseMetrics(text, sentences = splitProseSentences(text)) {
  const eojeols = koreanEojeols(text);
  const lowerEojeols = eojeols.map((token) => token.toLowerCase());
  const typeCount = new Set(lowerEojeols).size;
  const lengths = eojeols.map(koreanLength).filter((length) => length > 0);
  const endings = sentences.map(extractSentenceEnding).filter(Boolean);
  const endingTypeCount = new Set(endings).size;
  const suffixStats = koPostEditeseSuffixStats(eojeols);
  const comma = commaDensity(text, sentences.length);
  const sentenceEojeolCounts = sentences
    .map((sentence) => koreanEojeols(sentence).length)
    .filter((count) => count > 0);

  return {
    lexical: {
      tokenCount: eojeols.length,
      typeCount,
      ttr: ratio(typeCount, eojeols.length),
      mattr: roundMetric(mattr(eojeols)),
      endingTypeCount,
      endingDiversity: ratio(endingTypeCount, sentences.length),
    },
    endings: buildKoPostEditeseEndings(endings),
    interference: {
      pronounLiteralCount: countPattern(text, buildKoInterferenceRegex('a16-pronoun-literal')),
      doubleParticleCount: countPattern(text, buildKoInterferenceRegex('a19-double-particle')),
      progressiveAspectCount: countPattern(text, POST_EDITESE_PROGRESSIVE_ASPECT_RE),
      lightVerbCount: countPattern(text, buildKoInterferenceRegex('a7-light-verb')),
      byPassiveCount: countPattern(text, buildKoInterferenceRegex('passive-e-uihae')),
      doublePassiveCount: countPattern(text, buildKoInterferenceRegex('a8-double-passive')),
      connectiveCommaCount: countPattern(text, buildKoInterferenceRegex('c11-connective-comma')),
      relativeClauseProxyCount: countPattern(text, POST_EDITESE_RELATIVE_CLAUSE_PROXY_RE),
    },
    rhythm: {
      meanSentenceEojeols: ratio(eojeols.length, sentences.length),
      sentenceEojeolCV: roundMetric(coefficientOfVariation(sentenceEojeolCounts)),
      meanEojeolLength: roundMetric(mean(lengths)),
      eojeolLengthCV: roundMetric(coefficientOfVariation(lengths)),
      commaPerSentence: roundMetric(comma.perSentence),
      commaPer100Chars: roundMetric(comma.per100Chars),
      suffixMatchedCount: suffixStats.matchedCount,
      suffixClassDiversity: roundMetric(suffixStats.classDiversity),
      suffixDiversity: roundMetric(suffixStats.suffixDiversity),
    },
  };
}

function buildKoPostEditeseEndings(endings) {
  const declarativeDaCount = endings.filter((ending) => POST_EDITESE_DECLARATIVE_DA_ENDINGS.has(ending)).length;
  return {
    declarativeDaCount,
    declarativeDaRatio: ratio(declarativeDaCount, endings.length),
    handaCount: endings.filter((ending) => ending === '한다').length,
    doendaCount: endings.filter((ending) => ending === '된다').length,
    idaCount: endings.filter((ending) => ending === '이다').length,
    formalEndingCount: endings.filter((ending) => POST_EDITESE_FORMAL_ENDINGS.has(ending)).length,
    politeEndingCount: endings.filter((ending) => POST_EDITESE_POLITE_ENDINGS.has(ending)).length,
    endingStreakMax: maxDeclarativeDaStreak(endings),
  };
}

function extractSentenceEnding(sentence) {
  const eojeol = koreanEojeols(sentence).at(-1);
  if (!eojeol) return null;
  const matched = POST_EDITESE_ENDING_SUFFIXES.find((ending) => eojeol.endsWith(ending)) ?? null;
  // Regular formal '-ㅂ니다 / -ㅂ니까' (됩니다, 표시됩니다, 합니까…) fuse the ㅂ marker into
  // the stem syllable, so they fall through to the bare '다' bucket and get miscounted as
  // declarative '-다' style. Reclassify them as a formal ending.
  if ((matched === '다' || matched === null) && isFormalFusedEnding(eojeol)) {
    return POST_EDITESE_FORMAL_NIDA;
  }
  return matched;
}

// True for '-ㅂ니다 / -ㅂ니까' formal endings: the syllable before 니다/니까 carries a ㅂ
// jongseong (batchim index 17). Distinguishes 됩니다/아닙니다 (formal) from 아니다 (plain).
function isFormalFusedEnding(eojeol) {
  const m = /(.)(?:니다|니까)$/.exec(eojeol);
  if (!m) return false;
  const code = m[1].charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 === 17;
}

function maxDeclarativeDaStreak(endings) {
  let current = 0;
  let max = 0;
  for (const ending of endings) {
    if (POST_EDITESE_DECLARATIVE_DA_ENDINGS.has(ending)) {
      current += 1;
      max = Math.max(max, current);
    } else {
      current = 0;
    }
  }
  return max;
}

function koPostEditeseSuffixStats(eojeols) {
  const matches = [];
  for (const token of eojeols) {
    const match = KO_SUFFIX_MATCHERS.find(
      (candidate) => token.length > candidate.suffix.length && token.endsWith(candidate.suffix)
    );
    if (match) matches.push({ className: match.className, suffix: match.suffix });
  }
  const matchedCount = matches.length;
  const classCount = new Set(matches.map((match) => match.className)).size;
  const suffixCount = new Set(matches.map((match) => match.suffix)).size;
  return {
    matchedCount,
    classDiversity: matchedCount > 0 ? classCount / matchedCount : null,
    suffixDiversity: matchedCount > 0 ? suffixCount / matchedCount : null,
  };
}

function countPattern(text, pattern) {
  return (String(text ?? '').match(pattern) ?? []).length;
}

function ratio(numerator, denominator) {
  return denominator > 0 ? roundMetric(numerator / denominator) : null;
}

function roundMetric(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(3)) : null;
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

/**
 * @param {{ sentenceCount?: number, spacing?: object, comma?: object, posDiversity?: object }} [features]
 * @param {object} [bands]
 */
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
