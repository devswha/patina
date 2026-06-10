// Browser-safe deterministic analyzer for the patina static playground.
// Imports browser-pure src/features modules directly; keeps only playground UI/report glue here.

import { PLAYGROUND_LEXICONS } from './data/lexicons.js';
import { splitParagraphs as splitParagraphsCore, splitSentences, splitProseSentences, tokenize } from '../src/features/segment.js';
import {
  DEFAULT_BURSTINESS_BANDS,
  DEFAULT_MIN_BURSTINESS_SENTENCES,
  DEFAULT_MATTR_BANDS,
  DEFAULT_MATTR_WINDOW,
  DEFAULT_KO_DIAGNOSTIC_BANDS,
  KO_POST_EDITESE_SCHEMA,
  burstinessCV,
  mattr,
  classifyBurstiness,
  classifyMattr,
  classifyKoreanDiagnostics,
  commaDensity,
  koreanPosDiversityProxy,
  koreanSpacingFeatures,
  koreanPostEditeseFeatures,
} from '../src/features/stylometry.js';
import {
  DEFAULT_LEXICON_DENSITY_THRESHOLD,
  DEFAULT_LEXICON_MIN_HOT_MATCHES,
  computeDensity,
  classifyLexiconHot,
} from '../src/features/lexicon-core.js';
import { detectMarkupLeakage } from '../src/features/markup-leakage.js';
import {
  detectFakeCandor,
  detectThematicBreaks,
  FAKE_CANDOR_MIN as DEFAULT_FAKE_CANDOR_MIN,
  THEMATIC_BREAK_MIN as DEFAULT_THEMATIC_BREAK_MIN,
} from '../src/features/discourse-tells.js';
import {
  detectTranslationese,
  TRANSLATIONESE_RULES,
  ABS_MIN as TRANSLATIONESE_ABS_MIN,
  DENSITY_MIN as TRANSLATIONESE_DENSITY_MIN,
  STRONG_MIN as TRANSLATIONESE_STRONG_MIN,
} from '../src/features/translationese.js';

export {
  splitSentences,
  splitProseSentences,
  tokenize,
  DEFAULT_BURSTINESS_BANDS,
  DEFAULT_MIN_BURSTINESS_SENTENCES,
  DEFAULT_MATTR_BANDS,
  DEFAULT_MATTR_WINDOW,
  DEFAULT_KO_DIAGNOSTIC_BANDS,
  burstinessCV,
  mattr,
  classifyBurstiness,
  classifyMattr,
  classifyKoreanDiagnostics,
  commaDensity,
  koreanPosDiversityProxy,
  koreanSpacingFeatures,
  KO_POST_EDITESE_SCHEMA,
  koreanPostEditeseFeatures,
  DEFAULT_LEXICON_DENSITY_THRESHOLD,
  DEFAULT_LEXICON_MIN_HOT_MATCHES,
  computeDensity,
  classifyLexiconHot,
  detectMarkupLeakage,
  detectFakeCandor,
  detectThematicBreaks,
  DEFAULT_FAKE_CANDOR_MIN,
  DEFAULT_THEMATIC_BREAK_MIN,
  detectTranslationese,
  TRANSLATIONESE_RULES,
  TRANSLATIONESE_ABS_MIN,
  TRANSLATIONESE_DENSITY_MIN,
  TRANSLATIONESE_STRONG_MIN,
};

export const SUPPORTED_LANGS = ['ko', 'en', 'zh', 'ja'];
export const DEFAULT_LANG = 'ko';
// Formatting tells mirror catalog patterns #13/#14/#17.
// Em dash is doc-level (3+ across the document). Bold fires at 5+ across the
// document or 3+ within one paragraph. Emoji currently mirrors the catalog's
// "any occurrence" contract for editorial/professional text.
export const DEFAULT_FORMATTING_THRESHOLDS = {
  emDashDoc: 3, // U+2014 occurrences across the document
  boldDoc: 5, // **bold** spans across the document
  boldParagraph: 3, // **bold** spans inside one paragraph
  emojiDoc: 1, // any emoji occurrence in the document
};
// Model-output leakage (#332) is near-proof-grade, so any hit short-circuits the
// document score into the 'heavily AI' band, mirroring src/scoring.js.
export const LEAKAGE_SCORE_FLOOR = 90;

