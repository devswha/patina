// Shared contract for the KO GPT-family miss-review manifest (roadmap step 1,
// measure-only). Schema, taxonomy, gate-deficit margins, the source-free signal
// projection, extraction and validation live here; the CLIs in
// ko-miss-review-{extract,validate,kit,report}.mjs are thin wrappers.
//
// Design record: docs/research/ko-gpt-miss-review-step1-decision-20260902.md.
// Nothing in this module changes analyzer behaviour: it calls the fixed
// analyzer with its production defaults and only reads the result.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzeText, splitParagraphs } from '../src/features/index.js';
import {
  DEFAULT_BURSTINESS_BANDS,
  DEFAULT_KO_DIAGNOSTIC_BANDS,
  DEFAULT_KO_ENDING_MONOTONY,
  DEFAULT_MATTR_BANDS,
  DEFAULT_MATTR_WINDOW,
  DEFAULT_MIN_BURSTINESS_SENTENCES,
} from '../src/features/stylometry.js';
import {
  DEFAULT_LEXICON_DENSITY_THRESHOLD,
  DEFAULT_LEXICON_MIN_HOT_MATCHES,
  parseLexiconBody,
  resolveMinHotMatches,
} from '../src/features/lexicon.js';
import { FAKE_CANDOR_MIN, THEMATIC_BREAK_MIN } from '../src/features/discourse-tells.js';
import { detectTranslationese } from '../src/features/translationese.js';
import { hashText } from './rebaseline-summary.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, '..');

export const SCHEMA = 'ko-gpt-miss-review.v1';
export const EXCLUSION_SCHEMA = 'ko-gpt-miss-review-exclusion.v1';
export const SHEET_SCHEMA = 'ko-gpt-miss-review-blind-sheet.v1';
export const TAXONOMY_VERSION = 'ko-gpt-miss-taxonomy.v1';
export const NEAR = 0.1;
export const ANALYSIS_ROLE = 'discovery-only';
export const SOURCE_DOC = 'docs/research/2026-rebaseline.md';
export const DEFAULT_SOURCE_MANIFEST = 'artifacts/rebaseline-2025/rebaseline-2026.scored.public.jsonl';
export const DEFAULT_PRIVATE_CORPUS = 'artifacts/rebaseline-2025/private/modern-generations.private.jsonl';
export const DEFAULT_OUTPUT = 'artifacts/rebaseline-2025/ko-gpt-miss-review.v1.jsonl';
export const DEFAULT_EXCLUSIONS_OUTPUT = 'artifacts/rebaseline-2025/ko-gpt-miss-review.v1.exclusions.jsonl';
export const DEFAULT_LEXICON_PATH = 'lexicon/ai-ko.md';

export const POPULATION = Object.freeze({
  language: 'ko',
  class: 'ai-like',
  model_family: 'gpt-family',
  expected_hot: true,
  predicted_hot: false,
});
export const REGISTERS = Object.freeze(['blog', 'academic-summary', 'product-doc', 'chat-update', 'technical-how-to']);
export const FAMILIES = Object.freeze(['burstiness', 'mattr', 'lexicon', 'ko-diagnostics', 'structure']);
export const MISS_REASONS = Object.freeze([
  'multi-threshold-near',
  'threshold-near-burstiness',
  'threshold-near-mattr',
  'threshold-near-lexicon',
  'threshold-near-ko-diagnostics',
  'threshold-near-structure',
  'threshold-far',
  'advisory-only-coverage-gap',
  'no-modeled-signal',
]);
export const SHA256_RE = /^sha256:[0-9a-f]{64}$/u;
const HANGUL_RE = /[\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uAC00-\uD7AF\uD7B0-\uD7FF]/u;
// Keys that carry source text or matched spans somewhere in the analyzer
// output. They must never appear in a committed row.
export const BANNED_KEYS = Object.freeze(['text', 'hits', 'samples', 'example', 'evidence', 'matches_text', 'spans', 'classes']);
// Free-text fields that are checked against the private corpus for leaks.
// Signal and margin blocks hold enumerated labels only ("high", "clean", rule
// ids) and are covered by the Hangul and banned-key checks instead.
const FREE_TEXT_PATHS = Object.freeze(['reviewer_notes', 'review']);

// ---------------------------------------------------------------------------
// Analyzer options (production defaults, frozen here so the manifest records
// exactly what the fixed analyzer used).

export function activeAnalyzerOptions() {
  return {
    lang: 'ko',
    burstinessBands: { ...DEFAULT_BURSTINESS_BANDS },
    minBurstinessSentences: DEFAULT_MIN_BURSTINESS_SENTENCES,
    mattrBands: { ...DEFAULT_MATTR_BANDS },
    mattrWindow: DEFAULT_MATTR_WINDOW,
    koDiagnosticsEnabled: true,
    koDiagnosticBands: {
      minSentences: DEFAULT_KO_DIAGNOSTIC_BANDS.minSentences,
      minEojeols: DEFAULT_KO_DIAGNOSTIC_BANDS.minEojeols,
      spacing: { ...DEFAULT_KO_DIAGNOSTIC_BANDS.spacing },
      comma: { ...DEFAULT_KO_DIAGNOSTIC_BANDS.comma },
      posProxy: { ...DEFAULT_KO_DIAGNOSTIC_BANDS.posProxy },
    },
    koEndingMonotonyBands: { ...DEFAULT_KO_ENDING_MONOTONY },
    lexiconDensityThreshold: DEFAULT_LEXICON_DENSITY_THRESHOLD,
    lexiconMinHotMatches: resolveMinHotMatches('ko', DEFAULT_LEXICON_MIN_HOT_MATCHES),
    fakeCandorMin: FAKE_CANDOR_MIN,
    thematicBreakMin: THEMATIC_BREAK_MIN,
    structuralModel: null,
    documentType: 'default',
  };
}

export function loadPinnedLexicon(repoRoot = REPO_ROOT, lexiconPath = DEFAULT_LEXICON_PATH) {
  const abs = resolve(repoRoot, lexiconPath);
  if (!existsSync(abs)) throw new Error(`lexicon not found: ${toRepoRelative(abs, repoRoot)}`);
  const raw = readFileSync(abs, 'utf8');
  const body = raw.replace(/^---[\s\S]*?---\s*/u, '');
  const versionMatch = raw.match(/^version:\s*["']?([^"'\n]+)["']?\s*$/mu);
  return {
    lexicon: { lang: 'ko', path: abs, ...parseLexiconBody(body) },
    lexicon_path: toRepoRelative(abs, repoRoot),
    lexicon_hash: sha256Hex(raw),
    lexicon_version: versionMatch ? versionMatch[1].trim() : null,
  };
}

// ---------------------------------------------------------------------------
// Gate deficits. Every hot gate is normalised to "how far is the observed value
// from the threshold, as a fraction of the threshold": 0 means at or past the
// threshold, 1 means a full threshold away, absent means the value or the
// pattern does not exist for this row (an AND gate can never be satisfied then).
// Equality counts as deficit 0 even where the analyzer's gate is strict; the
// row is still a miss, so a deficit of 0 without a hot verdict is possible only
// at exact equality and reads as "at the boundary".

