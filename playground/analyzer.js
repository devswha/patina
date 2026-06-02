// Browser-safe deterministic analyzer for the patina static playground.
// Mirrors src/features/* without Node-only lexicon loading.

import { PLAYGROUND_LEXICONS } from './data/lexicons.js';

export const SUPPORTED_LANGS = ['ko', 'en', 'zh', 'ja'];
export const DEFAULT_LANG = 'ko';
export const DEFAULT_LEXICON_DENSITY_THRESHOLD = 2.0;
export const DEFAULT_LEXICON_MIN_HOT_MATCHES = {
  default: 1,
  ko: 2,
  zh: 2,
  ja: 2,
};
export const DEFAULT_BURSTINESS_BANDS = { low: 0.30, high: 0.50 };
export const DEFAULT_MATTR_BANDS = { low: 0.55, high: 0.70 };
export const DEFAULT_MATTR_WINDOW = 50;
// Document-level formatting tells (mirror catalog patterns #13 em-dash, #14 boldface).
// These are doc-level by design: 3 em-dashes spread one-per-paragraph must still fire,
// so we count across the whole document and then flag the paragraphs that carry the token.
export const DEFAULT_FORMATTING_THRESHOLDS = {
  emDashDoc: 3, // U+2014 occurrences across the document
  boldDoc: 5, // **bold** spans across the document
};
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

export const SAMPLE_TEXT = {
  ko: '이 솔루션은 혁신적인 접근을 통해 업무 생산성을 극대화하고, 다양한 이해관계자에게 지속 가능한 가치를 제공합니다. 더 나아가 조직의 디지털 전환을 가속화하는 핵심 기반으로 자리매김하고 있습니다.\n\n하지만 현장에서 필요한 것은 거창한 선언보다 오늘 바로 줄어드는 반복 작업입니다.',
  en: 'This transformative solution empowers teams to unlock the full potential of a seamless workflow. In today\'s fast-paced landscape, it serves as a catalyst for meaningful collaboration and sustainable growth.\n\nThe real question is simpler: which repetitive step disappears first?',
  zh: '总而言之，这一方案能够全面提升用户体验，并为未来发展提供新的可能。从长远来看，它将在数字时代发挥着重要作用。\n\n先看一个具体场景：团队每天少复制三次表格。',
  ja: 'まとめると、この仕組みはユーザー体験を向上させ、より良い未来につながります。重要なのは、さまざまな場面で効果的に活用できる点です。\n\nまずは、毎朝の確認作業が一つ減るかどうかを見ます。',
};

const SENTENCE_SPLIT_RE = /[.!?]+\s+|(?<=[。！？…])|\n+/u;
const PARAGRAPH_SPLIT_RE = /\n\s*\n/;
const EDGE_PUNCT_RE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const CJK_TOKEN_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u30FC]|[A-Za-z0-9]+/gu;
const HANGUL_RE = /[\u3131-\u318e\uac00-\ud7a3]/u;
const COMMA_RE = /[,，、]/gu;
const KO_SUFFIX_CLASSES = {
  formal_ending: /(습니다|습니까|합니다|됩니다|입니다|입니다만|했습니다|됩니다)$/u,
  plain_ending: /(다|었다|았다|겠다)$/u,
  topic: /(은|는)$/u,
  subject: /(이|가)$/u,
  object: /을|를$/u,
  location: /(에서|에게|으로|로)$/u,
  connective: /(고|며|지만|면서|도록)$/u,
};

export function normalizeLang(lang) {
  return SUPPORTED_LANGS.includes(lang) ? lang : DEFAULT_LANG;
}

