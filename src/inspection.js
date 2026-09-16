import { createHash } from 'node:crypto';
import { analyzeText, splitParagraphs, tokenize, computeDensity, loadLexicon } from './features/index.js';
import { fingerprintKoreanStructure } from './features/korean-structure-fingerprint.js';
import { loadConfig, getRepoRoot } from './config.js';
import { loadPatterns } from './loader.js';
import { scoreDeterministicSignals } from './scoring.js';
import { detectLanguage } from './prose-core.js';
import { maskInspectionNonProse } from './inspection-masks.js';
import { classifyDiscourseShape, collectInspectionAdvisories } from './inspection-advisories.js';

export const MAX_INSPECTION_CHARS = 200000;
export const MAX_INSPECTION_DIAGNOSTICS = 2000;

// Offsets are UTF-16, matching VS Code and JavaScript editor APIs. NFC analysis
// can shorten decomposed graphemes; map each normalized unit back to its whole
// original grapheme so diagnostics never split combining marks or surrogate pairs.
export function normalizedOffsetMap(text) {
  let normalized = ''; const starts = []; const ends = [];
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  for (const { segment, index } of segmenter.segment(text)) {
    const value = segment.normalize('NFC');
    for (let i = 0; i < value.length; i++) { starts.push(index); ends.push(index + segment.length); }
    normalized += value;
  }
  return { normalized, starts, ends };
}

function paragraphSignals(paragraph) {
  return [
    paragraph.burstiness?.band === 'low' && 'uniform-sentence-length',
    paragraph.mattr?.band === 'low' && 'repeated-vocabulary',
    paragraph.lexicon?.hot && 'ai-lexicon-density',
    paragraph.koDiagnostics?.hot && 'korean-diagnostics',
    paragraph.endingMonotonyHot && 'repeated-endings',
    paragraph.candorHot && 'formulaic-candor',
    paragraph.thematicBreakHot && 'thematic-breaks',
  ].filter(Boolean);
}

function sentenceFindings(paragraph, paragraphStart, masked, lexicon, evidence, lang) {
  if (!evidence.lexicon?.hot || !lexicon) return [];
  const known = new Set(evidence.lexicon.hits || []), findings = [];
  for (const { segment, index } of new Intl.Segmenter(lang, { granularity: 'sentence' }).segment(paragraph)) {
    const leading = segment.length - segment.trimStart().length;
    const start = paragraphStart + index + leading;
    const end = paragraphStart + index + segment.trimEnd().length;
    if (start >= end) continue;
    const text = masked.slice(start, end);
    const hits = computeDensity(text, tokenize(text, { lang }), lexicon).hits.filter((hit) => known.has(hit));
    if (hits.length) findings.push({ start, end, evidenceCount: hits.length });
  }
  return findings;
}

export function inspectText(text, { language = 'auto', file = '', config, repoRoot = getRepoRoot(), rewrite = null, documentType } = {}) {
  if (typeof text !== 'string' || !text.trim()) throw new TypeError('Inspection requires non-empty text');
  if (text.length > MAX_INSPECTION_CHARS) throw new RangeError(`Inspection supports at most ${MAX_INSPECTION_CHARS} characters; inspect a selection instead`);
  if (!['auto', 'en', 'ko', 'zh', 'ja'].includes(language)) throw new TypeError('Unsupported inspection language');
  const settings = globalThis.structuredClone(config || loadConfig());
  const lang = detectLanguage(file, text.normalize('NFC'), language); settings.language = lang;
  const patterns = loadPatterns(repoRoot, lang, settings['skip-patterns'] || []);
  let analysis, lexicon;
  const score = scoreDeterministicSignals({ text, config: settings, patterns, repoRoot,
    logger: { warn() {} }, analyzer: (value, options) => {
      lexicon = options.lexicon ?? loadLexicon(lang, repoRoot);
      analysis = analyzeText(value, { ...options, lexicon }); return analysis;
    } });
  const base = { schemaVersion: 1, language: lang, sourceHash: createHash('sha256').update(text).digest('hex'),
    deterministicOnly: true, offsetEncoding: 'utf-16', score: score?.overall ?? null,
    interpretation: score?.interpretation ?? null, paragraphCount: score?.paragraphCount ?? 0 };
  if (!analysis || !Number.isFinite(score?.overall)) return { ...base, available: false, diagnostics: [], reason: score?.skipReason || 'analysis-unavailable' };
  const mapping = normalizedOffsetMap(text);
  const masked = maskInspectionNonProse(mapping.normalized).replace(/https?:\/\/\S+/g, (value) => ' '.repeat(value.length));
  const paragraphs = splitParagraphs(mapping.normalized);
  const diagnostics = []; let cursor = 0, diagnosticsTruncated = false;
  const add = (row) => { if (diagnostics.length < MAX_INSPECTION_DIAGNOSTICS) diagnostics.push(row); else diagnosticsTruncated = true; };
  if (analysis.markupLeakage?.leaked) add({ start: 0, end: text.length, code: 'model-output-leakage', scope: 'document', severity: 'warning', message: 'Model-output markup or self-identification is present.', signals: ['model-output-leakage'] });
  if (analysis.structuralClassifier?.hot) add({ start: 0, end: text.length, code: 'structural-model', scope: 'document', severity: 'warning', message: 'The configured structural model flagged this document.', signals: ['structural-model'] });
  for (let i = 0; i < paragraphs.length; i++) {
    const paragraph = paragraphs[i];
    const start = mapping.normalized.indexOf(paragraph, cursor);
    if (start < 0) throw new Error('Analysis paragraph could not be mapped to the source');
    cursor = start + paragraph.length;
    if (!analysis.paragraphs[i]?.hot) continue;
    const sentences = sentenceFindings(paragraph, start, masked, lexicon, analysis.paragraphs[i], lang);
    add({ start: mapping.starts[start], end: mapping.ends[cursor - 1],
      code: 'ai-like-paragraph', scope: 'paragraph', localized: sentences.length > 0 && diagnostics.length + 1 < MAX_INSPECTION_DIAGNOSTICS, severity: 'warning', paragraph: i + 1,
      message: 'This paragraph has AI-like editing signals.', signals: paragraphSignals(analysis.paragraphs[i]) });
    for (const sentence of sentences) add({ start: mapping.starts[sentence.start], end: mapping.ends[sentence.end - 1],
      code: 'ai-like-sentence', scope: 'sentence', severity: 'warning', paragraph: i + 1, evidenceCount: sentence.evidenceCount,
      message: 'This sentence contains lexical cues contributing to the paragraph’s writing signals.', signals: ['ai-lexicon-density'] });
  }
  const resolvedType = documentType || settings.documentType || 'default';
  const structureFingerprint = lang === 'ko' ? fingerprintKoreanStructure(mapping.normalized) : null;
  const advisories = collectInspectionAdvisories(mapping.normalized, {
    language: lang,
    documentType: resolvedType,
    rewrite,
  });
  return {
    ...base,
    available: true,
    diagnostics,
    diagnosticsTruncated,
    skipped: score.skipped,
    skipReason: score.skipReason,
    documentType: resolvedType,
    structureFingerprint,
    discourseShape: classifyDiscourseShape(mapping.normalized),
    advisories,
  };
}

export function inspectAuditSource(text, options = {}) {
  try { return inspectText(text, options); }
  catch { return { schemaVersion: 1, deterministicOnly: true, sourceHash: createHash('sha256').update(text).digest('hex'),
    language: options.language, offsetEncoding: 'utf-16', available: false, score: null, diagnostics: [], reason: 'inspection-unavailable' }; }
}