function isNum(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function gate(x, t, op) {
  const present = isNum(x) && isNum(t) && t !== 0;
  const entry = { x: isNum(x) ? round(x) : null, t: isNum(t) ? t : null, op, deficit: null, absent: !present };
  if (!present) return entry;
  const raw = op === '<' || op === '<=' ? (x - t) / Math.abs(t) : (t - x) / Math.abs(t);
  entry.deficit = round(Math.max(0, raw));
  return entry;
}

export function andMax(gates) {
  const entries = Object.values(gates);
  if (entries.some((g) => g.absent)) return { deficit: null, absent: true, combine: 'and-max', gates };
  return { deficit: round(Math.max(...entries.map((g) => g.deficit))), absent: false, combine: 'and-max', gates };
}

export function orMin(gates) {
  const present = Object.values(gates).filter((g) => !g.absent);
  if (present.length === 0) return { deficit: null, absent: true, combine: 'or-min', gates };
  return { deficit: round(Math.min(...present.map((g) => g.deficit))), absent: false, combine: 'or-min', gates };
}

export function paragraphFamilyDeficits(paragraph, analysis, options) {
  const bands = options.koDiagnosticBands;
  const monotony = options.koEndingMonotonyBands;
  const burstiness = orMin({
    standard: andMax({
      sentence_count: gate(paragraph.sentenceCount, options.minBurstinessSentences, '>='),
      cv: gate(paragraph.burstiness?.cv, options.burstinessBands.low, '<'),
    }),
    ending_monotony: andMax({
      token_count: gate(paragraph.tokenCount, monotony.minTokens, '>='),
      cv: gate(paragraph.burstiness?.cv, options.burstinessBands.low, '<'),
      da_ratio: gate(paragraph.endingMonotony?.daRatio, monotony.minDaRatio, '>='),
      da_count: gate(paragraph.endingMonotony?.daCount, monotony.minDaCount, '>='),
    }),
  });
  const mattr = andMax({
    value: gate(paragraph.mattr?.value, options.mattrBands.low, '<'),
  });
  const lexicon = andMax({
    matches: gate(paragraph.lexicon?.matches, options.lexiconMinHotMatches, '>='),
    density: gate(paragraph.lexicon?.density, options.lexiconDensityThreshold, '>'),
  });
  const koDiagnostics = andMax({
    sentence_count: gate(paragraph.sentenceCount, bands.minSentences, '>='),
    eojeol_count: gate(paragraph.spacing?.eojeolCount, bands.minEojeols, '>='),
    eojeol_length_cv: gate(paragraph.spacing?.eojeolLengthCV, bands.spacing.maxEojeolLengthCV, '<'),
    comma_per_sentence: gate(paragraph.comma?.perSentence, bands.comma.maxPerSentence, '<'),
    pos_matched_count: gate(paragraph.posDiversity?.matchedCount, bands.posProxy.minMatchedCount, '>='),
    pos_class_diversity: gate(paragraph.posDiversity?.classDiversity, bands.posProxy.maxClassDiversity, '<'),
  });
  const classifier = analysis.structuralClassifier;
  const structure = orMin({
    fake_candor: gate(analysis.discourseTells?.fakeCandor?.count, options.fakeCandorMin, '>='),
    thematic_breaks: gate(analysis.discourseTells?.thematicBreaks?.count, options.thematicBreakMin, '>='),
    structural_classifier: classifier?.available
      ? gate(classifier.score, classifier.threshold ?? null, '>=')
      : { x: null, t: null, op: '>=', deficit: null, absent: true },
  });
  return { burstiness, mattr, lexicon, 'ko-diagnostics': koDiagnostics, structure };
}

export function advisoryPresence(analysis) {
  const translationeseRules = analysis.translationese?.byRule?.length ?? 0;
  const interference = analysis.koPostEditese?.metrics?.interference ?? {};
  const postEditeseInterference = Object.values(interference).reduce((sum, value) => sum + (isNum(value) ? value : 0), 0);
  return {
    translationese_rules: translationeseRules,
    post_editese_interference: postEditeseInterference,
    present: translationeseRules > 0 || postEditeseInterference > 0,
  };
}

export function computeMargins(analysis, options) {
  const perParagraph = analysis.paragraphs.map((paragraph) => ({
    id: paragraph.id,
    families: paragraphFamilyDeficits(paragraph, analysis, options),
  }));
  // Multiple paragraphs are an OR: the family's document deficit is the best
  // paragraph, and the winning paragraph's gates are the ones recorded.
  const families = {};
  for (const family of FAMILIES) {
    let best = null;
    for (const row of perParagraph) {
      const candidate = row.families[family];
      if (candidate.absent) continue;
      if (!best || candidate.deficit < best.value.deficit) best = { id: row.id, value: candidate };
    }
    families[family] = best
      ? { deficit: best.value.deficit, absent: false, paragraph: best.id, combine: best.value.combine, gates: best.value.gates }
      : { deficit: null, absent: true, paragraph: null, combine: perParagraph[0]?.families[family]?.combine ?? null, gates: perParagraph[0]?.families[family]?.gates ?? {} };
  }
  const nearFamilies = FAMILIES.filter((family) => !families[family].absent && families[family].deficit <= NEAR);
  let closest = null;
  for (const family of FAMILIES) {
    const entry = families[family];
    if (entry.absent) continue;
    if (!closest || entry.deficit < families[closest].deficit) closest = family;
  }
  return {
    taxonomy_version: TAXONOMY_VERSION,
    near: NEAR,
    families,
    paragraph_deficits: perParagraph.map((row) => ({
      id: row.id,
      ...Object.fromEntries(FAMILIES.map((family) => [family, row.families[family].deficit])),
    })),
    near_families: nearFamilies,
    min_deficit: closest ? families[closest].deficit : null,
    closest_family: closest,
    advisory: advisoryPresence(analysis),
  };
}

// The decision tree: first matching code wins.
export function classifyMissReason(margins) {
  const near = margins.near_families ?? [];
  if (near.length >= 2) return 'multi-threshold-near';
  if (near.length === 1) return `threshold-near-${near[0]}`;
  if (isNum(margins.min_deficit) && margins.min_deficit < 1) return 'threshold-far';
  if (margins.advisory?.present) return 'advisory-only-coverage-gap';
  return 'no-modeled-signal';
}

// ---------------------------------------------------------------------------
// Per-paragraph signal ids (koDiagnosis.v1). The projection is part of every
// row's signals_hash, so its output must stay byte-stable.

const DIAGNOSIS_SCHEMA = 'koDiagnosis.v1';
const MAX_DIAGNOSIS_SIGNALS = 12;
const MAX_DIAGNOSIS_PARAGRAPHS = 64;

function paragraphSignals(paragraph, analysis) {
  const signals = [];
  if (analysis.burstiness?.band === 'low') signals.push('rhythm:burstiness-low');
  if (analysis.mattr?.band === 'low') signals.push('lexical:mattr-low');
  if (analysis.lexicon?.hot) signals.push('lexical:lexicon-density');
  if (analysis.endingMonotonyHot) signals.push('rhythm:ending-monotony');
  if (analysis.candorHot) signals.push('structure:repeated-candor');
  if (analysis.thematicBreakHot) signals.push('structure:thematic-break');
  for (const reason of analysis.koDiagnostics?.reasons ?? []) {
    signals.push(`rhythm:${reason}`);
  }
  const translationese = detectTranslationese(paragraph, { lang: 'ko' });
  if (translationese.hot) {
    for (const rule of translationese.byRule) {
      signals.push(`translationese:${rule.id}`);
    }
  }
  return [...new Set(signals)].sort().slice(0, MAX_DIAGNOSIS_SIGNALS);
}

function diagnosisRoute(paragraphs) {
  const categories = new Set();
  for (const paragraph of paragraphs) {
    for (const signal of paragraph.signals) {
      if (signal.startsWith('structure:')) categories.add('structure');
      else if (signal.startsWith('rhythm:')) categories.add('rhythm');
      else categories.add('lexical');
    }
  }
  if (categories.size === 0) return 'clean';
  if (categories.size > 1) return 'mixed';
  return [...categories][0];
}

/**
 * Bounded, source-free per-paragraph signal ids. Runs the analyzer with its
 * default (tracked) lexicon, independent of the pinned-lexicon analysis.
 *
 * @param {string} text
 * @param {{repoRoot?: string}} [options]
 */
export function buildKoreanDiagnosis(text, { repoRoot } = {}) {
  const sourceParagraphs = splitParagraphs(String(text ?? ''));
  const analyzed = analyzeText(text, { lang: 'ko', repoRoot });
  const paragraphs = sourceParagraphs
    .slice(0, MAX_DIAGNOSIS_PARAGRAPHS)
    .map((paragraph, index) => {
      const signals = paragraphSignals(paragraph, analyzed.paragraphs[index] ?? {});
      return { id: `P${index + 1}`, signals, preserveOnly: signals.length === 0 };
    });
  return {
    schema: DIAGNOSIS_SCHEMA,
    route: diagnosisRoute(paragraphs),
    omittedParagraphCount: Math.max(0, sourceParagraphs.length - paragraphs.length),
    paragraphs,
  };
}

// ---------------------------------------------------------------------------
// Source-free signal projection: scalars, bands, rule ids and booleans only.

export function projectSignals(analysis, diagnosis) {
  const doc = {
    hot: Boolean(analysis.hot),
    skipped: Boolean(analysis.skipped),
    skip_reason: analysis.skipReason ?? null,
    paragraph_count: analysis.paragraphs.length,
    markup_leakage: {
      leaked: Boolean(analysis.markupLeakage?.leaked),
      hit_count: analysis.markupLeakage?.hits?.length ?? 0,
    },
    discourse_tells: {
      fake_candor: {
        count: analysis.discourseTells?.fakeCandor?.count ?? 0,
        hot: Boolean(analysis.discourseTells?.fakeCandor?.hot),
        threshold: analysis.discourseTells?.fakeCandor?.threshold ?? null,
      },
      thematic_breaks: {
        count: analysis.discourseTells?.thematicBreaks?.count ?? 0,
        hot: Boolean(analysis.discourseTells?.thematicBreaks?.hot),
        threshold: analysis.discourseTells?.thematicBreaks?.threshold ?? null,
      },
    },
    structural_classifier: {
      available: Boolean(analysis.structuralClassifier?.available),
      hot: analysis.structuralClassifier?.hot ?? null,
      score: analysis.structuralClassifier?.score ?? null,
    },
  };
  const paragraphs = analysis.paragraphs.map((p) => ({
    id: p.id,
    sentence_count: p.sentenceCount,
    token_count: p.tokenCount,
    burstiness: { cv: p.burstiness?.cv ?? null, band: p.burstiness?.band ?? null },
    mattr: { value: p.mattr?.value ?? null, band: p.mattr?.band ?? null },
    lexicon: { matches: p.lexicon?.matches ?? 0, density: p.lexicon?.density ?? 0, hot: Boolean(p.lexicon?.hot) },
    spacing: {
      eojeol_count: p.spacing?.eojeolCount ?? null,
      mean_eojeol_length: p.spacing?.meanEojeolLength ?? null,
      eojeol_length_cv: p.spacing?.eojeolLengthCV ?? null,
      single_syllable_ratio: p.spacing?.singleSyllableRatio ?? null,
      long_eojeol_ratio: p.spacing?.longEojeolRatio ?? null,
    },
    comma: {
      count: p.comma?.count ?? null,
      per_sentence: p.comma?.perSentence ?? null,
      per_100_chars: p.comma?.per100Chars ?? null,
    },
    pos_diversity: {
      eojeol_count: p.posDiversity?.eojeolCount ?? null,
      matched_count: p.posDiversity?.matchedCount ?? null,
      coverage: p.posDiversity?.coverage ?? null,
      distinct_class_count: p.posDiversity?.distinctClassCount ?? null,
      class_diversity: p.posDiversity?.classDiversity ?? null,
      distinct_suffix_count: p.posDiversity?.distinctSuffixCount ?? null,
      suffix_diversity: p.posDiversity?.suffixDiversity ?? null,
    },
    ko_diagnostics: {
      hot: Boolean(p.koDiagnostics?.hot),
      strength: p.koDiagnostics?.strength ?? 0,
      reasons: [...(p.koDiagnostics?.reasons ?? [])],
    },
    ending_monotony: {
      da_count: p.endingMonotony?.daCount ?? null,
      da_ratio: p.endingMonotony?.daRatio ?? null,
      hot: Boolean(p.endingMonotonyHot),
    },
    candor: { count: p.candorCount ?? 0, hot: Boolean(p.candorHot) },
    thematic_break: { count: p.thematicBreakCount ?? 0, hot: Boolean(p.thematicBreakHot), only: Boolean(p.thematicBreakOnly) },
    hot: Boolean(p.hot),
  }));
  const translationese = analysis.translationese ?? {};
  const postEditese = analysis.koPostEditese ?? {};
  const advisory = {
    translationese: {
      count: translationese.count ?? 0,
      density: translationese.density ?? 0,
      sentences: translationese.sentences ?? 0,
      hot: Boolean(translationese.hot),
      by_rule: (translationese.byRule ?? []).map((rule) => ({ id: rule.id, count: rule.count, strong: Boolean(rule.strong) })),
    },
    ko_post_editese: {
      analyzed: Boolean(postEditese.analyzed),
      skip_reason: postEditese.skipReason ?? null,
      paragraph_count: postEditese.paragraphCount ?? 0,
      sentence_count: postEditese.sentenceCount ?? 0,
      eojeol_count: postEditese.eojeolCount ?? 0,
      metrics: numericOnly(postEditese.metrics ?? {}),
    },
  };
  const diag = diagnosis
    ? {
        schema: diagnosis.schema,
        route: diagnosis.route,
        omitted_paragraph_count: diagnosis.omittedParagraphCount ?? 0,
        paragraphs: (diagnosis.paragraphs ?? []).map((p) => ({ id: p.id, signals: [...p.signals], preserve_only: Boolean(p.preserveOnly) })),
      }
    : null;
  return roundDeep({ document: doc, paragraphs, advisory, diagnosis: diag });
}

function numericOnly(value) {
  if (Array.isArray(value)) return value.map(numericOnly);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry === null || typeof entry === 'number' || typeof entry === 'boolean') out[key] = entry;
      else if (entry && typeof entry === 'object') out[key] = numericOnly(entry);
    }
    return out;
  }
  return typeof value === 'number' || typeof value === 'boolean' ? value : null;
}

