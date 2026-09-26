// Shared prose preparation and scoring. No files, credentials, LLMs or network.
import { analyzeText } from './features/analyzer.js';
import { summarizeSignalStrength } from './features/signal-strength.js';
import { LEAKAGE_SCORE_FLOOR } from './features/markup-leakage.js';

export function stripProse(markdown, {
  dropListItems = false,
  dropStandaloneLinks = false,
  keepInlineCode = false,
} = {}) {
  let text = String(markdown || '')
    .replace(/^---\n[\s\S]*?\n---\s*/, '\n')
    .replace(/```[\s\S]*?```/g, '\n')
    .replace(/~~~[\s\S]*?~~~/g, '\n')
    // Remove Markdown tables before stripping inline HTML. Cells such as
    // `p<0.01` are prose-visible math, not HTML tags; if HTML stripping runs
    // first it can consume across rows and leave table fragments behind.
    .replace(/^\s*\|.*\|\s*$/gm, '\n');

  if (keepInlineCode) text = text.replace(/`([^`]*)`/g, '$1');
  else text = text.replace(/`[^`]*`/g, ' ');

  if (dropStandaloneLinks) {
    text = text.replace(/^\s*\[[^\]]+\]\([^)]*\)\s*$/gm, '\n');
  }

  text = text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+.*$/gm, '\n')
    .replace(/^\s{0,3}>\s?/gm, '');

  if (dropListItems) {
    text = text
      .replace(/^\s*[-*+]\s+.*$/gm, '\n')
      .replace(/^\s*\d+[.)]\s+.*$/gm, '\n');
  } else {
    text = text
      .replace(/^\s*[-*+]\s+\[[ xX]\]\s+/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+[.)]\s+/gm, '');
  }

  return stripEmphasisMarkers(text)
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Strip emphasis as *paired* markers only (issue #396). A blanket [*_] delete
// mangles non-emphasis tokens (utm_source=chatgpt.com -> utmsource=chatgpt.com,
// grok_card -> grokcard) before analyzeText runs, which kills the
// markup-leakage detector's underscore-dependent signatures. Pairing rules:
// the opener must not touch a word character on the outside (so `2*3` and
// `user_id` survive), the inner text must not start/end with whitespace, and
// the closing run must match the opening run length. The inner text may span
// Markdown soft line breaks (hard-wrapped `**bold\nacross lines**` is valid
// CommonMark emphasis) but never a blank line — emphasis cannot cross a
// paragraph boundary.
const PAIRED_ASTERISK_RE = /(?<![\w*])(\*{1,3})(?!\s)((?:[^*\n]|\n(?![ \t]*\n))+?)(?<!\s)\1(?![\w*])/g;
const PAIRED_UNDERSCORE_RE = /(?<![\w_])(_{1,3})(?!\s)((?:[^\n]|\n(?![ \t]*\n))+?)(?<!\s)\1(?![\w_])/g;

function stripEmphasisMarkers(text) {
  let out = text;
  // Fixpoint loop unwraps nesting such as **bold with *inner* emphasis**.
  for (let i = 0; i < 3; i++) {
    const next = out
      .replace(PAIRED_ASTERISK_RE, '$2')
      .replace(PAIRED_UNDERSCORE_RE, '$2');
    if (next === out) break;
    out = next;
  }
  return out;
}

export function stripNonProse(markdown, options = {}) {
  return stripProse(markdown, options);
}

export function detectLanguage(file, text = '', requested = 'auto') {
  const normalized = String(requested || 'auto').toLowerCase();
  if (['ko', 'en', 'zh', 'ja'].includes(normalized)) return normalized;

  const path = String(file || '').toLowerCase();
  if (/(^|[._/-])kr([._/-]|$)|(^|[._/-])ko([._/-]|$)|korean/.test(path)) return 'ko';
  if (/(^|[._/-])ja([._/-]|$)|japanese/.test(path)) return 'ja';
  if (/(^|[._/-])zh([._/-]|$)|chinese/.test(path)) return 'zh';

  const sample = String(text || '').slice(0, 12000);
  const hangul = (sample.match(/[\uac00-\ud7af]/g) || []).length;
  const kana = (sample.match(/[\u3040-\u30ff]/g) || []).length;
  const cjk = (sample.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = (sample.match(/[A-Za-z]/g) || []).length;
  const cjkTotal = hangul + kana + cjk;
  if (latin >= 80 && latin > cjkTotal * 2) return 'en';
  if (hangul >= 8 && hangul >= kana && hangul >= cjk) return 'ko';
  if (kana >= 8) return 'ja';
  if (cjk >= 8) return 'zh';
  return 'en';
}


export function summarizeProseAnalysis(result) {
  // Gate semantics: `score`/`overGate` are the hot ratio over PROSE paragraphs.
  // Bare `---` divider lines survive stripProse (only leading frontmatter is
  // removed) and split into their own pseudo-paragraphs; with #391 attribution
  // each gated divider is hot, which would let markup — not prose — drive the
  // precommit/dogfood gates. Divider-only pseudo-paragraphs are therefore
  // excluded from the gate ratio and from the prose signal average.
  const proseParagraphs = result.paragraphs.filter((p) => !p.thematicBreakOnly);
  const paragraphCount = proseParagraphs.length;
  const hotCount = proseParagraphs.filter((p) => p.hot).length;
  const score = paragraphCount ? (hotCount / paragraphCount) * 100 : 0;
  const signalScore = summarizeSignalStrength(proseParagraphs);
  const leaked = Boolean(result.markupLeakage?.leaked);
  const discourseHot = result.discourseTells?.hot === true;
  // Ranking semantics (`flooredScore`):
  // detection scope stays wider than the gate. The attributed ratio over ALL
  // analyzer paragraphs (divider pseudo-paragraphs included) can only raise the
  // ranking, so `---`-spam documents still surface as editing hotspots, and the
  // canonical near-proof-grade LEAKAGE_SCORE_FLOOR from src/scoring.js applies
  // on top. Discourse tells carry no document-level floor (#391): they reach
  // both scores through per-paragraph hot attribution.
  const attributedScore = result.paragraphs.length
    ? (result.paragraphs.filter((p) => p.hot).length / result.paragraphs.length) * 100
    : 0;
  const rankedScore = Math.max(score, attributedScore);
  const flooredScore = leaked ? Math.max(rankedScore, LEAKAGE_SCORE_FLOOR) : rankedScore;
  return { paragraphCount, hotCount, score, signalScore, leaked, discourseHot, flooredScore };
}

export function scoreProse(text, { file = '', lang = 'auto', gate = 30, lexicon, strip = {} } = {}) {
  const prose = stripNonProse(text, strip);
  const resolvedLang = detectLanguage(file, prose, lang);
  const analysis = analyzeText(prose, { lang: resolvedLang, lexicon });
  const result = summarizeProseAnalysis(analysis);
  return { lang: resolvedLang, ...result, gate, overGate: result.score > gate,
    skipped: result.paragraphCount === 0, analysisSkipped: analysis.skipped,
    skipReason: analysis.skipReason, proseLength: prose.length,
    markupLeakage: { leaked: result.leaked, hits: analysis.markupLeakage?.hits?.length || 0 },
    discourseTells: { hot: result.discourseHot, fakeCandor: analysis.discourseTells?.fakeCandor?.hot === true, thematicBreaks: analysis.discourseTells?.thematicBreaks?.hot === true },
  };
}
