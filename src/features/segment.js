// Paragraph / sentence / token splitting per core/stylometry.md §2 §3.
//
// Tokenization is intentionally simple: whitespace split + edge-punctuation
// strip, no morphological analysis. For Chinese/Japanese prose, where normal
// text often has no whitespace, use a deterministic character-token fallback
// so sentence-length and lexical-diversity signals are not collapsed to
// "one token per sentence." Sentence splitting is regex-only and accepts known
// false splits on abbreviations / decimals (documented limit).

const SENTENCE_SPLIT_RE = /[.!?]+\s+|(?<=[。！？…])|\n+/u;
const PARAGRAPH_SPLIT_RE = /\n\s*\n/;
// \W in Unicode-aware mode. Strips edge punctuation but keeps internal
// hyphens / apostrophes (e.g. "don't", "좋은-도구") as a single token.
const EDGE_PUNCT_RE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const CJK_TOKEN_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u30FC]|[A-Za-z0-9]+/gu;

export function splitParagraphs(text) {
  if (!text) return [];
  return text
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