// ---------------------------------------------------------------------------
// Extraction.

export function selectPopulation(records) {
  return records.filter((record) => Object.entries(POPULATION).every(([key, value]) => record[key] === value));
}

export function readJsonl(path, repoRoot = REPO_ROOT) {
  const abs = resolve(repoRoot, path);
  if (!existsSync(abs)) throw new Error(`JSONL input not found: ${toRepoRelative(abs, repoRoot)}`);
  const bytes = readFileSync(abs);
  const rows = [];
  const lines = bytes.toString('utf8').split(/\r?\n/u);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index].trim();
    if (!line) continue;
    try {
      rows.push(JSON.parse(line));
    } catch (error) {
      throw new Error(`${toRepoRelative(abs, repoRoot)}:${index + 1}: invalid JSON (${error.message})`, { cause: error });
    }
  }
  return { rows, bytes, path: abs, relativePath: toRepoRelative(abs, repoRoot) };
}

export function gitProvenance(repoRoot = REPO_ROOT) {
  const run = (args) => {
    try {
      return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return null;
    }
  };
  const dirty = run(['status', '--porcelain', '--', 'src/features', DEFAULT_LEXICON_PATH]);
  return {
    git_commit: run(['rev-parse', 'HEAD']),
    features_tree: run(['rev-parse', 'HEAD:src/features']),
    worktree_clean: dirty === null ? null : dirty.length === 0,
  };
}

