// Deterministic adversarial transforms for detection-robustness measurement (B3).
//
// Each transform is a pure, deterministic, Node-version-stable text -> text
// function (no randomness, no Date, fixed substitution maps). They are applied
// to baseline benchmark fixtures to measure how well the deterministic analyzer
// holds its decision under common evasion tactics. They NEVER change a detector
// threshold — robustness is reported separately from the baseline benchmark.
//
// Unicode normalization expectations (the analyzer NFC-normalizes input):
//   * Zero-width insertion uses U+200B/U+200C, which NFC does NOT strip, so the
//     characters persist into tokenization (can split tokens / dilute matches).
//   * Homoglyph substitution maps ASCII letters to confusable Cyrillic/Greek
//     code points, which NFC does NOT fold, so word/lexicon matches can break.
//   * Case folding, punctuation stripping, and sentence repetition are plain
//     transforms; the analyzer lowercases internally, so case folding is the
//     mildest tactic.

const ZERO_WIDTH = '\u200B'; // ZERO WIDTH SPACE — survives NFC.

// ASCII -> confusable (homoglyph) map. Lowercase only; deterministic.
const HOMOGLYPHS = {
  a: '\u0430', // CYRILLIC SMALL A
  c: '\u0441', // CYRILLIC SMALL ES
  e: '\u0435', // CYRILLIC SMALL IE
  i: '\u0456', // CYRILLIC SMALL BYELORUSSIAN-UKRAINIAN I
  o: '\u043E', // CYRILLIC SMALL O
  p: '\u0440', // CYRILLIC SMALL ER
  s: '\u0455', // CYRILLIC SMALL DZE
  x: '\u0445', // CYRILLIC SMALL HA
  y: '\u0443', // CYRILLIC SMALL U
};

// Insert a zero-width space after every 4th non-space character. Deterministic
// (fixed stride), so the same input always yields the same output.
export function zeroWidthInsert(text, stride = 4) {
  const chars = [...String(text ?? '')];
  let nonSpace = 0;
  let out = '';
  for (const ch of chars) {
    out += ch;
    if (!/\s/u.test(ch)) {
      nonSpace += 1;
      if (nonSpace % stride === 0) out += ZERO_WIDTH;
    }
  }
  return out;
}

// Replace every lowercase ASCII letter that has a confusable with its homoglyph.
export function homoglyphSubstitute(text) {
  return [...String(text ?? '')].map((ch) => HOMOGLYPHS[ch] ?? ch).join('');
}

// Uppercase the whole text (the analyzer lowercases internally, so this probes
// whether anything is case-sensitive upstream of normalization).
export function caseFold(text) {
  return String(text ?? '').toUpperCase();
}

// Strip ASCII + common CJK sentence punctuation, collapsing it to spaces.
export function stripPunctuation(text) {
  return String(text ?? '').replace(/[.,!?;:·…"'()[\]{}—\-~。，！？；：、「」『』（）]/gu, ' ');
}

// Duplicate every sentence once (split on terminators, keep delimiters). Probes
// whether repetition (a common AI tell) is detected after amplification.
export function repeatSentences(text) {
  const str = String(text ?? '');
  const parts = str.split(/([.!?。！？]+\s*)/u);
  let out = '';
  for (let i = 0; i < parts.length; i += 2) {
    const sentence = parts[i] ?? '';
    const delimiter = parts[i + 1] ?? '';
    if (sentence.trim()) {
      out += `${sentence}${delimiter}${sentence}${delimiter}`;
    } else {
      out += sentence + delimiter;
    }
  }
  return out;
}

// Stable transform registry, in report order.
export const ADVERSARIAL_TRANSFORMS = Object.freeze([
  { id: 'zero_width', label: 'zero-width insertion', apply: (t) => zeroWidthInsert(t) },
  { id: 'homoglyph', label: 'homoglyph substitution', apply: homoglyphSubstitute },
  { id: 'case_fold', label: 'uppercase fold', apply: caseFold },
  { id: 'punctuation', label: 'punctuation stripping', apply: stripPunctuation },
  { id: 'repetition', label: 'sentence repetition', apply: repeatSentences },
]);

function round(n, digits = 3) {
  return Math.round(n * 10 ** digits) / 10 ** digits;
}

// Summarize per-transform detection robustness from decision rows. Each row:
// { transform, expected_hot, baseline_hot, transformed_hot }. Reports, per
// transform: detection retention on positives (AI fixtures still flagged hot
// after the transform), clean retention on negatives (natural fixtures still
// NOT flagged), and how many decisions changed vs the untransformed baseline.
// Pure + deterministic (transforms in first-seen order). Robustness is
// REPORT-ONLY and never gates the suite.
export function summarizeRobustness(rows) {
  const byTransform = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!byTransform.has(r.transform)) byTransform.set(r.transform, []);
    byTransform.get(r.transform).push(r);
  }
  const out = {};
  for (const [transform, group] of byTransform) {
    const positives = group.filter((r) => r.expected_hot);
    const negatives = group.filter((r) => !r.expected_hot);
    const detectionRetained = positives.filter((r) => r.transformed_hot).length;
    const cleanRetained = negatives.filter((r) => !r.transformed_hot).length;
    const decisionChanged = group.filter(
      (r) => Boolean(r.transformed_hot) !== Boolean(r.baseline_hot)
    ).length;
    out[transform] = {
      n: group.length,
      positives: positives.length,
      detectionRetained,
      detectionRetainedRate: positives.length ? round(detectionRetained / positives.length) : null,
      negatives: negatives.length,
      cleanRetained,
      cleanRetainedRate: negatives.length ? round(cleanRetained / negatives.length) : null,
      decisionChanged,
    };
  }
  return out;
}
