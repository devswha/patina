// patina-lane: A asset for Lane B — deterministic meaning-floor proxy; LLM-free
// by construction. See docs/ARCHITECTURE.md.
//
// This is NOT a semantic-similarity score (we cannot compute real MPS without a
// model and must not pretend to). It is a conjunction of high-precision
// invariants that ANY meaning-preserving rewrite must satisfy, each built only
// from tokenize/normalization/counting primitives in `./index.js`. No imports
// from backends/api/scoring — enforced by tests/unit/meaning-proxy.test.js.
//
// Phase A (v6.2): signals 2–4 (rare-token recall, negation delta, length ratio)
// ship ADVISORY — surfaced in the JSON report only, never a CLI warning and
// never an enforced exit. Only signal 1 (dropped numbers) is separately
// enforced by the existing persona safety gate. Promotion of fail-severity to
// enforcing happens later via the formal 2-round calibration (see ARCHITECTURE).
import { tokenize } from './index.js';

const NUMBER_RE = /\d[\d.,]*/g;
// Valid thousands grouping only (1,200 / 1,234,567 / 1,234.56). Non-standard
// grouping like 1,2 or 3,14 is intentionally NOT stripped so it never collapses
// onto 12 / 314 and masks a genuinely dropped number.
const GROUPED_THOUSANDS_RE = /^\d{1,3}(,\d{3})+(\.\d+)?$/;

// Own, Lane-A-pure numeric extraction (mirrors verify.js#numbersIn so this module
// imports nothing from Lane B). Normalizes grouping commas (1,200 === 1200).
function numbersIn(text) {
  const out = new Set();
  for (const m of String(text ?? '').matchAll(NUMBER_RE)) {
    const raw = m[0].replace(/\.+$/, '');
    const normalized = GROUPED_THOUSANDS_RE.test(raw) ? raw.replace(/,/g, '') : raw;
    if (normalized) out.add(normalized);
  }
  return out;
}

/**
 * Source numbers that vanish from the rewrite. Deterministic, LLM-free.
 *
 * @param {string} original
 * @param {string} rewrite
 * @returns {string[]}
 */
export function droppedNumbers(original, rewrite) {
  const oNums = numbersIn(original);
  const rNums = numbersIn(rewrite);
  return [...oNums].filter((n) => !rNums.has(n));
}

const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

// Content tokens for rare-token recall: NFC + lowercased, keeping latin tokens of
// length >= 2 and any CJK token. freq<=2 filtering already excludes high-frequency
// function words, so no separate stopword list is needed.
function contentTokens(text, lang) {
  return tokenize(String(text ?? ''), { lang })
    .map((t) => t.normalize('NFC').toLowerCase())
    .filter((t) => t.length >= 2 || CJK_RE.test(t));
}

/**
 * Fraction of the original's low-frequency (freq<=2) content tokens that survive
 * in the rewrite, matched by exact token OR normalized substring containment.
 * Rare content tokens approximate the load-bearing nouns/entities/terms of a
 * claim; a humanizer rephrases connectives, not terminology. INACTIVE below 3
 * rare tokens (N=1/2 volatility would false-alarm).
 *
 * @returns {{active: boolean, recall: number|null, rareCount: number, survived: number|null}}
 */
export function rareTokenRecall(original, rewrite, lang = 'ko') {
  const freq = new Map();
  for (const t of contentTokens(original, lang)) freq.set(t, (freq.get(t) ?? 0) + 1);
  const rare = [...freq.entries()].filter(([, c]) => c <= 2).map(([t]) => t);
  if (rare.length < 3) return { active: false, recall: null, rareCount: rare.length, survived: null };
  const rSet = new Set(contentTokens(rewrite, lang));
  const rJoined = String(rewrite ?? '').normalize('NFC').toLowerCase();
  let survived = 0;
  for (const t of rare) {
    // Substring fallback only for CJK or long (>=5) Latin tokens. Short Latin
    // rare tokens (us / art / ai / go) would false-survive inside business /
    // chair / ongoing, masking a dropped entity/term.
    const allowSubstring = CJK_RE.test(t) || t.length >= 5;
    if (rSet.has(t) || (allowSubstring && rJoined.includes(t))) survived += 1;
  }
  return { active: true, recall: survived / rare.length, rareCount: rare.length, survived };
}

const EN_NEGATIONS = new Set([
  'no', 'not', 'never', 'none', 'neither', 'nor', 'cannot', 'without', 'nobody', 'nothing', 'nowhere',
]);
// ja/zh negation markers are morphemes with no whitespace boundary, so they are
// matched as documented COARSE substrings (advisory-only; can over-count inside
// compounds like 不错 / 案内). en/ko are matched on word/token boundaries per the
// review (avoids substring false hits like "cannot"/"notable"/안전/안내).
const JA_NEG_RE = /ない|ません|ではない|なかった|ぬ(?=[。、！？\s]|$)|ず(?=[。、！？\s]|$)/g;
const ZH_NEG_SET = new Set(['不', '没', '無', '无', '非', '未', '別', '别']);
const KO_NEG_WORD = /(^(안|못)$)|않|없|아니/u;

