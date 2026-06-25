import {
  analyzeText,
  splitProseSentences,
  tokenize,
  commaDensity,
  koreanPosDiversityProxy,
  koreanPostEditeseFeatures,
  detectKoreanRegister,
} from './index.js';
import { editChurn } from '../personas/gates.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mean(values) {
  const nums = values.filter((value) => typeof value === 'number' && Number.isFinite(value));
  return nums.length > 0 ? nums.reduce((sum, value) => sum + value, 0) / nums.length : null;
}

function countPhrase(text, phrase) {
  if (!phrase) return 0;
  let count = 0;
  let index = 0;
  while (index <= text.length) {
    const found = text.indexOf(phrase, index);
    if (found === -1) break;
    count += 1;
    index = found + Math.max(phrase.length, 1);
  }
  return count;
}

function lexiconDensity(text, phrases, tokenCount) {
  if (!Array.isArray(phrases) || phrases.length === 0 || tokenCount === 0) return 0;
  const normalized = String(text ?? '').normalize('NFC');
  const matches = phrases.reduce((sum, phrase) => sum + countPhrase(normalized, String(phrase).normalize('NFC')), 0);
  return (matches / tokenCount) * 1000;
}

function openerDiversity(sentences) {
  if (sentences.length === 0) return 0;
  const openers = sentences
    .map((sentence) => String(sentence).trim().split(/\s+/u)[0])
    .filter(Boolean);
  return openers.length > 0 ? new Set(openers).size / openers.length : 0;
}

function localRegisterRatios(sentences) {
  const counts = { plain: 0, polite: 0 };
  for (const sentence of sentences) {
    const final = String(sentence).trim().replace(/[.!?…"'」』)\]]+$/g, '').split(/\s+/u).at(-1) ?? '';
    if (/[요죠]$/.test(final) || /(?:니다|니까)$/.test(final)) counts.polite += 1;
    else if (/다$/.test(final)) counts.plain += 1;
  }
  const total = counts.plain + counts.polite;
  return {
    plain: total > 0 ? counts.plain / total : 0,
    polite: total > 0 ? counts.polite / total : 0,
  };
}

function registerRatios(text, sentences) {
  const detected = detectKoreanRegister(text);
  if (detected?.shares) {
    return {
      plain: detected.shares.plain ?? 0,
      polite: (detected.shares.polite ?? 0) + (detected.shares.formal ?? 0),
    };
  }
  return localRegisterRatios(sentences);
}

function featureValue(vector, key) {
  const value = vector[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function cosineWeighted(vector, targets) {
  let dot = 0;
  let magX = 0;
  let magT = 0;
  for (const [name, spec] of Object.entries(targets)) {
    if (name === 'overEditChurn' || spec?.target == null) continue;
    const weight = spec.weight ?? 0;
    if (weight <= 0) continue;
    const wx = featureValue(vector, name) * weight;
    const wt = spec.target * weight;
    dot += wx * wt;
    magX += wx * wx;
    magT += wt * wt;
  }
  if (magX === 0 || magT === 0) return 0;
  return dot / (Math.sqrt(magX) * Math.sqrt(magT));
}

/**
 * Extract deterministic document-level persona-match features.
 *
 * @param {string} text Text to analyze.
 * @param {object} [options] Extraction options.
 * @returns {object} Numeric feature vector.
 */
export function extractPersonaFeatureVector(text, { lang = 'ko', repoRoot, persona } = {}) {
  const normalized = String(text ?? '').normalize('NFC');
  const analysis = analyzeText(normalized, { lang, repoRoot });
  const paragraphs = analysis.paragraphs ?? [];
  const sentences = splitProseSentences(normalized);
  const allTokens = tokenize(normalized, { lang });
  const sentenceCount = sentences.length;
  const comma = commaDensity(normalized, sentenceCount);
  const pos = koreanPosDiversityProxy(normalized);
  const postEditese = koreanPostEditeseFeatures(normalized, { lang });
  const register = registerRatios(normalized, sentences);
  const words = persona?.blocks?.preferredWords ?? {};
  const tokenCount = Math.max(allTokens.length, 1);

  return {
    burstiness_cv: mean(paragraphs.map((paragraph) => paragraph?.burstiness?.cv)),
    mattr: mean(paragraphs.map((paragraph) => paragraph?.mattr?.value)),
    sentence_opener_diversity: openerDiversity(sentences),
    comma_per_sentence: comma.perSentence ?? 0,
    suffix_class_diversity: postEditese?.rhythm?.suffixClassDiversity ?? pos.classDiversity ?? 0,
    ko_register_plain_ratio: register.plain,
    ko_register_polite_ratio: register.polite,
    lexicon_density_preferred: lexiconDensity(normalized, words.allow, tokenCount),
    lexicon_density_avoid: lexiconDensity(normalized, words.avoid, tokenCount),
  };
}

/**
 * Compute LLM-free persona-match score against normalized persona targets.
 *
 * @param {object} input Score inputs.
 * @returns {{score: number, featureVector: object, deltas: object, avoidDensityPenalty: number, overEditChurn: number|null}}
 */
export function personaMatchScore({ text, persona, lang = 'ko', repoRoot, original = null }) {
  const featureVector = extractPersonaFeatureVector(text, { lang, repoRoot, persona });
  const targets = persona?.targetFeatures ?? {};
  const deltas = {};
  let weightedDistance = 0;
  let weightSum = 0;

  for (const [name, spec] of Object.entries(targets)) {
    if (name === 'overEditChurn') continue;
    if (spec?.target == null || spec?.tolerance == null || spec.tolerance <= 0 || (spec.weight ?? 0) <= 0) continue;
    const x = featureValue(featureVector, name);
    const z = clamp((x - spec.target) / spec.tolerance, -3, 3);
    deltas[name] = { value: x, target: spec.target, z };
    weightedDistance += spec.weight * z * z;
    weightSum += spec.weight;
  }

  const dEuclid = weightSum > 0 ? Math.sqrt(weightedDistance / weightSum) : 0;
  const cos = cosineWeighted(featureVector, targets);
  const base = (100 * (1 - Math.min(dEuclid, 3) / 3) * 0.8) + (100 * Math.max(cos, 0) * 0.2);
  const avoidTarget = targets.lexicon_density_avoid?.target ?? 0;
  const avoidTolerance = targets.lexicon_density_avoid?.tolerance ?? 1;
  const avoidExcess = Math.max(0, featureVector.lexicon_density_avoid - avoidTarget - avoidTolerance);
  const avoidDensityPenalty = clamp((avoidExcess / Math.max(avoidTolerance, 1)) * 5, 0, 20);
  const overEditChurn = original == null ? null : editChurn(original, text);
  const churnMax = targets.overEditChurn?.max ?? null;
  const overEditPenalty = overEditChurn != null && churnMax != null && overEditChurn > churnMax
    ? clamp(((overEditChurn - churnMax) / Math.max(churnMax, 0.01)) * 20, 0, 20)
    : 0;
  const score = clamp(base - avoidDensityPenalty - overEditPenalty, 0, 100);

  return {
    score,
    featureVector,
    deltas,
    avoidDensityPenalty,
    overEditChurn,
  };
}
