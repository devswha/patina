// Document-level structural features shared by the public analyzer and hosted
// services. These are model-agnostic stylometry signals: no corpus rows, labels,
// trained weights, prompts, or private assets live here.
import { splitParagraphs, splitProseSentences, tokenize } from './segment.js';
import { burstinessCV, mattr } from './stylometry.js';

export const STRUCTURAL_FEATURE_NAMES = Object.freeze([
  'burstiness_cv',
  'mean_sent_len',
  'std_sent_len',
  'ttr',
  'mattr',
  'hapax_ratio',
  'mean_tok_len',
  'comma_per_sent',
  'punct_ratio',
  'ending_diversity',
  'connective_ratio',
  'digit_ratio',
]);

const KO_CONNECTIVES = new Set([
  '또한',
  '게다가',
  '뿐만',
  '따라서',
  '그러나',
  '하지만',
  '결론적으로',
  '즉',
  '특히',
  '한편',
  '그리고',
  '그래서',
  '때문에',
  '통해',
  '위해',
  '대한',
  '다양한',
  '효과적으로',
  '중요하다고',
  '있습니다',
  '바랍니다',
]);

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function stddev(values) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - avg) ** 2)));
}

function countMatches(values, predicate) {
  let count = 0;
  for (const value of values) {
    if (predicate(value)) count += 1;
  }
  return count;
}

/**
 * Extract a numeric vector aligned with STRUCTURAL_FEATURE_NAMES.
 *
 * @param {string} text Text to analyze.
 * @param {{lang?: string, mattrWindow?: number}} [opts] Language/tokenizer options.
 * @returns {number[]} Numeric feature vector.
 */
export function extractStructuralFeatures(text, { lang = 'ko', mattrWindow = 40 } = {}) {
  const normalized = (text || '').normalize('NFC');
  const paragraphs = splitParagraphs(normalized);
  const sentences = paragraphs.flatMap((paragraph) => splitProseSentences(paragraph));
  const sentenceTokens = sentences.map((sentence) => tokenize(sentence, { lang }));
  const sentenceLengths = sentenceTokens.map((tokens) => tokens.length).filter((count) => count > 0);
  const tokens = sentenceTokens.flat();
  const types = new Set(tokens);

  const frequencies = new Map();
  for (const token of tokens) frequencies.set(token, (frequencies.get(token) || 0) + 1);
  const hapaxCount = countMatches(frequencies.values(), (count) => count === 1);

  const compactChars = [...normalized.replace(/\s/g, '')];
  const punctCount = countMatches(compactChars, (char) => /[.,!?;:·…"'()[\]{}—\-~]/.test(char));
  const digitCount = countMatches(compactChars, (char) => /[0-9]/.test(char));
  const commaCount = (normalized.match(/[,，]/g) || []).length;

  const endings = sentences
    .map((sentence) => {
      const trimmed = sentence.trim();
      return trimmed.slice(-3).replace(/[.!?]/g, '').slice(-2);
    })
    .filter(Boolean);
  const endingDiversity = sentences.length ? new Set(endings).size / sentences.length : 0;
  const connectiveHits = countMatches(tokens, (token) => KO_CONNECTIVES.has(token));

  return [
    sentenceLengths.length >= 2 ? burstinessCV(sentenceLengths) : 0,
    mean(sentenceLengths),
    stddev(sentenceLengths),
    tokens.length ? types.size / tokens.length : 0,
    mattr(tokens, mattrWindow) ?? 0,
    types.size ? hapaxCount / types.size : 0,
    tokens.length ? mean(tokens.map((token) => token.length)) : 0,
    sentences.length ? commaCount / sentences.length : 0,
    compactChars.length ? punctCount / compactChars.length : 0,
    endingDiversity,
    tokens.length ? connectiveHits / tokens.length : 0,
    compactChars.length ? digitCount / compactChars.length : 0,
  ];
}

/**
 * Pair a feature vector with names for logging/debug output.
 *
 * @param {number[]} vector Numeric feature vector.
 * @param {readonly string[]} [names] Feature names aligned to vector positions.
 * @returns {Record<string, number>}
 */
export function structuralFeatureRecord(vector, names = STRUCTURAL_FEATURE_NAMES) {
  /** @type {Record<string, number>} */
  const record = {};
  for (let i = 0; i < names.length; i++) record[names[i]] = vector[i] ?? 0;
  return record;
}
