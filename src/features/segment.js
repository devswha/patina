// Paragraph / sentence / token splitting per core/stylometry.md §2 §3.
//
// Tokenization is intentionally simple: whitespace split + edge-punctuation
// strip, no morphological analysis. Sentence splitting is regex-only and
// accepts known false splits on abbreviations / decimals (documented limit).

const SENTENCE_SPLIT_RE = /[.!?。…]+\s+|\n+/;
const PARAGRAPH_SPLIT_RE = /\n\s*\n/;
// \W in Unicode-aware mode. Strips edge punctuation but keeps internal
// hyphens / apostrophes (e.g. "don't", "좋은-도구") as a single token.
const EDGE_PUNCT_RE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;

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
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function tokenize(text) {
  if (!text) return [];
  return text
    .split(/\s+/)
    .map((chunk) => chunk.replace(EDGE_PUNCT_RE, ''))
    .filter((t) => t.length > 0);
}