/**
 * Build the miss-review manifest.
 *
 * @param {object} options
 * @param {string} [options.sourceManifest]
 * @param {string} [options.privateCorpus]
 * @param {string} [options.repoRoot]
 * @param {string} [options.analyzedAt] ISO timestamp pinned for reproducible runs
 * @param {'fail'|'exclude'} [options.onDrift] what to do with rows the current analyzer now flags hot
 * @param {object} [options.provenance] override for git provenance (tests)
 */
export function extractMissReview(options = {}) {
  const repoRoot = options.repoRoot || REPO_ROOT;
  const onDrift = options.onDrift || 'fail';
  const analyzedAt = options.analyzedAt || new Date().toISOString();
  const errors = [];
  const warnings = [];

  const customLexicon = resolve(repoRoot, 'custom', 'lexicon', 'ai-ko.md');
  if (existsSync(customLexicon)) {
    errors.push('custom/lexicon/ai-ko.md exists; remove it so the diagnosis path uses the tracked lexicon');
  }

  let source;
  let corpus;
  try {
    source = readJsonl(options.sourceManifest || DEFAULT_SOURCE_MANIFEST, repoRoot);
    corpus = readJsonl(options.privateCorpus || DEFAULT_PRIVATE_CORPUS, repoRoot);
  } catch (error) {
    errors.push(error.message);
  }
  if (errors.length) return { rows: [], exclusions: [], errors, warnings, population: null, provenance: null };

  const sourceManifestHash = `sha256:${sha256Hex(source.bytes)}`;
  const population = selectPopulation(source.rows).sort((a, b) => String(a.sample_id).localeCompare(String(b.sample_id)));
  const byId = new Map();
  for (const row of corpus.rows) {
    if (row.sample_id) byId.set(row.sample_id, row);
  }
  const pinned = loadPinnedLexicon(repoRoot, options.lexiconPath);
  const analyzerOptions = activeAnalyzerOptions();
  const optionsHash = `sha256:${sha256Hex(JSON.stringify(analyzerOptions))}`;
  const git = options.provenance || gitProvenance(repoRoot);
  if (git.worktree_clean === false) warnings.push('src/features or lexicon/ai-ko.md has uncommitted changes; git_commit does not describe the analyzer that ran');

  const rows = [];
  const exclusions = [];
  const seenHashes = new Set();
  for (const record of population) {
    const label = record.sample_id || '<no sample_id>';
    const privateRow = byId.get(record.sample_id);
    if (!privateRow || typeof privateRow.text !== 'string' || privateRow.text.length === 0) {
      errors.push(`${label}: private text not found in corpus`);
      continue;
    }
    const observedHash = hashText(privateRow.text);
    if (observedHash !== record.text_hash) {
      errors.push(`${label}: text_hash mismatch between manifest and private corpus`);
      continue;
    }
    if (seenHashes.has(observedHash)) {
      errors.push(`${label}: duplicate text_hash in population`);
      continue;
    }
    seenHashes.add(observedHash);

    const normalized = privateRow.text.normalize('NFC');
    const analysis = analyzeText(privateRow.text, { ...analyzerOptions, lexicon: pinned.lexicon });
    const diagnosis = buildKoreanDiagnosis(privateRow.text, { repoRoot });
    const signals = projectSignals(analysis, diagnosis);
    const base = {
      schema: SCHEMA,
      sample_id: record.sample_id,
      language: record.language,
      class: record.class,
      model_family: record.model_family,
      register: record.register,
      provider: record.provider,
      model: record.model,
      generated_at: record.generated_at,
      prompt_id: record.prompt_id,
      decoding: record.decoding,
      postprocess: record.postprocess,
      expected_hot: record.expected_hot,
      predicted_hot: record.predicted_hot,
      patina_score: record.patina_score,
      score_review: record.score_review,
      redistribution: 'hash-only',
      text_hash: record.text_hash,
      source_review: record.source_review,
      source_doc: SOURCE_DOC,
      source_manifest: source.relativePath,
      source_manifest_hash: sourceManifestHash,
      analysis_provenance: {
        git_commit: git.git_commit,
        features_tree: git.features_tree,
        lexicon_path: pinned.lexicon_path,
        lexicon_version: pinned.lexicon_version,
        lexicon_hash: `sha256:${pinned.lexicon_hash}`,
        options_hash: optionsHash,
        analyzed_at: analyzedAt,
        normalized_text_hash: hashText(normalized),
        signals_hash: `sha256:${sha256Hex(JSON.stringify(signals))}`,
      },
      analysis_role: ANALYSIS_ROLE,
      analysis_options: analyzerOptions,
    };

    if (analysis.hot) {
      const hotSignals = [...new Set((diagnosis.paragraphs ?? []).flatMap((p) => p.signals))].sort();
      const exclusion = {
        schema: EXCLUSION_SCHEMA,
        sample_id: record.sample_id,
        register: record.register,
        model_family: record.model_family,
        provider: record.provider,
        model: record.model,
        text_hash: record.text_hash,
        source_manifest: source.relativePath,
        source_manifest_hash: sourceManifestHash,
        analysis_provenance: base.analysis_provenance,
        exclusion_reason: 'precondition-violated:document-hot',
        hot_signals: hotSignals,
        markup_leakage: signals.document.markup_leakage.leaked,
        structural_classifier_hot: signals.document.structural_classifier.hot,
      };
      if (onDrift === 'exclude') {
        exclusions.push(exclusion);
        continue;
      }
      errors.push(`${label}: current analyzer flags the document hot (${hotSignals.join(', ') || 'document-level'}); rerun with --on-drift exclude to record it as an exclusion`);
      continue;
    }

    const margins = computeMargins(analysis, analyzerOptions);
    rows.push({
      ...base,
      signals,
      margins,
      computed_reason: classifyMissReason(margins),
      taxonomy_version: TAXONOMY_VERSION,
      review: null,
    });
  }

  return {
    rows,
    exclusions,
    errors,
    warnings,
    population: {
      source_manifest: source.relativePath,
      source_manifest_hash: sourceManifestHash,
      source_rows: source.rows.length,
      candidates: population.length,
      selected: rows.length,
      excluded: exclusions.length,
      filter: { ...POPULATION },
    },
    provenance: { ...git, options_hash: optionsHash, lexicon_hash: `sha256:${pinned.lexicon_hash}`, lexicon_version: pinned.lexicon_version, analyzed_at: analyzedAt },
  };
}

