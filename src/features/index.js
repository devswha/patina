// Top-level analyzer: runs the deterministic stylometry + lexicon signals
// described in core/stylometry.md and returns a per-paragraph result. This
// is the in-tree port of the algorithm previously delegated to the LLM via
// SKILL.md Step 4.6/4.7. It does not call any LLM.

import { splitParagraphs, splitSentences, tokenize } from './segment.js';
import {
  burstinessCV,
  mattr,
  classifyBurstiness,
  classifyMattr,
  DEFAULT_BURSTINESS_BANDS,
  DEFAULT_MATTR_BANDS,
  DEFAULT_MATTR_WINDOW,
} from './stylometry.js';
import { loadLexicon, computeDensity, DEFAULT_LEXICON_DENSITY_THRESHOLD } from './lexicon.js';

export function analyzeText(text, opts = {}) {
  const {
    lang = 'en',
    repoRoot,
    burstinessBands = DEFAULT_BURSTINESS_BANDS,
    mattrBands = DEFAULT_MATTR_BANDS,
    mattrWindow = DEFAULT_MATTR_WINDOW,
    lexiconDensityThreshold = DEFAULT_LEXICON_DENSITY_THRESHOLD,
    lexicon: providedLexicon,
  } = opts;

  const paragraphs = splitParagraphs(text);
  const lexicon =
    providedLexicon ??
    (repoRoot ? loadLexicon(lang, repoRoot) : { strict: [], phrases: [] });

  // §8 skip conditions are advisory only — production callers (SKILL.md 4.6/4.7)
  // can suppress meta-block emission, but the benchmark wants raw signals on
  // single-paragraph fixtures so we compute them unconditionally.
  const totalSentences = paragraphs.reduce(
    (n, p) => n + splitSentences(p).length,
    0
  );
  const skipReason =
    paragraphs.length <= 2 ? 'paragraphs<=2' :
    totalSentences <= 2 ? 'sentences<=2' :
    null;

  const analyzed = paragraphs.map((paragraph, idx) => {
    const sentences = splitSentences(paragraph);
    const sentenceTokens = sentences.map(tokenize);
    const sentenceTokenCounts = sentenceTokens.map((t) => t.length);
    const allTokens = sentenceTokens.flat();

    const cv = burstinessCV(sentenceTokenCounts);
    const cvBand = classifyBurstiness(cv, burstinessBands);
    const mattrValue = mattr(allTokens, mattrWindow);
    const mattrBand = classifyMattr(mattrValue, mattrBands);
    const lex = computeDensity(paragraph, allTokens, lexicon);

    const lexiconHot = lex.density > lexiconDensityThreshold;
    const hot =
      cvBand === 'low' || mattrBand === 'low' || lexiconHot;

    return {
      id: `P${idx + 1}`,
      sentenceCount: sentences.length,
      tokenCount: allTokens.length,
      burstiness: { cv, band: cvBand },
      mattr: { value: mattrValue, band: mattrBand },
      lexicon: { ...lex, hot: lexiconHot },
      hot,
    };
  });

  return {
    lang,
    skipped: Boolean(skipReason),
    skipReason,
    paragraphs: analyzed,
    hot: analyzed.some((p) => p.hot),
  };
}

export {
  splitParagraphs,
  splitSentences,
  tokenize,
  burstinessCV,
  mattr,
  classifyBurstiness,
  classifyMattr,
  loadLexicon,
  computeDensity,
};