export const SAMPLE_TEXT = {
  ko: '이 솔루션은 혁신적인 접근을 통해 업무 생산성을 극대화하고, 다양한 이해관계자에게 지속 가능한 가치를 제공합니다. 더 나아가 조직의 디지털 전환을 가속화하는 핵심 기반으로 자리매김하고 있습니다.\n\n하지만 현장에서 필요한 것은 거창한 선언보다 오늘 바로 줄어드는 반복 작업입니다.',
  en: 'This transformative solution empowers teams to unlock the full potential of a seamless workflow. In today\'s fast-paced landscape, it serves as a catalyst for meaningful collaboration and sustainable growth.\n\nThe real question is simpler: which repetitive step disappears first?',
  zh: '总而言之，这一方案能够全面提升用户体验，并为未来发展提供新的可能。从长远来看，它将在数字时代发挥着重要作用。\n\n先看一个具体场景：团队每天少复制三次表格。',
  ja: 'まとめると、この仕組みはユーザー体験を向上させ、より良い未来につながります。重要なのは、さまざまな場面で効果的に活用できる点です。\n\nまずは、毎朝の確認作業が一つ減るかどうかを見ます。',
};

export function normalizeLang(lang) {
  return SUPPORTED_LANGS.includes(lang) ? lang : DEFAULT_LANG;
}

export function splitParagraphs(text) {
  return splitParagraphsCore(text ? String(text).normalize('NFC') : '');
}

export function countFakeCandor(text) {
  return detectFakeCandor(text).count;
}

function fmt(value, digits = 2) {
  return value == null ? 'n/a' : Number(value).toFixed(digits);
}

function zeroKoPostEditeseMetrics() {
  return koreanPostEditeseFeatures('', { lang: 'ko' }).metrics;
}

const EMOJI_BASE_RE = '\\p{Extended_Pictographic}(?:\\uFE0F|\\uFE0E)?(?:\\p{Emoji_Modifier})?';
const EMOJI_CLUSTER_PATTERN = `(?:\\p{Regional_Indicator}{2}|[#*0-9]\\uFE0F?\\u20E3|${EMOJI_BASE_RE}(?:\\u200D${EMOJI_BASE_RE})*)`;
const EMOJI_CLUSTER_RE = new RegExp(EMOJI_CLUSTER_PATTERN, 'u');
const EMOJI_CLUSTER_RE_GLOBAL = new RegExp(EMOJI_CLUSTER_PATTERN, 'gu');

function getGraphemeSegmenter() {
  return typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;
}

function countEmojiClusters(text, segmenter = getGraphemeSegmenter()) {
  const str = String(text ?? '');
  if (!str) return 0;
  if (segmenter) {
    let count = 0;
    for (const { segment } of segmenter.segment(str)) {
      if (EMOJI_CLUSTER_RE.test(segment)) count++;
    }
    return count;
  }
  return (str.match(EMOJI_CLUSTER_RE_GLOBAL) || []).length;
}

// Count formatting tells in a chunk of raw text (em-dash U+2014, markdown **bold**
// spans, decorative emoji).
export function countFormatting(text, opts = {}) {
  const str = String(text ?? '');
  const emDash = (str.match(/—/gu) || []).length;
  const bold = (str.match(/\*\*(?=\S)(?:[^*]|\*(?!\*))+?\*\*/gu) || []).length;
  const emoji = countEmojiClusters(str, opts.segmenter);
  return { emDash, bold, emoji };
}

