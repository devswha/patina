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
  classifyKoreanDiagnostics,
  commaDensity,
  koreanPosDiversityProxy,
  koreanSpacingFeatures,
  DEFAULT_BURSTINESS_BANDS,
  DEFAULT_KO_DIAGNOSTIC_BANDS,
  DEFAULT_MATTR_BANDS,
  DEFAULT_MATTR_WINDOW,
  DEFAULT_MIN_BURSTINESS_SENTENCES,
} from './stylometry.js';
import {
  classifyLexiconHot,
  loadLexicon,
  computeDensity,
  DEFAULT_LEXICON_DENSITY_THRESHOLD,
  DEFAULT_LEXICON_MIN_HOT_MATCHES,
} from './lexicon.js';
import { detectMarkupLeakage } from './markup-leakage.js';
import { detectDiscourseTells } from './discourse-tells.js';

export function analyzeText(text, opts = {}) {
  const {
    lang = 'en',
    repoRoot,
    burstinessBands = DEFAULT_BURSTINESS_BANDS,
    minBurstinessSentences = DEFAULT_MIN_BURSTINESS_SENTENCES,
    mattrBands = DEFAULT_MATTR_BANDS,
    mattrWindow = DEFAULT_MATTR_WINDOW,
    koDiagnosticsEnabled = true,
    koDiagnosticBands = DEFAULT_KO_DIAGNOSTIC_BANDS,
    lexiconDensityThreshold = DEFAULT_LEXICON_DENSITY_THRESHOLD,
    lexiconMinHotMatches = DEFAULT_LEXICON_MIN_HOT_MATCHES,
    lexicon: providedLexicon,
  } = opts;

  // Normalize to NFC at the boundary so downstream tokenization and lexicon
  // comparison see canonical form. Mixed NFC/NFD inputs (e.g. "café" composed
  // vs decomposed) would otherwise yield different MATTR/lexicon hits.
  const normalized = text ? text.normalize('NFC') : '';
  const paragraphs = splitParagraphs(normalized);

  // Document-level leakage scan (issue #332). Near-proof-grade: a single hit is
  // strong evidence of pasted model output, so it forces the document hot
  // regardless of the per-paragraph stylometry/lexicon signals.
  const markupLeakage = detectMarkupLeakage(normalized);
  // Density-gated discourse tells (issue #334): fake-candor openers (>=2) and
  // decorative thematic breaks (>=3). Document-level, weaker than leakage.
  const discourseTells = detectDiscourseTells(normalized);
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
    const sentenceTokens = sentences.map((sentence) => tokenize(sentence, { lang }));
    const sentenceTokenCounts = sentenceTokens.map((t) => t.length);
    const allTokens = sentenceTokens.flat();

    const cv = burstinessCV(sentenceTokenCounts);
    const cvBand =
      sentences.length >= minBurstinessSentences
        ? classifyBurstiness(cv, burstinessBands)
        : null;
    const mattrValue = mattr(allTokens, mattrWindow);
    const mattrBand = classifyMattr(mattrValue, mattrBands);
    const lex = computeDensity(paragraph, allTokens, lexicon);
    const koSignals = lang === 'ko'
      ? buildKoreanSignals(paragraph, sentences.length, {
          enabled: koDiagnosticsEnabled,
          bands: koDiagnosticBands,
        })
      : {};

    const lexiconHot = classifyLexiconHot(lex, {
      lang,
      densityThreshold: lexiconDensityThreshold,
      minHotMatches: lexiconMinHotMatches,
    });
    const hot =
      cvBand === 'low' || mattrBand === 'low' || lexiconHot || Boolean(koSignals.koDiagnostics?.hot);

    return {
      id: `P${idx + 1}`,
      sentenceCount: sentences.length,
      tokenCount: allTokens.length,
      burstiness: { cv, band: cvBand },
      mattr: { value: mattrValue, band: mattrBand },
      lexicon: { ...lex, hot: lexiconHot },
      ...koSignals,
      hot,
    };
  });

  return {
    lang,
    skipped: Boolean(skipReason),
    skipReason,
    paragraphs: analyzed,
    markupLeakage,
    discourseTells,
    hot: markupLeakage.leaked || discourseTells.hot || analyzed.some((p) => p.hot),
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
  classifyKoreanDiagnostics,
  commaDensity,
  koreanPosDiversityProxy,
  koreanSpacingFeatures,
  loadLexicon,
  computeDensity,
};

function buildKoreanSignals(paragraph, sentenceCount, { enabled, bands }) {
  const spacing = koreanSpacingFeatures(paragraph);
  const comma = commaDensity(paragraph, sentenceCount);
  const posDiversity = koreanPosDiversityProxy(paragraph);
  const koDiagnostics = enabled
    ? classifyKoreanDiagnostics({
        sentenceCount,
        spacing,
        comma,
        posDiversity,
      }, bands)
    : { hot: false, strength: 0, reasons: [], thresholds: bands };

  return {
    spacing,
    comma,
    posDiversity,
    koDiagnostics,
  };
}
