// patina-lane: A (deterministic substrate) — LLM-free. See docs/ARCHITECTURE.md.
// Top-level analyzer: runs the deterministic stylometry + lexicon signals
// described in core/stylometry.md and returns a per-paragraph result. This
// is the in-tree port of the algorithm previously delegated to the LLM via
// SKILL.md Step 4.6/4.7. It does not call any LLM.

import { splitParagraphs, splitSentences, splitProseSentences, tokenize } from './segment.js';
import {
  burstinessCV,
  mattr,
  classifyBurstiness,
  classifyMattr,
  classifyKoreanDiagnostics,
  koreanDiagnostics,
  commaDensity,
  koreanPosDiversityProxy,
  koreanSpacingFeatures,
  DEFAULT_BURSTINESS_BANDS,
  DEFAULT_KO_DIAGNOSTIC_BANDS,
  DEFAULT_MATTR_BANDS,
  DEFAULT_MATTR_WINDOW,
  DEFAULT_MIN_BURSTINESS_SENTENCES,
  koreanPostEditeseFeatures,
  koreanEndingMonotony,
  DEFAULT_KO_ENDING_MONOTONY,
  detectKoreanRegister,
} from './stylometry.js';
import {
  classifyLexiconHot,
  loadLexicon,
  computeDensity,
  DEFAULT_LEXICON_DENSITY_THRESHOLD,
  DEFAULT_LEXICON_MIN_HOT_MATCHES,
} from './lexicon.js';
import { detectMarkupLeakage } from './markup-leakage.js';
import {
  detectDiscourseTells,
  detectFakeCandor,
  detectThematicBreaks,
  isThematicBreakOnly,
} from './discourse-tells.js';
import { detectTranslationese } from './translationese.js';
import { extractStructuralFeatures, structuralFeatureRecord, STRUCTURAL_FEATURE_NAMES } from './structural-features.js';
import {
  applyScaler,
  fitScaler,
  normalizeStructuralModel,
  predictStructuralScore,
  structuralModelVerdict,
  thresholdForMaxFpr,
  trainLogReg,
} from './structural-classifier.js';
import { loadStructuralModel, resolveStructuralModelPath } from './structural-model-loader.js';

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
    koEndingMonotonyBands = DEFAULT_KO_ENDING_MONOTONY,
    lexiconDensityThreshold = DEFAULT_LEXICON_DENSITY_THRESHOLD,
    lexiconMinHotMatches = DEFAULT_LEXICON_MIN_HOT_MATCHES,
    lexicon: providedLexicon,
    structuralModel = null,
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
  // decorative thematic breaks (>=3). The density gate is document-level, but
  // hot status is attributed to the paragraphs that carry a tell (issue #391,
  // mirroring the playground's per-paragraph candorHot/thematicBreakHot), so
  // flagged paragraphs enter rewrite scope and the hot ratio reflects them.
  const discourseTells = detectDiscourseTells(normalized);
  const paraCandorCounts = paragraphs.map((p) => detectFakeCandor(p).count);
  const paraThematicBreakCounts = paragraphs.map((p) => detectThematicBreaks(p).count);
  // ko translationese (번역투/calque) — lexical, NOT structural. Advisory signal:
  // surfaced for callers/SKILL but deliberately NOT folded into `hot` (these
  // constructions appear in good Korean too; gating hot would regress FP).
  const translationese = detectTranslationese(normalized, { lang });
  const koPostEditese = koreanPostEditeseFeatures(normalized, { lang });
  const structuralClassifier = structuralModelVerdict(normalized, { lang, model: structuralModel });
  const lexicon =
    providedLexicon ??
    (repoRoot ? loadLexicon(lang, repoRoot) : { strict: [], phrases: [] });

  // §8 skip conditions are advisory only — production callers (SKILL.md 4.6/4.7)
  // can suppress meta-block emission, but the benchmark wants raw signals on
  // single-paragraph fixtures so we compute them unconditionally.
  const totalSentences = paragraphs.reduce(
    (n, p) => n + splitProseSentences(p).length,
    0
  );
  const skipReason =
    paragraphs.length <= 2 ? 'paragraphs<=2' :
    totalSentences <= 2 ? 'sentences<=2' :
    null;

  const analyzed = paragraphs.map((paragraph, idx) => {
    const sentences = splitProseSentences(paragraph);
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
      ? koreanDiagnostics(paragraph, sentences.length, {
          enabled: koDiagnosticsEnabled,
          bands: koDiagnosticBands,
        })
      : {};

    const endingMonotony = lang === 'ko' ? koreanEndingMonotony(sentences) : null;
    // KO uniform plain-다 register: low burstiness AND -다 dominance. Unlike the
    // standard burstiness trigger (cvBand) this does NOT require the 3-sentence
    // minimum, so it catches short AI Korean the band gate skips, while the -다
    // conjuncts keep formal/conversational human Korean out (DEFAULT_KO_ENDING_MONOTONY).
    const endingMonotonyHot = Boolean(
      endingMonotony &&
      allTokens.length >= koEndingMonotonyBands.minTokens &&
      cv != null &&
      cv < burstinessBands.low &&
      endingMonotony.daRatio != null &&
      endingMonotony.daRatio >= koEndingMonotonyBands.minDaRatio &&
      endingMonotony.daCount >= koEndingMonotonyBands.minDaCount
    );

    const lexiconHot = classifyLexiconHot(lex, {
      lang,
      densityThreshold: lexiconDensityThreshold,
      minHotMatches: lexiconMinHotMatches,
    });
    // Discourse-tell attribution (#391): this paragraph carries a tell AND the
    // document-level density gate fired (>=2 candor openers / >=3 breaks).
    const candorHot = discourseTells.fakeCandor.hot && paraCandorCounts[idx] >= 1;
    const thematicBreakHot = discourseTells.thematicBreaks.hot && paraThematicBreakCounts[idx] >= 1;
    const hot =
      cvBand === 'low' ||
      mattrBand === 'low' ||
      lexiconHot ||
      Boolean(koSignals.koDiagnostics?.hot) ||
      candorHot ||
      thematicBreakHot ||
      endingMonotonyHot;

    return {
      id: `P${idx + 1}`,
      sentenceCount: sentences.length,
      tokenCount: allTokens.length,
      burstiness: { cv, band: cvBand },
      mattr: { value: mattrValue, band: mattrBand },
      lexicon: { ...lex, hot: lexiconHot },
      ...koSignals,
      candorHot,
      candorCount: paraCandorCounts[idx],
      thematicBreakHot,
      thematicBreakCount: paraThematicBreakCounts[idx],
      endingMonotony,
      endingMonotonyHot,
      // Divider-only pseudo-paragraph (a bare `---` line between blank lines).
      // Hot attribution still applies (the divider itself is rewrite scope),
      // but prose gates use this to keep their ratios on actual prose.
      thematicBreakOnly: isThematicBreakOnly(paragraph),
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
    translationese,
    koPostEditese,
    // No `discourseTells.hot` disjunct here: whenever the document-level density
    // gate fires, at least one paragraph carries the tell (candor regexes cannot
    // span paragraph breaks; thematic breaks are whole lines), so the
    // per-paragraph attribution above already makes some paragraph hot.
    hot: markupLeakage.leaked || structuralClassifier.hot === true || analyzed.some((p) => p.hot),
    structuralClassifier,
  };
}

export {
  splitParagraphs,
  splitSentences,
  splitProseSentences,
  tokenize,
  burstinessCV,
  mattr,
  classifyBurstiness,
  classifyMattr,
  classifyKoreanDiagnostics,
  koreanDiagnostics,
  commaDensity,
  koreanPosDiversityProxy,
  koreanSpacingFeatures,
  koreanPostEditeseFeatures,
  koreanEndingMonotony,
  detectKoreanRegister,
  loadLexicon,
  computeDensity,
  extractStructuralFeatures,
  structuralFeatureRecord,
  STRUCTURAL_FEATURE_NAMES,
  applyScaler,
  fitScaler,
  normalizeStructuralModel,
  predictStructuralScore,
  structuralModelVerdict,
  thresholdForMaxFpr,
  trainLogReg,
  loadStructuralModel,
  resolveStructuralModelPath,
};