function buildReasons({ cvBand, mattrBand, lexiconHot, lex, koDiagnostics, formatting, formattingThresholds, leakage, candor, thematicBreaks }) {
  const reasons = [];
  if (candor?.hot) {
    reasons.push({
      code: 'fake-candor',
      label: 'Fake-candor opener',
      detail: `Manufactured-intimacy opener ("here's the thing", "the truth is", …); ${candor.docCount} in the document (threshold ${DEFAULT_FAKE_CANDOR_MIN}).`,
    });
  }
  if (thematicBreaks?.hot) {
    reasons.push({
      code: 'thematic-break',
      label: 'Decorative thematic break',
      detail: `${thematicBreaks.docCount} markdown dividers in the document (threshold ${DEFAULT_THEMATIC_BREAK_MIN}); this paragraph carries ${thematicBreaks.count}.`,
    });
  }
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
    const paragraphOnly = formatting.bold >= formattingThresholds.boldParagraph && formatting.docBold < formattingThresholds.boldDoc;
    reasons.push({
      code: 'bold-overuse',
      label: 'Boldface overuse',
      detail: paragraphOnly
        ? `${formatting.bold} bold spans in this paragraph (threshold ${formattingThresholds.boldParagraph}).`
        : `${formatting.docBold} bold spans in the document (threshold ${formattingThresholds.boldDoc}); this paragraph carries ${formatting.bold}.`,
    });
  }
  if (formatting?.emojiHot) {
    reasons.push({
      code: 'emoji-overuse',
      label: 'Emoji overuse',
      detail: `${formatting.docEmoji} emoji in the document (catalog threshold: any occurrence); this paragraph carries ${formatting.emoji}.`,
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
  const normalized = text ? String(text).normalize('NFC') : '';
  const paragraphs = splitParagraphs(normalized);
  const threshold = opts.lexiconDensityThreshold ?? DEFAULT_LEXICON_DENSITY_THRESHOLD;
  const minHotMatches = opts.lexiconMinHotMatches ?? DEFAULT_LEXICON_MIN_HOT_MATCHES;
  const formattingThresholds = opts.formattingThresholds ?? DEFAULT_FORMATTING_THRESHOLDS;

  // Document-level formatting pass: count tells across all paragraphs first, then
  // attribute hot status to the paragraphs that carry the token (catalog #13/#14 are doc-level).
  const paraFormatting = paragraphs.map(countFormatting);
  const docEmDash = paraFormatting.reduce((sum, f) => sum + f.emDash, 0);
  const docBold = paraFormatting.reduce((sum, f) => sum + f.bold, 0);
  const docEmoji = paraFormatting.reduce((sum, f) => sum + f.emoji, 0);
  // Fake-candor openers (#334): doc-level density gate, then attribute to the
  // paragraphs that carry an opener (same shape as the em-dash doc-level pass).
  const paraCandor = paragraphs.map(countFakeCandor);
  const docFakeCandor = detectFakeCandor(normalized);
  const docCandor = docFakeCandor.count;

  const paraThematicBreaks = paragraphs.map(detectThematicBreaks);
  const docThematicBreaks = detectThematicBreaks(normalized);
  const translationese = detectTranslationese(normalized, { lang });
  const koPostEditese = koreanPostEditeseFeatures(normalized, { lang });

  const analyzed = paragraphs.map((paragraph, idx) => {
    const sentences = splitProseSentences(paragraph);
    const sentenceTokens = sentences.map((sentence) => tokenize(sentence, { lang }));
    const sentenceTokenCounts = sentenceTokens.map((tokens) => tokens.length);
    const tokens = sentenceTokens.flat();
    const cv = burstinessCV(sentenceTokenCounts);
    const cvBand = sentences.length >= DEFAULT_MIN_BURSTINESS_SENTENCES ? classifyBurstiness(cv) : null;
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
    const boldHot =
      (docBold >= formattingThresholds.boldDoc && counts.bold >= 1) ||
      counts.bold >= formattingThresholds.boldParagraph;
    const emojiHot = docEmoji >= formattingThresholds.emojiDoc && counts.emoji >= 1;
    const formatting = { ...counts, docEmDash, docBold, docEmoji, emDashHot, boldHot, emojiHot };
    // Model-output leakage (#332): per-paragraph hit, fires on a single occurrence.
    const leakage = detectMarkupLeakage(paragraph);
    // Fake-candor (#334): this paragraph carries an opener AND the doc total >= gate.
    const candorHot = docCandor >= DEFAULT_FAKE_CANDOR_MIN && paraCandor[idx] >= 1;
    const thematicBreakHot = docThematicBreaks.hot && paraThematicBreaks[idx].count >= 1;
    const hot =
      cvBand === 'low' ||
      mattrBand === 'low' ||
      lexiconHot ||
      Boolean(koSignals.koDiagnostics?.hot) ||
      emDashHot ||
      boldHot ||
      emojiHot ||
      leakage.leaked ||
      candorHot ||
      thematicBreakHot;
    const thematicBreaks = {
      ...paraThematicBreaks[idx],
      docCount: docThematicBreaks.count,
      docAdjacentToHeading: docThematicBreaks.adjacentToHeading,
      hot: thematicBreakHot,
    };
    const reasons = buildReasons({
      cvBand,
      mattrBand,
      lexiconHot,
      lex,
      koDiagnostics: koSignals.koDiagnostics,
      formatting,
      formattingThresholds,
      leakage,
      candor: { hot: candorHot, docCount: docCandor },
      thematicBreaks,
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
      thematicBreaks,
      hot,
      reasons,
    };
  });

  const hotCount = analyzed.filter((p) => p.hot).length;
  const hotRatio = paragraphs.length === 0 ? 0 : Math.round((hotCount / paragraphs.length) * 100);
  const markupLeakage = detectMarkupLeakage(normalized);
  const overall = markupLeakage.leaked ? Math.max(hotRatio, LEAKAGE_SCORE_FLOOR) : hotRatio;

  return {
    lang,
    overall,
    band: scoreBand(overall),
    paragraphCount: paragraphs.length,
    hotCount,
    totalTokens: analyzed.reduce((sum, p) => sum + p.tokenCount, 0),
    markupLeakage,
    discourseTells: {
      fakeCandor: docFakeCandor,
      thematicBreaks: docThematicBreaks,
      hot: docCandor >= DEFAULT_FAKE_CANDOR_MIN || docThematicBreaks.hot,
    },
    translationese,
    koPostEditese,
    paragraphs: analyzed,
    auditItems: analyzed.filter((p) => p.hot || p.lexicon.matches > 0),
    note: 'Audit-only deterministic score. It marks editing hotspots, not authorship or intent.',
  };
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
function formatAdvisoryMetric(value, digits = 3) {
  if (value == null) return 'n/a';
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Number.isInteger(value) ? String(value) : value.toFixed(digits);
  }
  return String(value);
}

function renderAdvisoryMetricRows(rows) {
  return rows.map(([group, label, value]) => `<tr>
      <th scope="row">${escapeHtml(group)}</th>
      <td>${escapeHtml(label)}</td>
      <td>${escapeHtml(formatAdvisoryMetric(value))}</td>
    </tr>`).join('');
}

function renderTranslationeseAdvisory(translationese = {}) {
  const rules = Array.isArray(translationese.byRule) ? translationese.byRule : [];
  const samples = Array.isArray(translationese.hits) ? translationese.hits : [];
  const ruleItems = rules.length > 0
    ? `<ul class="advisory-list">${rules.map((rule) => {
      const example = rule.example
        ? `<span class="advisory-example">Example: <code>${escapeHtml(rule.example.before ?? '')}</code> → <code>${escapeHtml(rule.example.after ?? '')}</code></span>`
        : '';
      return `<li>
          <strong>${escapeHtml(rule.label ?? rule.id ?? 'Translationese rule')}</strong>
          <span class="muted">count ${escapeHtml(formatAdvisoryMetric(rule.count, 0))}${rule.strong ? ' · strong' : ''}</span>
          ${example}
        </li>`;
    }).join('')}</ul>`
    : '<p class="quiet">No Korean translationese rules surfaced. Treat this as an editing hint, not a score input.</p>';
  const sampleHtml = samples.length > 0
    ? `<p class="hits">Samples: ${samples.map((sample) => `<code>${escapeHtml(sample)}</code>`).join(' ')}</p>`
    : '';
  return `<section class="advisory-card" aria-labelledby="translationese-advisory-title">
    <h3 id="translationese-advisory-title">Translationese hints</h3>
    <p class="quiet">Advisory-only Korean calque metadata for revision. It does not affect score, hot paragraphs, or audit rows.</p>
    <dl class="advisory-stats">
      <div><dt>Count</dt><dd>${escapeHtml(formatAdvisoryMetric(translationese.count, 0))}</dd></div>
      <div><dt>Density</dt><dd>${escapeHtml(formatAdvisoryMetric(translationese.density))}</dd></div>
      <div><dt>Sentences</dt><dd>${escapeHtml(formatAdvisoryMetric(translationese.sentences, 0))}</dd></div>
    </dl>
    ${ruleItems}
    ${sampleHtml}
  </section>`;
}

function renderKoPostEditeseAdvisory(koPostEditese = {}) {
  if (!koPostEditese.analyzed) {
    const reason = koPostEditese.skipReason ?? 'unavailable';
    return `<section class="advisory-card" aria-labelledby="ko-post-editese-advisory-title">
      <h3 id="ko-post-editese-advisory-title">Korean post-editese metadata</h3>
      <p class="quiet">Schema <code>${escapeHtml(koPostEditese.schema ?? KO_POST_EDITESE_SCHEMA)}</code> skipped: ${escapeHtml(reason)}. Advisory metadata is unavailable for this input.</p>
    </section>`;
  }

  const metrics = koPostEditese.metrics ?? zeroKoPostEditeseMetrics();
  const rows = [
    ['endings', 'declarative -다 count', metrics.endings?.declarativeDaCount],
    ['endings', 'declarative -다 ratio', metrics.endings?.declarativeDaRatio],
    ['endings', 'formal ending count', metrics.endings?.formalEndingCount],
    ['endings', 'polite ending count', metrics.endings?.politeEndingCount],
    ['endings', 'ending streak max', metrics.endings?.endingStreakMax],
    ['interference', 'pronoun literal count', metrics.interference?.pronounLiteralCount],
    ['interference', 'double particle count', metrics.interference?.doubleParticleCount],
    ['interference', 'progressive aspect count', metrics.interference?.progressiveAspectCount],
    ['interference', 'light verb count', metrics.interference?.lightVerbCount],
    ['interference', 'by-passive count', metrics.interference?.byPassiveCount],
    ['interference', 'double passive count', metrics.interference?.doublePassiveCount],
    ['interference', 'connective comma count', metrics.interference?.connectiveCommaCount],
    ['rhythm', 'mean sentence eojeols', metrics.rhythm?.meanSentenceEojeols],
    ['rhythm', 'sentence eojeol CV', metrics.rhythm?.sentenceEojeolCV],
    ['rhythm', 'comma per sentence', metrics.rhythm?.commaPerSentence],
    ['suffix diversity', 'suffix matched count', metrics.rhythm?.suffixMatchedCount],
    ['suffix diversity', 'suffix class diversity', metrics.rhythm?.suffixClassDiversity],
    ['suffix diversity', 'suffix diversity', metrics.rhythm?.suffixDiversity],
  ];
  return `<section class="advisory-card" aria-labelledby="ko-post-editese-advisory-title">
    <h3 id="ko-post-editese-advisory-title">Korean post-editese metadata</h3>
    <p class="quiet">Schema <code>${escapeHtml(koPostEditese.schema ?? KO_POST_EDITESE_SCHEMA)}</code> analyzed as editing guidance only.</p>
    <dl class="advisory-stats">
      <div><dt>Paragraphs</dt><dd>${escapeHtml(formatAdvisoryMetric(koPostEditese.paragraphCount, 0))}</dd></div>
      <div><dt>Sentences</dt><dd>${escapeHtml(formatAdvisoryMetric(koPostEditese.sentenceCount, 0))}</dd></div>
      <div><dt>Eojeols</dt><dd>${escapeHtml(formatAdvisoryMetric(koPostEditese.eojeolCount, 0))}</dd></div>
    </dl>
    <div class="table-wrap advisory-metrics"><table>
      <thead><tr><th>Group</th><th>Metric</th><th>Value</th></tr></thead>
      <tbody>${renderAdvisoryMetricRows(rows)}</tbody>
    </table></div>
  </section>`;
}

export function renderKoreanAdvisory(analysis) {
  if (!analysis || analysis.lang !== 'ko') {
    return `<p class="empty-state">Korean advisory metadata is unavailable for this language. This panel is separate from scoring, hotspots, and audit diff rendering.</p>`;
  }
  return `<div class="advisory-grid">
    ${renderTranslationeseAdvisory(analysis.translationese)}
    ${renderKoPostEditeseAdvisory(analysis.koPostEditese)}
  </div>`;
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
const FALSE_POSITIVE_MAX_URL_LENGTH = 8000;
const FALSE_POSITIVE_TRUNCATION_NOTICE = '\n…(truncated — paste the rest if it matters)';

// Build a GitHub issue URL with the false-positive template pre-filled from the
// current audit. Nothing is sent anywhere — the text only leaves the browser if
// the user chooses to submit the GitHub issue, preserving the in-browser privacy
// promise while removing the copy/paste friction of reporting by hand.
function buildFalsePositiveIssueUrl(params) {
  const query = new globalThis.URLSearchParams({
    template: 'false_positive.yml',
    ...params,
  });
  return `${FALSE_POSITIVE_ISSUE_URL}?${query.toString()}`;
}

function fitFalsePositiveParagraphToUrlBudget(fired, params) {
  const fullUrl = buildFalsePositiveIssueUrl({ ...params, fired_paragraph: fired });
  if (fullUrl.length < FALSE_POSITIVE_MAX_URL_LENGTH) return fired;

  const chars = Array.from(fired);
  let low = 0;
  let high = chars.length;
  let best = '';

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = `${chars.slice(0, mid).join('').trimEnd()}${FALSE_POSITIVE_TRUNCATION_NOTICE}`;
    const url = buildFalsePositiveIssueUrl({ ...params, fired_paragraph: candidate });
    if (url.length < FALSE_POSITIVE_MAX_URL_LENGTH) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  if (best) return best;
  const noticeUrl = buildFalsePositiveIssueUrl({
    ...params,
    fired_paragraph: FALSE_POSITIVE_TRUNCATION_NOTICE.trimStart(),
  });
  return noticeUrl.length < FALSE_POSITIVE_MAX_URL_LENGTH
    ? FALSE_POSITIVE_TRUNCATION_NOTICE.trimStart()
    : '';
}

export function buildFalsePositiveReportUrl(text, lang = DEFAULT_LANG, analysis = null) {
  const safeLang = normalizeLang(lang);
  const result = analysis ?? analyzePlaygroundText(text || '', { lang: safeLang });
  const hotParas = result.paragraphs.filter((p) => p.hot);
  const source = hotParas.length ? hotParas : result.paragraphs;

  let fired = source.map((p) => p.text).join('\n\n').trim();
  if (!fired) fired = (text || '').trim();

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

  const params = {
    language: safeLang,
    score_output: scoreOutput,
  };
  const budgetedFired = fitFalsePositiveParagraphToUrlBudget(fired, params);
  return buildFalsePositiveIssueUrl({ ...params, fired_paragraph: budgetedFired });
}
