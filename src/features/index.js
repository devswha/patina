// Node adapter for the shared deterministic analyzer. File loading stays here.
import { analyzeText as analyzeCore } from './analyzer.js';
import { loadLexicon } from './lexicon.js';

export function analyzeText(text, opts = {}) {
  const { lang = 'en', repoRoot, lexicon: providedLexicon } = opts;
  const lexicon = providedLexicon ?? (repoRoot ? loadLexicon(lang, repoRoot) : { strict: [], phrases: [] });
  const original = Object(opts);
  const forwarded = new Proxy({}, { get(_target, name) {
    if (name === 'lang') return lang;
    if (name === 'lexicon') return lexicon;
    return Reflect.get(original, name, original);
  } });
  return analyzeCore(text, forwarded);
}

export { splitParagraphs, splitSentences, splitProseSentences, tokenize } from './segment.js';
export {
  burstinessCV, mattr, classifyBurstiness, classifyMattr, classifyKoreanDiagnostics,
  koreanDiagnostics, commaDensity, koreanPosDiversityProxy, koreanSpacingFeatures,
  koreanPostEditeseFeatures, koreanEndingMonotony, detectKoreanRegister,
} from './stylometry.js';
export { loadLexicon, computeDensity } from './lexicon.js';
export { extractStructuralFeatures, structuralFeatureRecord, STRUCTURAL_FEATURE_NAMES } from './structural-features.js';
export {
  applyScaler, fitScaler, normalizeStructuralModel, predictStructuralScore,
  structuralModelVerdict, thresholdForMaxFpr, trainLogReg,
} from './structural-classifier.js';
export { loadStructuralModel, resolveStructuralModelPath } from './structural-model-loader.js';
export { buildDocumentSignals } from './document-signals.js';