// ---------------------------------------------------------------------------
// Validation.

export function validateRow(row, index = 0) {
  const errors = [];
  const warnings = [];
  const label = row?.sample_id ? `row ${index + 1} (${row.sample_id})` : `row ${index + 1}`;
  const err = (message) => errors.push(`${label}: ${message}`);
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    errors.push(`${label}: row must be a JSON object`);
    return { errors, warnings };
  }
  const literal = (key, expected) => {
    if (row[key] !== expected) err(`${key} must be ${JSON.stringify(expected)}`);
  };
  literal('schema', SCHEMA);
  literal('language', POPULATION.language);
  literal('class', POPULATION.class);
  literal('model_family', POPULATION.model_family);
  literal('expected_hot', true);
  literal('predicted_hot', false);
  literal('redistribution', 'hash-only');
  literal('source_doc', SOURCE_DOC);
  literal('analysis_role', ANALYSIS_ROLE);
  literal('taxonomy_version', TAXONOMY_VERSION);
  if (typeof row.sample_id !== 'string' || !row.sample_id.trim()) err('sample_id must be a non-empty string');
  if (!REGISTERS.includes(row.register)) err(`register must be one of ${REGISTERS.join(', ')}`);
  for (const key of ['provider', 'model', 'prompt_id', 'source_manifest']) {
    if (typeof row[key] !== 'string' || !row[key].trim()) err(`${key} must be a non-empty string`);
  }
  if (!row.generated_at || Number.isNaN(Date.parse(row.generated_at))) err('generated_at must be an ISO-like date');
  for (const key of ['decoding', 'postprocess', 'score_review', 'source_review', 'analysis_provenance', 'analysis_options', 'signals', 'margins']) {
    if (!row[key] || typeof row[key] !== 'object' || Array.isArray(row[key])) err(`${key} must be an object`);
  }
  if (!isNum(row.patina_score) || row.patina_score < 0 || row.patina_score > 100) err('patina_score must be a number in [0,100]');
  if (!SHA256_RE.test(String(row.text_hash))) err('text_hash must use sha256:<64 lowercase hex>');
  if (!SHA256_RE.test(String(row.source_manifest_hash))) err('source_manifest_hash must use sha256:<64 lowercase hex>');
  if (row.source_review && (!row.source_review.status || !row.source_review.rationale)) err('source_review needs status and rationale');
  if (row.text !== undefined) err('text must not be present');

  const provenance = row.analysis_provenance || {};
  for (const key of ['options_hash', 'normalized_text_hash', 'signals_hash', 'lexicon_hash']) {
    if (!SHA256_RE.test(String(provenance[key]))) err(`analysis_provenance.${key} must use sha256:<64 lowercase hex>`);
  }
  if (typeof provenance.git_commit !== 'string' || !/^[0-9a-f]{7,40}$/u.test(provenance.git_commit)) err('analysis_provenance.git_commit must be a git SHA');
  if (!provenance.analyzed_at || Number.isNaN(Date.parse(provenance.analyzed_at))) err('analysis_provenance.analyzed_at must be an ISO timestamp');
  if (row.signals && provenance.signals_hash && `sha256:${sha256Hex(JSON.stringify(row.signals))}` !== provenance.signals_hash) err('signals_hash does not match signals');
  if (row.analysis_options && provenance.options_hash && `sha256:${sha256Hex(JSON.stringify(row.analysis_options))}` !== provenance.options_hash) err('options_hash does not match analysis_options');

  if (row.signals?.document) {
    if (row.signals.document.hot !== false) err('signals.document.hot must be false (precondition triple)');
    if (row.signals.document.markup_leakage?.leaked !== false) err('signals.document.markup_leakage.leaked must be false');
    if (!Array.isArray(row.signals.paragraphs) || row.signals.paragraphs.length === 0) err('signals.paragraphs must be a non-empty array');
    for (const p of row.signals.paragraphs ?? []) {
      if (p.hot !== false) err(`signals.paragraphs ${p.id}: hot must be false`);
      for (const key of ['sentence_count', 'token_count']) if (!isNum(p[key])) err(`signals.paragraphs ${p.id}: ${key} must be a finite number`);
    }
  }

  const margins = row.margins || {};
  if (margins.taxonomy_version !== TAXONOMY_VERSION) err('margins.taxonomy_version mismatch');
  if (margins.near !== NEAR) err(`margins.near must be ${NEAR}`);
  for (const family of FAMILIES) {
    const entry = margins.families?.[family];
    if (!entry) {
      err(`margins.families.${family} missing`);
      continue;
    }
    if (entry.absent) {
      if (entry.deficit !== null) err(`margins.families.${family}: absent entries carry deficit null`);
    } else if (!isNum(entry.deficit) || entry.deficit < 0) err(`margins.families.${family}: deficit must be a finite number >= 0`);
  }
  if (margins.families) {
    const recomputedNear = FAMILIES.filter((family) => margins.families[family] && !margins.families[family].absent && margins.families[family].deficit <= NEAR);
    if (JSON.stringify(recomputedNear) !== JSON.stringify(margins.near_families ?? null)) err('margins.near_families does not follow from family deficits');
    const computed = classifyMissReason(margins);
    if (row.computed_reason !== computed) err(`computed_reason ${row.computed_reason} does not follow the decision tree (${computed})`);
  }
  if (!MISS_REASONS.includes(row.computed_reason)) err('computed_reason must be a taxonomy code');

  for (const key of collectBannedKeys(row)) err(`banned key present: ${key}`);
  const hangulPath = findHangul(row);
  if (hangulPath) err(`Hangul text is not allowed in a public row (${hangulPath})`);

  if (row.review === null || row.review === undefined) {
    warnings.push(`${label}: unreviewed`);
  } else {
    validateReview(row, err);
  }
  return { errors, warnings };
}

