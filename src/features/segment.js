// Paragraph / sentence / token splitting per core/stylometry.md §2 §3.
//
// Tokenization is intentionally simple: whitespace split + edge-punctuation
// strip, no morphological analysis. For Chinese/Japanese prose, where normal
// text often has no whitespace, use a deterministic character-token fallback
// so sentence-length and lexical-diversity signals are not collapsed to
// "one token per sentence." Sentence splitting is regex-only and accepts known
// false splits on abbreviations / decimals (documented limit).
//
// A CJK sentence terminator (。！？) is treated as a boundary only when it is
// NOT immediately followed by a closing quote/bracket, so quote-internal
// terminators (彼は「やめろ。」と言った。) do not split mid-quote and a trailing
// closer (…と言った。」) is never stranded as its own zero-token "sentence".
// U+2026 (…) is intentionally NOT a hard terminator: in en/ko it is usually
// intra-sentence ("Well… maybe not."), so splitting on it would perturb token
// counts on exactly the human prose the tool must not flag. It is still
// stripped from sentence ends below.
const SENTENCE_CLOSERS = '」』】〕）》〉｝"\'”’';
const SENTENCE_SPLIT_RE = new RegExp(
  `[.!?]+\\s+|(?<=[。！？])(?![${SENTENCE_CLOSERS}])|\\n+`,
  'u'
);
const PARAGRAPH_SPLIT_RE = /\n\s*\n/;
const LIST_LINE_RE = /^\s*(?:[-*+]\s+|\d+[.)]\s+)/u;
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

function stripListBlocks(paragraph) {
  const lines = String(paragraph ?? '').split(/\r?\n/);
  const proseLines = [];
  let colonListRemaining = 0;
  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    if (trimmed === '') {
      colonListRemaining = 0;
      proseLines.push(rawLine);
      continue;
    }
    if (LIST_LINE_RE.test(rawLine)) continue;
    if (colonListRemaining > 0) {
      colonListRemaining--;
      continue;
    }
    if (trimmed.endsWith(':')) {
      colonListRemaining = countFollowingPlainListLines(lines, i + 1);
    }
    proseLines.push(rawLine);
  }
  return proseLines.join('\n');
}

function countFollowingPlainListLines(lines, start) {
  let count = 0;
  for (let i = start; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === '') break;
    if (LIST_LINE_RE.test(lines[i])) continue;
    count++;
  }
  return count >= 2 ? count : 0;
}

export function splitSentences(paragraph) {
  if (!paragraph) return [];
  return paragraph
    .split(SENTENCE_SPLIT_RE)
    .map((s) => s.trim().replace(/[.!?。！？…]+$/u, ''))
    .filter((s) => s.length > 0);
}

export function splitProseSentences(paragraph) {
  return splitSentences(stripListBlocks(paragraph));
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