export function splitParagraphs(text) {
  if (!text) return [];
  return text
    .normalize('NFC')
    .split(PARAGRAPH_SPLIT_RE)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

export function splitSentences(paragraph) {
  if (!paragraph) return [];
  return paragraph
    .split(SENTENCE_SPLIT_RE)
    .map((s) => s.trim().replace(/[.!?。！？…]+$/u, ''))
    .filter((s) => s.length > 0);
}

function tokenizeCjk(text) {
  const tokens = [];
  for (const match of text.matchAll(CJK_TOKEN_RE)) {
    const token = match[0].replace(EDGE_PUNCT_RE, '');
    if (token) tokens.push(token);
  }
  return tokens;
}

export function tokenize(text, opts = {}) {
  if (!text) return [];
  if (opts.lang === 'zh' || opts.lang === 'ja') return tokenizeCjk(text);
  return text
    .split(/\s+/)
    .map((chunk) => chunk.replace(EDGE_PUNCT_RE, ''))
    .filter((t) => t.length > 0);
}

export function burstinessCV(sentenceTokenCounts) {
  if (!Array.isArray(sentenceTokenCounts) || sentenceTokenCounts.length < 2) return null;
  const n = sentenceTokenCounts.length;
  const mean = sentenceTokenCounts.reduce((a, b) => a + b, 0) / n;
  if (mean === 0) return null;
  const variance = sentenceTokenCounts.reduce((acc, x) => acc + (x - mean) ** 2, 0) / n;
  return Math.sqrt(variance) / mean;
}

export function mattr(tokens, window = DEFAULT_MATTR_WINDOW) {
  if (!Array.isArray(tokens) || tokens.length === 0) return null;
  const lower = tokens.map((t) => t.toLowerCase());
  if (lower.length < window) return new Set(lower).size / lower.length;
  let sum = 0;
  let count = 0;
  for (let i = 0; i + window <= lower.length; i++) {
    const slice = lower.slice(i, i + window);
    sum += new Set(slice).size / window;
    count++;
  }
  return sum / count;
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

export function koreanSpacingFeatures(paragraph) {
  const eojeols = koreanEojeols(paragraph);
  const lengths = eojeols.map(koreanLength).filter((length) => length > 0);
  const eojeolCount = lengths.length;
  return {
    eojeolCount,
    meanEojeolLength: mean(lengths),
    eojeolLengthCV: coefficientOfVariation(lengths),
    shortEojeolRatio:
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
  const classes = new Set();
  let matchedCount = 0;
  for (const token of eojeols) {
    for (const [className, suffixPattern] of Object.entries(KO_SUFFIX_CLASSES)) {
      if (suffixPattern.test(token)) {
        classes.add(className);
        matchedCount++;
        break;
      }
    }
  }
  return {
    proxy: 'suffix',
    eojeolCount: eojeols.length,
    matchedCount,
    coverage: eojeols.length > 0 ? matchedCount / eojeols.length : null,
    classCount: classes.size,
    classDiversity: matchedCount > 0 ? classes.size / matchedCount : null,
    classes: Array.from(classes).sort(),
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

function phraseToRegex(phrase) {
  const escaped = phrase.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(escaped.replace(/~/g, '.{0,40}'), 'u');
}

export function computeDensity(paragraphText, tokens, lexicon) {
  const lowerText = paragraphText.toLowerCase();
  const hits = [];
  const tokenSet = new Set(tokens.map((t) => t.toLowerCase()));
  const cjkSubstring = ['ko', 'zh', 'ja'].includes(lexicon.lang);

  for (const entry of lexicon.strict) {
    const lowerEntry = entry.toLowerCase();
    if (tokenSet.has(lowerEntry)) {
      hits.push(entry);
      continue;
    }
    const hasInternalPunct = /[^\p{L}\p{N}]/u.test(lowerEntry);
    if ((cjkSubstring || hasInternalPunct) && lowerText.includes(lowerEntry)) hits.push(entry);
  }

  for (const phrase of lexicon.phrases) {
    if (phraseToRegex(phrase).test(lowerText)) hits.push(phrase);
  }

  const density = tokens.length > 0 ? (hits.length / tokens.length) * 1000 : 0;
  return { matches: hits.length, density, hits };
}

function fmt(value, digits = 2) {
  return value == null ? 'n/a' : Number(value).toFixed(digits);
}

// Model-output leakage artifacts (issue #332): tokens LLM tooling injects that
// never appear in human prose. A single hit is near-proof-grade, so it forces
// the document hot. Mirrors src/features/markup-leakage.js.
const MARKUP_LEAKAGE_RULES = [
  { id: 'oai-citation-markup', label: 'OpenAI citation markup', build: () => /:contentReference|oaicite|oai_citation/gi },
  { id: 'model-tool-token', label: 'Model tool token', build: () => /\bturn\d+(?:search|view|news|image|forecast|finance|fetch)\d*\b|\bnavlist\b|\bgrok_card\b/gi },
  { id: 'object-replacement-char', label: 'Object-replacement character (￼)', build: () => /￼/g },
  { id: 'ai-tracking-param', label: 'AI-tool tracking parameter in URL', build: () => /utm_source=(?:chatgpt\.com|openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com)|[?&](?:ref|utm_source)=chatgpt/gi },
  { id: 'explicit-self-identification', label: 'Explicit AI self-identification', build: () => /\bas an? (?:AI|artificial intelligence) language model\b|\bas a large language model\b|\bas a language model\b|\bas an AI assistant\b|\bI am an AI\b|\bI'?m an AI\b/gi },
];

export function detectMarkupLeakage(text) {
  const str = typeof text === 'string' ? text : '';
  const hits = [];
  if (!str) return { leaked: false, hits };
  for (const rule of MARKUP_LEAKAGE_RULES) {
    const m = str.match(rule.build());
    if (m && m.length > 0) {
      hits.push({ id: rule.id, label: rule.label, count: m.length, samples: [...new Set(m.map((x) => x.trim()).filter(Boolean))].slice(0, 3) });
    }
  }
  return { leaked: hits.length > 0, hits };
}

// Count formatting tells in a chunk of raw text (em-dash U+2014, markdown **bold** spans).
export function countFormatting(text) {
  const str = String(text ?? '');
  const emDash = (str.match(/—/gu) || []).length;
  const bold = (str.match(/\*\*(?=\S)(?:[^*]|\*(?!\*))+?\*\*/gu) || []).length;
  return { emDash, bold };
}

function buildReasons({ cvBand, mattrBand, lexiconHot, lex, koDiagnostics, formatting, formattingThresholds, leakage }) {
  const reasons = [];
  if (leakage?.leaked) {
    const labels = leakage.hits.map((h) => h.label).join(', ');
    reasons.push({
      code: 'model-output-leakage',
      label: 'Model-output leakage',
      detail: `Pasted-LLM artifact present (${labels}). A single hit is near-proof-grade.`,
    });
  }
  if (formatting?.emDashHot) {
    reasons.push({
      code: 'em-dash-overuse',
      label: 'Em dash overuse',
      detail: `${formatting.docEmDash} em dashes in the document (threshold ${formattingThresholds.emDashDoc}); this paragraph carries ${formatting.emDash}.`,
    });
  }
  if (formatting?.boldHot) {
    reasons.push({
      code: 'bold-overuse',
      label: 'Boldface overuse',
      detail: `${formatting.docBold} bold spans in the document (threshold ${formattingThresholds.boldDoc}); this paragraph carries ${formatting.bold}.`,
    });
  }
  if (cvBand === 'low') {
    reasons.push({
      code: 'low-burstiness',
      label: 'Low burstiness',
      detail: 'Sentence lengths are unusually even, a common polished-LLM tell.',
    });
  }
  if (mattrBand === 'low') {
    reasons.push({
      code: 'low-mattr',
      label: 'Low lexical variety',
      detail: 'The moving type-token ratio is below the editing threshold.',
    });
  }
  if (lexiconHot) {
    reasons.push({
      code: 'lexicon-density',
      label: 'AI-favored phrasing density',
      detail: `${lex.matches} lexicon hit${lex.matches === 1 ? '' : 's'} / ${fmt(lex.density, 1)} per 1k tokens.`,
    });
  } else if (lex.matches > 0) {
    reasons.push({
      code: 'lexicon-hit',
      label: 'AI-favored phrase present',
      detail: `${lex.matches} lexicon hit${lex.matches === 1 ? '' : 's'}, below the hot-zone threshold.`,
    });
  }
  if (koDiagnostics?.hot) {
    reasons.push({
      code: 'ko-diagnostics',
      label: 'Korean rhythm composite',
      detail: `Regular spacing, low comma rhythm, and low suffix diversity matched together (strength ${fmt(koDiagnostics.strength, 1)}).`,
    });
  }
  return reasons;
}

export function analyzePlaygroundText(text, opts = {}) {
  const lang = normalizeLang(opts.lang ?? DEFAULT_LANG);
  const lexicon = PLAYGROUND_LEXICONS[lang];
  const paragraphs = splitParagraphs(text);
  const threshold = opts.lexiconDensityThreshold ?? DEFAULT_LEXICON_DENSITY_THRESHOLD;
  const minHotMatches = opts.lexiconMinHotMatches ?? DEFAULT_LEXICON_MIN_HOT_MATCHES;
  const formattingThresholds = opts.formattingThresholds ?? DEFAULT_FORMATTING_THRESHOLDS;

  // Document-level formatting pass: count tells across all paragraphs first, then
  // attribute hot status to the paragraphs that carry the token (catalog #13/#14 are doc-level).
  const paraFormatting = paragraphs.map(countFormatting);
  const docEmDash = paraFormatting.reduce((sum, f) => sum + f.emDash, 0);
  const docBold = paraFormatting.reduce((sum, f) => sum + f.bold, 0);

  const analyzed = paragraphs.map((paragraph, idx) => {
    const sentences = splitSentences(paragraph);
    const sentenceTokens = sentences.map((sentence) => tokenize(sentence, { lang }));
    const sentenceTokenCounts = sentenceTokens.map((tokens) => tokens.length);
    const tokens = sentenceTokens.flat();
    const cv = burstinessCV(sentenceTokenCounts);
    const cvBand = classifyBurstiness(cv);
    const mattrValue = mattr(tokens);
    const mattrBand = classifyMattr(mattrValue);
    const lex = computeDensity(paragraph, tokens, lexicon);
    const koSignals = lang === 'ko'
      ? buildKoreanSignals(paragraph, sentences.length)
      : {};
    const lexiconHot = classifyLexiconHot(lex, {
      lang,
      densityThreshold: threshold,
      minHotMatches,
    });
    const counts = paraFormatting[idx];
    const emDashHot = docEmDash >= formattingThresholds.emDashDoc && counts.emDash >= 1;
    const boldHot = docBold >= formattingThresholds.boldDoc && counts.bold >= 1;
    const formatting = { ...counts, docEmDash, docBold, emDashHot, boldHot };
    // Model-output leakage (#332): per-paragraph hit, fires on a single occurrence.
    const leakage = detectMarkupLeakage(paragraph);
    const hot =
      cvBand === 'low' ||
      mattrBand === 'low' ||
      lexiconHot ||
      Boolean(koSignals.koDiagnostics?.hot) ||
      emDashHot ||
      boldHot ||
      leakage.leaked;
    const reasons = buildReasons({
      cvBand,
      mattrBand,
      lexiconHot,
      lex,
      koDiagnostics: koSignals.koDiagnostics,
      formatting,
      formattingThresholds,
      leakage,
    });

    return {
      id: `P${idx + 1}`,
      text: paragraph,
      sentenceCount: sentences.length,
      tokenCount: tokens.length,
      sentenceTokenCounts,
      burstiness: { cv, band: cvBand },
      mattr: { value: mattrValue, band: mattrBand },
      lexicon: { ...lex, hot: lexiconHot },
      formatting,
      leakage,
      ...koSignals,
      hot,
      reasons,
    };
  });

  const hotCount = analyzed.filter((p) => p.hot).length;
  const overall = paragraphs.length === 0 ? 0 : Math.round((hotCount / paragraphs.length) * 100);

  return {
    lang,
    overall,
    band: scoreBand(overall),
    paragraphCount: paragraphs.length,
    hotCount,
    totalTokens: analyzed.reduce((sum, p) => sum + p.tokenCount, 0),
    markupLeakage: detectMarkupLeakage(text),
    paragraphs: analyzed,
    auditItems: analyzed.filter((p) => p.hot || p.lexicon.matches > 0),
    note: 'Audit-only deterministic score. It marks editing hotspots, not authorship or intent.',
  };
}

function classifyLexiconHot(
  lexiconStats,
  {
    lang,
    densityThreshold = DEFAULT_LEXICON_DENSITY_THRESHOLD,
    minHotMatches = DEFAULT_LEXICON_MIN_HOT_MATCHES,
  } = {}
) {
  const matches = lexiconStats?.matches ?? 0;
  const density = lexiconStats?.density ?? 0;
  const minMatches = resolveMinHotMatches(lang, minHotMatches);
  return matches >= minMatches && density > densityThreshold;
}

function resolveMinHotMatches(lang, minHotMatches) {
  if (typeof minHotMatches === 'number' && Number.isFinite(minHotMatches)) {
    return Math.max(1, minHotMatches);
  }
  const normalized = typeof lang === 'string' ? lang.toLowerCase() : 'default';
  const value = minHotMatches?.[normalized] ?? minHotMatches?.default;
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(1, value) : 1;
}

export function scoreBand(score) {
  if (score <= 20) return { key: 'low', label: 'Low AI-likeness', tone: 'good' };
  if (score <= 50) return { key: 'mixed', label: 'Mixed signals', tone: 'warn' };
  return { key: 'high', label: 'Review suggested', tone: 'hot' };
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildKoreanSignals(paragraph, sentenceCount) {
  const spacing = koreanSpacingFeatures(paragraph);
  const comma = commaDensity(paragraph, sentenceCount);
  const posDiversity = koreanPosDiversityProxy(paragraph);
  const koDiagnostics = classifyKoreanDiagnostics({
    sentenceCount,
    spacing,
    comma,
    posDiversity,
  });

  return {
    spacing,
    comma,
    posDiversity,
    koDiagnostics,
  };
}

function koreanEojeols(paragraph) {
  if (!paragraph || !HANGUL_RE.test(paragraph)) return [];
  return paragraph
    .split(/\s+/u)
    .map((chunk) => chunk.replace(/^[^\u3131-\u318e\uac00-\ud7a3]+|[^\u3131-\u318e\uac00-\ud7a3]+$/gu, ''))
    .filter((chunk) => HANGUL_RE.test(chunk));
}

function koreanLength(value) {
  return Array.from(value.match(/[\u3131-\u318e\uac00-\ud7a3]/gu) ?? []).length;
}

function mean(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function coefficientOfVariation(values) {
  if (!Array.isArray(values) || values.length < 2) return null;
  const avg = mean(values);
  if (!avg) return null;
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance) / avg;
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

function collectHitRanges(text, hits) {
  const lower = text.toLowerCase();
  const ranges = [];
  for (const hit of [...hits].sort((a, b) => b.length - a.length)) {
    if (hit.includes('~')) continue;
    const needle = hit.toLowerCase();
    let from = 0;
    while (needle && from < lower.length) {
      const idx = lower.indexOf(needle, from);
      if (idx === -1) break;
      ranges.push({ start: idx, end: idx + hit.length });
      from = idx + Math.max(needle.length, 1);
    }
  }
  ranges.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged = [];
  for (const range of ranges) {
    const prev = merged[merged.length - 1];
    if (!prev || range.start >= prev.end) merged.push({ ...range });
  }
  return merged;
}

export function highlightLexiconHits(text, hits) {
  const ranges = collectHitRanges(text, hits);
  if (ranges.length === 0) return escapeHtml(text);
  let html = '';
  let cursor = 0;
  for (const range of ranges) {
    html += escapeHtml(text.slice(cursor, range.start));
    html += `<mark>${escapeHtml(text.slice(range.start, range.end))}</mark>`;
    cursor = range.end;
  }
  html += escapeHtml(text.slice(cursor));
  return html;
}

export function renderAuditDiff(analysis) {
  if (analysis.paragraphCount === 0) {
    return '<p class="empty-state">Paste text to see suspect zones. v1 does not rewrite.</p>';
  }
  return analysis.paragraphs.map((paragraph) => {
    const state = paragraph.hot ? 'hot' : 'clean';
    const badge = paragraph.hot ? 'review' : 'ok';
    const reasons = paragraph.reasons.length > 0
      ? `<ul>${paragraph.reasons.map((r) => `<li><strong>${escapeHtml(r.label)}</strong>: ${escapeHtml(r.detail)}</li>`).join('')}</ul>`
      : '<p class="quiet">No deterministic hotspot in this paragraph.</p>';
    const hits = paragraph.lexicon.hits.length > 0
      ? `<p class="hits">Lexicon hits: ${paragraph.lexicon.hits.map((hit) => `<code>${escapeHtml(hit)}</code>`).join(' ')}</p>`
      : '';
    return `<section class="diff-card ${state}">
      <div class="diff-card__head"><span>${escapeHtml(paragraph.id)}</span><span class="pill ${state}">${badge}</span></div>
      <p>${highlightLexiconHits(paragraph.text, paragraph.lexicon.hits)}</p>
      ${hits}
      ${reasons}
    </section>`;
  }).join('\n');
}

function heredocDelimiter(text) {
  const base = 'PATINA_TEXT';
  let delimiter = base;
  let i = 2;
  while (new RegExp(`^${delimiter}$`, 'm').test(text)) {
    delimiter = `${base}_${i}`;
    i++;
  }
  return delimiter;
}

export function buildCliCommand(text, lang = DEFAULT_LANG) {
  const safeLang = normalizeLang(lang);
  const normalized = (text || '').replace(/\r\n?/g, '\n').trimEnd();
  const delimiter = heredocDelimiter(normalized);
  return [
    `cat > patina-input.txt <<'${delimiter}'`,
    normalized,
    delimiter,
    `npx patina-cli --lang ${safeLang} --score patina-input.txt`,
    `npx patina-cli --lang ${safeLang} --audit patina-input.txt`,
  ].join('\n');
}

export const FALSE_POSITIVE_ISSUE_URL = 'https://github.com/devswha/patina/issues/new';
const FALSE_POSITIVE_MAX_PARAGRAPH_CHARS = 1500;

// Build a GitHub issue URL with the false-positive template pre-filled from the
// current audit. Nothing is sent anywhere — the text only leaves the browser if
// the user chooses to submit the GitHub issue, preserving the in-browser privacy
// promise while removing the copy/paste friction of reporting by hand.
export function buildFalsePositiveReportUrl(text, lang = DEFAULT_LANG, analysis = null) {
  const safeLang = normalizeLang(lang);
  const result = analysis ?? analyzePlaygroundText(text || '', { lang: safeLang });
  const hotParas = result.paragraphs.filter((p) => p.hot);
  const source = hotParas.length ? hotParas : result.paragraphs;

  let fired = source.map((p) => p.text).join('\n\n').trim();
  if (!fired) fired = (text || '').trim();
  if (fired.length > FALSE_POSITIVE_MAX_PARAGRAPH_CHARS) {
    fired = `${fired.slice(0, FALSE_POSITIVE_MAX_PARAGRAPH_CHARS)}\n…(truncated — paste the rest if it matters)`;
  }

  const signals =
    [...new Set(source.flatMap((p) => p.reasons.map((r) => r.label)))].join(', ') || 'none';
  const lexiconHits = result.paragraphs.reduce((sum, p) => sum + (p.lexicon?.matches ?? 0), 0);
  const scoreOutput = [
    'Source: patina playground (https://patina.vibetip.help/)',
    `Score: ${result.overall}/100 (${result.band.label})`,
    `Hot paragraphs: ${result.hotCount}/${result.paragraphCount}`,
    `Signals: ${signals}`,
    `Lexicon hits: ${lexiconHits}`,
  ].join('\n');

  const params = new globalThis.URLSearchParams({
    template: 'false_positive.yml',
    language: safeLang,
    fired_paragraph: fired,
    score_output: scoreOutput,
  });
  return `${FALSE_POSITIVE_ISSUE_URL}?${params.toString()}`;
}