function validateReview(row, err) {
  const review = row.review;
  if (!review || typeof review !== 'object') return err('review must be an object or null');
  const labels = Array.isArray(review.labels) ? review.labels : [];
  if (labels.length < 2) err('review.labels needs at least two independent labels');
  const reviewers = new Set();
  for (const entry of labels) {
    if (!entry || typeof entry.reviewer !== 'string' || !entry.reviewer.trim()) err('review label needs a pseudonymous reviewer');
    else reviewers.add(entry.reviewer);
    if (!entry?.reviewed_at || Number.isNaN(Date.parse(entry.reviewed_at))) err('review label needs an ISO reviewed_at');
    if (!MISS_REASONS.includes(entry?.miss_reason)) err(`review label miss_reason ${entry?.miss_reason} is not a taxonomy code`);
    if (entry?.reviewer_notes !== undefined && entry?.reviewer_notes !== null && (typeof entry.reviewer_notes !== 'string' || entry.reviewer_notes.length > 1000)) err('review label notes must be a string of at most 1000 chars');
  }
  if (reviewers.size !== labels.length) err('review labels must come from distinct reviewers');
  const distinct = new Set(labels.map((entry) => entry?.miss_reason));
  const disagreement = distinct.size > 1;
  if (review.disagreement !== disagreement) err(`review.disagreement must be ${disagreement}`);
  if (!MISS_REASONS.includes(review.final_reason)) err('review.final_reason must be a taxonomy code');
  if (disagreement) {
    const adj = review.adjudication;
    if (!adj || typeof adj !== 'object') err('disagreement requires review.adjudication');
    else {
      if (typeof adj.reviewer !== 'string' || !adj.reviewer.trim()) err('adjudication needs a reviewer');
      if (reviewers.has(adj.reviewer)) err('adjudicator must differ from the original reviewers');
      if (!MISS_REASONS.includes(adj.final_reason) || adj.final_reason !== review.final_reason) err('adjudication.final_reason must equal review.final_reason');
      if (typeof adj.rationale !== 'string' || !adj.rationale.trim()) err('adjudication needs a rationale');
      if (!adj.reviewed_at || Number.isNaN(Date.parse(adj.reviewed_at))) err('adjudication needs an ISO reviewed_at');
    }
  } else if (labels.length && review.final_reason !== labels[0]?.miss_reason) err('review.final_reason must equal the agreed label');
  if (review.final_reason !== row.computed_reason && !(review.adjudication && review.adjudication.rationale)) {
    err('final_reason differs from computed_reason without an adjudication rationale');
  }
  if (row.miss_reason !== review.final_reason) err('miss_reason must equal review.final_reason');
  if (typeof row.reviewer !== 'string' || !row.reviewer.trim()) err('reviewer must be a pseudonymous string');
  if (!row.reviewed_at || Number.isNaN(Date.parse(row.reviewed_at))) err('reviewed_at must be an ISO timestamp');
  if (typeof row.reviewer_notes !== 'string' || row.reviewer_notes.length < 1 || row.reviewer_notes.length > 1000) err('reviewer_notes must be 1-1000 chars');
}

export function validateExclusion(row, index = 0) {
  const errors = [];
  const label = row?.sample_id ? `exclusion ${index + 1} (${row.sample_id})` : `exclusion ${index + 1}`;
  const err = (message) => errors.push(`${label}: ${message}`);
  if (!row || typeof row !== 'object') {
    err('must be a JSON object');
    return { errors, warnings: [] };
  }
  if (row.schema !== EXCLUSION_SCHEMA) err(`schema must be ${EXCLUSION_SCHEMA}`);
  if (typeof row.sample_id !== 'string' || !row.sample_id) err('sample_id missing');
  if (!REGISTERS.includes(row.register)) err('register invalid');
  if (!SHA256_RE.test(String(row.text_hash))) err('text_hash invalid');
  if (!SHA256_RE.test(String(row.source_manifest_hash))) err('source_manifest_hash invalid');
  if (row.exclusion_reason !== 'precondition-violated:document-hot') err('exclusion_reason must be precondition-violated:document-hot');
  if (!Array.isArray(row.hot_signals)) err('hot_signals must be an array of signal ids');
  if (row.text !== undefined) err('text must not be present');
  const hangulPath = findHangul(row);
  if (hangulPath) err(`Hangul text is not allowed (${hangulPath})`);
  return { errors, warnings: [] };
}

/**
 * Validate a manifest (+ optional exclusions) against the contract.
 *
 * @param {object} options
 * @param {object[]} options.rows
 * @param {object[]} [options.exclusions]
 * @param {boolean} [options.requireReview]
 * @param {string} [options.sourceManifest] path; when given, population binding is checked
 * @param {string} [options.privateCorpus] path; when present, regeneration + leak checks run
 * @param {string} [options.repoRoot]
 */