/**
 * Count negation markers on token/word boundaries per language. A large delta
 * between original and rewrite flags a possible silent polarity inversion.
 *
 * @returns {number}
 */
export function countNegations(text, lang = 'ko') {
  const t = String(text ?? '');
  if (lang === 'ja') return (t.match(JA_NEG_RE) ?? []).length;
  if (lang === 'zh') return tokenize(t, { lang: 'zh' }).filter((tok) => ZH_NEG_SET.has(tok)).length;
  if (lang === 'ko') {
    return tokenize(t, { lang: 'ko' }).filter((w) => KO_NEG_WORD.test(w)).length;
  }
  // en/default: whole-word match + n't contractions.
  const words = t.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) ?? [];
  return words.filter((w) => EN_NEGATIONS.has(w) || w.endsWith("n't")).length;
}

/**
 * Deterministic, LLM-free meaning-floor proxy. Returns a severity plus per-signal
 * measurements and human-readable reasons. Never throws.
 *
 * @param {object} input
 * @param {string} input.original
 * @param {string} input.rewrite
 * @param {string} [input.lang]
 * @returns {{ok: boolean, severity: 'pass'|'warn'|'fail', signals: object, reasons: string[]}}
 */
export function evaluateMeaningProxy({ original, rewrite, lang = 'ko' } = {}) {
  const reasons = [];
  const order = { pass: 0, warn: 1, fail: 2 };
  let severity = 'pass';
  const bump = (s) => { if (order[s] > order[severity]) severity = s; };

  // Signal 1 — numeric preservation (informational here; the persona safety gate
  // enforces dropped numbers separately).
  const dropped = droppedNumbers(original, rewrite);
  if (dropped.length > 0) {
    reasons.push(`dropped ${dropped.length} source number(s): ${dropped.slice(0, 6).join(', ')}${dropped.length > 6 ? '…' : ''}`);
    bump('warn');
  }

  // Signal 2 — rare-content-token recall (active only with >=3 rare tokens).
  const rare = rareTokenRecall(original, rewrite, lang);
  if (rare.active) {
    if (rare.recall < 0.3) {
      reasons.push(`rare-content-token recall ${(rare.recall * 100).toFixed(0)}% (${rare.survived}/${rare.rareCount}) — likely dropped terms/entities`);
      bump('fail');
    } else if (rare.recall < 0.5) {
      reasons.push(`low rare-content-token recall ${(rare.recall * 100).toFixed(0)}% (${rare.survived}/${rare.rareCount})`);
      bump('warn');
    }
  }

  // Signal 3 — negation-polarity delta (coarse; advisory).
  const negOriginal = countNegations(original, lang);
  const negRewrite = countNegations(rewrite, lang);
  const negationDelta = Math.abs(negOriginal - negRewrite);
  if (negationDelta >= 2) {
    reasons.push(`negation-marker count changed ${negOriginal}→${negRewrite} — possible polarity inversion`);
    bump('fail');
  } else if (negationDelta === 1) {
    reasons.push(`negation-marker count changed ${negOriginal}→${negRewrite}`);
    bump('warn');
  }

  // Signal 4 — length-ratio EXTREME bounds (truncation / hallucinated expansion).
  const oTokens = tokenize(String(original ?? ''), { lang }).length;
  const rTokens = tokenize(String(rewrite ?? ''), { lang }).length;
  // Empty original + non-empty rewrite is closer to hallucinated expansion than a
  // meaning-preserving rewrite, so it must fail the extreme-bounds check rather
  // than record a benign ratio of 1.
  const lengthRatio = oTokens === 0 ? (rTokens === 0 ? 1 : Infinity) : rTokens / oTokens;
  if (lengthRatio < 0.4 || lengthRatio > 2.5) {
    reasons.push(`length ratio ${lengthRatio.toFixed(2)} outside [0.4, 2.5] — truncation or expansion`);
    bump('fail');
  }

  return {
    ok: severity !== 'fail',
    severity,
    signals: {
      droppedNumbers: dropped,
      rareTokenRecall: rare.active ? Number(rare.recall.toFixed(3)) : null,
      rareTokenActive: rare.active,
      rareTokenCount: rare.rareCount,
      negationDelta,
      negationOriginal: negOriginal,
      negationRewrite: negRewrite,
      lengthRatio: Number(lengthRatio.toFixed(3)),
    },
    reasons,
  };
}