export function validateMissReview(options) {
  const repoRoot = options.repoRoot || REPO_ROOT;
  const rows = options.rows || [];
  const exclusions = options.exclusions || [];
  const errors = [];
  const warnings = [];
  const ids = new Set();
  const hashes = new Set();
  rows.forEach((row, index) => {
    const checked = validateRow(row, index);
    errors.push(...checked.errors);
    warnings.push(...checked.warnings);
    if (row?.sample_id) {
      if (ids.has(row.sample_id)) errors.push(`duplicate sample_id ${row.sample_id}`);
      ids.add(row.sample_id);
    }
    if (row?.text_hash) {
      if (hashes.has(row.text_hash)) errors.push(`duplicate text_hash on ${row.sample_id}`);
      hashes.add(row.text_hash);
    }
  });
  exclusions.forEach((row, index) => {
    errors.push(...validateExclusion(row, index).errors);
    if (row?.sample_id && ids.has(row.sample_id)) errors.push(`exclusion ${row.sample_id} also appears as a reviewed row`);
  });
  if (options.requireReview) {
    const unreviewed = rows.filter((row) => !row?.review).map((row) => row?.sample_id).filter(Boolean);
    if (unreviewed.length) errors.push(`unreviewed rows: ${unreviewed.join(', ')}`);
  }
  const manifestHashes = new Set(rows.map((row) => row?.source_manifest_hash).concat(exclusions.map((row) => row?.source_manifest_hash)));
  if (manifestHashes.size > 1) errors.push('rows are bound to more than one source_manifest_hash');

  let population = null;
  if (options.sourceManifest) {
    try {
      const source = readJsonl(options.sourceManifest, repoRoot);
      const sourceHash = `sha256:${sha256Hex(source.bytes)}`;
      const expected = selectPopulation(source.rows);
      const expectedIds = new Set(expected.map((row) => row.sample_id));
      const seen = new Set([...rows.map((row) => row?.sample_id), ...exclusions.map((row) => row?.sample_id)]);
      for (const id of expectedIds) if (!seen.has(id)) errors.push(`population row ${id} is missing from manifest and exclusions`);
      for (const id of seen) if (id && !expectedIds.has(id)) errors.push(`${id} is not in the frozen population`);
      for (const row of rows) {
        if (row?.source_manifest_hash && row.source_manifest_hash !== sourceHash) errors.push(`${row.sample_id}: source_manifest_hash does not match ${source.relativePath}`);
        const src = expected.find((entry) => entry.sample_id === row?.sample_id);
        if (!src) continue;
        for (const key of ['register', 'provider', 'model', 'generated_at', 'prompt_id', 'text_hash', 'patina_score']) {
          if (JSON.stringify(src[key]) !== JSON.stringify(row[key])) errors.push(`${row.sample_id}: ${key} differs from the source manifest`);
        }
        for (const key of ['decoding', 'postprocess', 'score_review', 'source_review']) {
          if (JSON.stringify(src[key]) !== JSON.stringify(row[key])) errors.push(`${row.sample_id}: ${key} was not copied losslessly`);
        }
      }
      population = { candidates: expected.length, selected: rows.length, excluded: exclusions.length, source_manifest_hash: sourceHash };
    } catch (error) {
      errors.push(error.message);
    }
  }

  let regeneration = null;
  const corpusPath = options.privateCorpus ? resolve(repoRoot, options.privateCorpus) : null;
  if (corpusPath && existsSync(corpusPath) && options.sourceManifest) {
    const regen = extractMissReview({
      sourceManifest: options.sourceManifest,
      privateCorpus: options.privateCorpus,
      repoRoot,
      onDrift: 'exclude',
      analyzedAt: rows[0]?.analysis_provenance?.analyzed_at,
      provenance: { git_commit: rows[0]?.analysis_provenance?.git_commit, features_tree: rows[0]?.analysis_provenance?.features_tree, worktree_clean: null },
      lexiconPath: options.lexiconPath,
    });
    errors.push(...regen.errors.map((message) => `regeneration: ${message}`));
    const regenById = new Map(regen.rows.map((row) => [row.sample_id, row]));
    let identical = 0;
    for (const row of rows) {
      const fresh = regenById.get(row?.sample_id);
      if (!fresh) {
        if (regen.exclusions.some((entry) => entry.sample_id === row?.sample_id)) errors.push(`${row.sample_id}: the current analyzer now flags this row hot`);
        continue;
      }
      const same =
        JSON.stringify(fresh.signals) === JSON.stringify(row.signals) &&
        JSON.stringify(fresh.margins) === JSON.stringify(row.margins) &&
        fresh.computed_reason === row.computed_reason &&
        fresh.analysis_provenance.options_hash === row.analysis_provenance?.options_hash &&
        fresh.analysis_provenance.lexicon_hash === row.analysis_provenance?.lexicon_hash &&
        fresh.analysis_provenance.normalized_text_hash === row.analysis_provenance?.normalized_text_hash;
      if (same) identical++;
      else errors.push(`${row.sample_id}: regeneration is not byte-identical (signals/margins/computed_reason/provenance)`);
    }
    const regenExcluded = new Set(regen.exclusions.map((entry) => entry.sample_id));
    for (const entry of exclusions) if (!regenExcluded.has(entry?.sample_id)) errors.push(`${entry?.sample_id}: recorded as excluded but the current analyzer does not flag it hot`);
    // Leak check: no LEAK_WINDOW-character span of a free-text value may occur
    // inside any source text (whitespace collapsed, NFC). Quoted fragments
    // shorter than the window are already caught by the Hangul ban.
    try {
      const corpus = readJsonl(options.privateCorpus, repoRoot);
      const texts = corpus.rows.map((row) => collapse(String(row.text ?? ''))).filter(Boolean);
      for (const row of rows) {
        const leaked = collectStrings(row, FREE_TEXT_PATHS).some((value) => leaksInto(value, texts));
        if (leaked) errors.push(`${row.sample_id}: a free-text value is a substring of a private source text`);
      }
    } catch (error) {
      errors.push(`leak check: ${error.message}`);
    }
    regeneration = { checked: rows.length, identical };
  } else if (corpusPath && !existsSync(corpusPath)) {
    warnings.push('private corpus not present; regeneration and leak checks skipped');
  }

  return { errors, warnings, population, regeneration, counts: { rows: rows.length, exclusions: exclusions.length, reviewed: rows.filter((row) => row?.review).length } };
}

// ---------------------------------------------------------------------------
// Blinding.

export function blindKey(corpusHash, reviewer, sampleId) {
  return sha256Hex(`${corpusHash}\0${reviewer}\0${sampleId}`);
}

export function blindOrder(rows, reviewer) {
  return rows
    .map((row) => ({ row, key: blindKey(row.source_manifest_hash, reviewer, row.sample_id) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((entry, index) => ({ row: entry.row, blind_id: `${reviewer}-${String(index + 1).padStart(3, '0')}` }));
}

export function buildBlindSheet(rows, reviewer, { includeLabels = false } = {}) {
  if (!/^[a-z][a-z0-9-]{1,31}$/u.test(reviewer)) throw new Error('reviewer must be a short pseudonymous slug ([a-z][a-z0-9-]{1,31})');
  const ordered = blindOrder(rows, reviewer);
  const header = {
    sheet_schema: SHEET_SCHEMA,
    reviewer,
    taxonomy_version: TAXONOMY_VERSION,
    near: NEAR,
    codes: [...MISS_REASONS],
    row_count: ordered.length,
    source_manifest_hash: rows[0]?.source_manifest_hash ?? null,
    analysis_options: rows[0]?.analysis_options ?? null,
    instructions: 'Lock miss_reason per row from the margins block by the decision tree only; write reviewer_notes as a short paraphrase without quotation; never consult source text.',
  };
  const sheetRows = ordered.map(({ row, blind_id }) => {
    const entry = {
      blind_id,
      signals: row.signals,
      margins: stripTaxonomyOutputs(row.margins),
      miss_reason: null,
      reviewer_notes: null,
    };
    if (includeLabels) entry.labels = row.review?.labels ?? [];
    return entry;
  });
  return { header, rows: sheetRows };
}

// The margins block shown to reviewers keeps deficits and gates but drops the
// extractor's own tree outputs so the reviewer derives them independently.
function stripTaxonomyOutputs(margins) {
  const { near_families: _near, closest_family: _closest, min_deficit: _min, ...rest } = margins;
  return rest;
}

export function parseSheet(rows) {
  if (!rows.length || rows[0].sheet_schema !== SHEET_SCHEMA) throw new Error(`sheet must start with a ${SHEET_SCHEMA} header line`);
  return { header: rows[0], rows: rows.slice(1) };
}

/**
 * Merge reviewer sheets back into the manifest.
 *
 * @param {object[]} rows manifest rows
 * @param {{header: object, rows: object[]}[]} sheets
 * @param {{rows: object[]} | null} adjudication sheet rows: {blind_id, final_reason, rationale, reviewed_at}
 * @param {string} [adjudicator]
 */
export function mergeReviews(rows, sheets, adjudication = null, adjudicator = null) {
  const errors = [];
  const byId = new Map(rows.map((row) => [row.sample_id, { ...row }]));
  const labelsById = new Map();
  for (const sheet of sheets) {
    const reviewer = sheet.header.reviewer;
    if (sheet.header.source_manifest_hash !== rows[0]?.source_manifest_hash) errors.push(`sheet ${reviewer}: bound to a different source manifest`);
    const mapping = new Map(blindOrder(rows, reviewer).map((entry) => [entry.blind_id, entry.row.sample_id]));
    for (const entry of sheet.rows) {
      const sampleId = mapping.get(entry.blind_id);
      if (!sampleId) {
        errors.push(`sheet ${reviewer}: unknown blind_id ${entry.blind_id}`);
        continue;
      }
      if (!MISS_REASONS.includes(entry.miss_reason)) {
        errors.push(`sheet ${reviewer}: ${entry.blind_id} has no valid miss_reason`);
        continue;
      }
      if (typeof entry.reviewer_notes === 'string' && HANGUL_RE.test(entry.reviewer_notes)) errors.push(`sheet ${reviewer}: ${entry.blind_id} notes contain Hangul`);
      if (!labelsById.has(sampleId)) labelsById.set(sampleId, []);
      labelsById.get(sampleId).push({
        reviewer,
        reviewed_at: entry.reviewed_at || sheet.header.reviewed_at || null,
        miss_reason: entry.miss_reason,
        reviewer_notes: typeof entry.reviewer_notes === 'string' ? entry.reviewer_notes.slice(0, 1000) : null,
        blind_id: entry.blind_id,
      });
    }
  }
  const adjudicationById = new Map();
  if (adjudication) {
    if (!adjudicator) errors.push('adjudication sheet needs an adjudicator id');
    const mapping = adjudicator ? new Map(blindOrder(rows, adjudicator).map((entry) => [entry.blind_id, entry.row.sample_id])) : new Map();
    for (const entry of adjudication.rows) {
      const sampleId = mapping.get(entry.blind_id);
      if (!sampleId) {
        errors.push(`adjudication: unknown blind_id ${entry.blind_id}`);
        continue;
      }
      adjudicationById.set(sampleId, entry);
    }
  }
  const unresolved = [];
  let agreements = 0;
  const confusion = {};
  for (const [sampleId, row] of byId) {
    const labels = labelsById.get(sampleId) ?? [];
    if (labels.length < 2) {
      errors.push(`${sampleId}: fewer than two labels`);
      continue;
    }
    const distinct = new Set(labels.map((entry) => entry.miss_reason));
    const disagreement = distinct.size > 1;
    const pair = `${labels[0].miss_reason}|${labels[1].miss_reason}`;
    confusion[pair] = (confusion[pair] ?? 0) + 1;
    let finalReason = labels[0].miss_reason;
    let adjudicationRecord = null;
    if (disagreement) {
      const adj = adjudicationById.get(sampleId);
      if (!adj || !MISS_REASONS.includes(adj.final_reason) || !adj.rationale) {
        unresolved.push(sampleId);
        continue;
      }
      finalReason = adj.final_reason;
      adjudicationRecord = { reviewer: adjudicator, reviewed_at: adj.reviewed_at || null, final_reason: adj.final_reason, rationale: String(adj.rationale).slice(0, 1000), blind_id: adj.blind_id };
    } else agreements++;
    if (finalReason !== row.computed_reason && !adjudicationRecord) {
      // Both reviewers agreed on a code the extractor did not compute: that is
      // an extraction/config error by the procedure and needs adjudication.
      unresolved.push(sampleId);
      continue;
    }
    const finalLabel = adjudicationRecord ?? labels.find((entry) => entry.miss_reason === finalReason) ?? labels[0];
    row.review = {
      labels: labels.map(({ blind_id: _b, ...rest }) => rest),
      disagreement,
      final_reason: finalReason,
      adjudication: adjudicationRecord ? (({ blind_id: _b, ...rest }) => rest)(adjudicationRecord) : null,
      agrees_with_computed: finalReason === row.computed_reason,
    };
    row.miss_reason = finalReason;
    row.reviewer = adjudicationRecord ? adjudicator : finalLabel.reviewer;
    row.reviewed_at = adjudicationRecord ? adjudicationRecord.reviewed_at : finalLabel.reviewed_at;
    row.reviewer_notes = adjudicationRecord
      ? adjudicationRecord.rationale
      : (labels.map((entry) => entry.reviewer_notes).find((note) => typeof note === 'string' && note.trim()) ?? 'decision tree confirmed from the blinded margins');
  }
  return {
    rows: [...byId.values()],
    errors,
    unresolved,
    agreement: { agreed: agreements, total: rows.length, rate: rows.length ? round(agreements / rows.length) : null },
    confusion,
  };
}

// ---------------------------------------------------------------------------
// Utilities.

export function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function round(value, digits = 6) {
  if (!isNum(value)) return value;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function roundDeep(value) {
  if (Array.isArray(value)) return value.map(roundDeep);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, roundDeep(entry)]));
  return typeof value === 'number' ? round(value) : value;
}

export function collectBannedKeys(value, path = '') {
  const found = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => found.push(...collectBannedKeys(entry, `${path}[${index}]`)));
  } else if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      const here = path ? `${path}.${key}` : key;
      if (BANNED_KEYS.includes(key)) found.push(here);
      found.push(...collectBannedKeys(entry, here));
    }
  }
  return found;
}

export function findHangul(value, path = '') {
  if (typeof value === 'string') return HANGUL_RE.test(value) ? path || '<root>' : null;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      const hit = findHangul(value[index], `${path}[${index}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      const hit = findHangul(entry, path ? `${path}.${key}` : key);
      if (hit) return hit;
    }
  }
  return null;
}

export const LEAK_WINDOW = 12;

function collapse(value) {
  return String(value ?? '').normalize('NFC').replace(/\s+/gu, ' ').trim();
}

export function leaksInto(value, texts) {
  const needle = collapse(value);
  if (needle.length < LEAK_WINDOW) return texts.some((text) => needle.length >= 4 && text.includes(needle));
  for (let start = 0; start + LEAK_WINDOW <= needle.length; start++) {
    const window = needle.slice(start, start + LEAK_WINDOW);
    if (texts.some((text) => text.includes(window))) return true;
  }
  return false;
}

function collectStrings(row, topLevelKeys) {
  const out = [];
  const walk = (value) => {
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') Object.values(value).forEach(walk);
  };
  for (const key of topLevelKeys) walk(row[key]);
  return out;
}

export function toRepoRelative(path, repoRoot = REPO_ROOT) {
  return relative(repoRoot, path) || path;
}

export function writeJsonlString(rows) {
  return rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
}
