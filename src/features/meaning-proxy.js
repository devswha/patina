// patina-lane: A asset for Lane B — deterministic meaning-floor proxy; LLM-free
// by construction. See docs/ARCHITECTURE.md.
//
// This is NOT a semantic-similarity score (we cannot compute real MPS without a
// model and must not pretend to). It is a conjunction of high-precision
// invariants that ANY meaning-preserving rewrite must satisfy, each built only
// from tokenize/normalization/counting primitives in `./index.js`. No imports
// from backends/api/scoring — enforced by tests/unit/meaning-proxy.test.js.
//
// Phase A (v6.2): rare-token, negation, and length signals ship ADVISORY —
// surfaced in the JSON report only, never a CLI warning and never an enforced
// exit. Numeric safety is a separate fail-closed result so web callers can
// reject a rewrite with `number_safety_failed`.
import { tokenize } from './index.js';

const NUMBER_RE = /\d[\d.,]*/g;
// Valid thousands grouping only (1,200 / 1,234,567 / 1,234.56). Non-standard
// grouping like 1,2 or 3,14 is intentionally NOT stripped so it never collapses
// onto 12 / 314 and masks a genuinely dropped number.
const GROUPED_THOUSANDS_RE = /^\d{1,3}(,\d{3})+(\.\d+)?$/;
const NUMERIC_SAFETY_VERSION = 'numeric-safety-v1';
const NUMBER_TOKEN_RE = /[-+−]?\d[\d,.]*/g;
const ISO_DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const EN_DATE_RE = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(\d{4})\b|\b(\d{1,2})\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/gi;
const LOCALIZED_DATE_RE = /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일|(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/g;
const AMBIGUOUS_DATE_RE = /\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}\/\d{1,2}\/\d{1,2})\b/;
const SLASH_NUMERIC_RE = /[-+]?\d[\d,.]*\s*\/\s*[-+]?\d[\d,.]*/;
const SYMBOL_CURRENCY_RE = /[$€£¥₩]\s*\d|\d\s*[$€£¥₩]/;
const COMPOUND_UNIT_RE = /\d[\d,.]*\s*(?:km|cm|mm|m|kg|g|lb|L|mL)\s*\/\s*[A-Za-z]+/i;
const DEGREE_TEMPERATURE_RE = /[-+−]?\d[\d,.]*\s*°\s*[CF]\b/gi;
const EN_MONTH_DATE_RE = /\b(?:(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2},\s*\d{4}|\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{4})\b/gi;
const UNIT_FACTORS_V1 = Object.freeze({
  mm: ['length-mm', 1],
  cm: ['length-mm', 10],
  m: ['length-mm', 1000],
  km: ['length-mm', 1000000],
  g: ['mass-g', 1],
  kg: ['mass-g', 1000],
  lb: ['mass-g', 45359237 / 100000],
  mL: ['volume-ml', 1],
  L: ['volume-ml', 1000],
});
const WORD_NUMBERS = Object.freeze({
  en: Object.freeze({ zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 }),
  ko: Object.freeze({ 영: 0, 하나: 1, 둘: 2, 셋: 3, 넷: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10 }),
  zh: Object.freeze({ 零: 0, 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }),
  ja: Object.freeze({ 零: 0, 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }),
});
const UNSUPPORTED_WORD_NUMBER_RE = Object.freeze({
  en: /\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|thirtieth|fortieth|fiftieth|sixtieth|seventieth|eightieth|ninetieth|hundredth|thousandth|millionth|billionth|trillionth|quadrillionth|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|trillion|quadrillion|half|halves|quarter|quarters|third|thirds|fourth|fourths|fifth|fifths|dozen|score)\b/i,
  ko: /(?:열(?:한|두)|스물|서른|마흔|쉰|예순|일흔|여든|아흔|(?:첫|둘|셋|넷|다섯|여섯|일곱|여덟|아홉)째|절반|분의|[공령일이삼사오육칠팔구십한두세네]+[백천만억조경해]|[백천만억조경해](?:[공령일이삼사오육칠팔구십한두세네]|[백천만억조경해]))/u,
  zh: /(?:两|兩|壹|贰|貳|叁|參|肆|伍|陆|陸|柒|捌|玖|拾|廿|卅|卌|半|第|分之|百|千|萬|万|億|亿|兆|京|垓)/,
  ja: /(?:壱|弐|参|肆|伍|陸|漆|捌|玖|拾|半|第|分の|百|千|万|億|兆|京|垓)/,
});
const KO_SINGLE_MAGNITUDE_CONTEXT_RE = /(?:\d\s*[백천만억조경해]|[백천만억조경해](?:\s+(?:개|건|권|그릇|대|마리|명|번|병|살|세|송이|장|채|층|통|편|회|년|월|일)|(?:개|건|권|그릇|대|달러|마리|명|번|병|살|세|송이|원|엔|위안|장|채|층|통|퍼센트|편|회)))/u;
const NUMERIC_OPERATOR_RE = /\p{Nd}\s*(?:[-+−–—:\x2F÷×*]\s*)+\p{Nd}/u;
const NUMERIC_COMPARATOR_RE = /(?:[-+−]?\p{Nd}[\p{Nd}.,]*\s*(?:<=|>=|<|>|≤|≥)|(?:<=|>=|<|>|≤|≥)\s*[-+−]?\p{Nd})/u;
const DECIMAL_DIGIT_RE = /\p{Nd}/u;
const LEADING_DOT_DECIMAL_RE = /(?<!\p{Nd})[-−]?\.\d/u;


function validDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function canonicalRational(numerator, denominator) {
  const gcd = (a, b) => (b === 0n ? a : gcd(b, a % b));
  const divisor = gcd(numerator < 0n ? -numerator : numerator, denominator);
  return `${numerator / divisor}/${denominator / divisor}`;
}

function rational(value) {
  const [whole, fraction = ''] = String(value).split('.');
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(`${whole}${fraction}`);
  return canonicalRational(numerator, denominator);
}

function scaledRational(value, factor) {
  const [numerator, denominator] = rational(value).split('/').map(BigInt);
  const factorText = String(factor);
  const [factorWhole, factorFraction = ''] = factorText.split('.');
  const factorDenominator = 10n ** BigInt(factorFraction.length);
  const factorNumerator = BigInt(`${factorWhole}${factorFraction}`);
  return canonicalRational(numerator * factorNumerator, denominator * factorDenominator);
}

function normalizedNumber(raw) {
  return raw.replace(/,/g, '').replace('−', '-');
}

function hasUnoccupiedMatch(source, occupied, re) {
  re.lastIndex = 0;
  return [...source.matchAll(re)].some((match) => !occupied.slice(match.index, match.index + match[0].length).every(Boolean));
}

function hasUnsupportedNumericSyntax(source, occupied) {
  const residual = source.split('').map((character, index) => (occupied[index] ? ' ' : character)).join('');
  if (NUMERIC_OPERATOR_RE.test(residual) || NUMERIC_COMPARATOR_RE.test(residual)) return true;
  return [...residual].some((character) => character > '\x7f' && DECIMAL_DIGIT_RE.test(character));
}

function hasUnsupportedWordNumberExpression(source, lang, occupied = []) {
  const uncoveredSource = source.split('').map((character, index) => (occupied[index] ? ' ' : character)).join('');
  if (lang === 'zh' || lang === 'ja') {
    const counters = lang === 'zh'
      ? /[个個项項件名次位本张張条條台岁歲天年个月月日]/u
      : /[つ個ヶか人冊枚本回台歳才年ヶ月月日]/u;
    const numerals = lang === 'zh'
      ? /[零〇一二三四五六七八九十两兩壹贰貳叁參肆伍陆陸柒捌玖]/u
      : /[零〇一二三四五六七八九十壱弐参肆伍陸漆捌玖]/u;
    const compoundNumerals = /[零〇一二三四五六七八九十]{2,}/u;
    const unsupported = lang === 'zh'
      ? /[两兩壹贰貳叁參肆伍陆陸柒捌玖拾廿卅卌半第分之百千萬万億亿兆京垓]/gu
      : /[壱弐参肆伍陸漆捌玖拾半第分の百千万億兆京垓]/gu;
    for (const match of uncoveredSource.matchAll(unsupported)) {
      const index = match.index;
      const previous = uncoveredSource[index - 1] ?? '';
      const next = uncoveredSource[index + match[0].length] ?? '';
      if (DECIMAL_DIGIT_RE.test(previous) || DECIMAL_DIGIT_RE.test(next)
        || numerals.test(previous) || numerals.test(next) || counters.test(previous) || counters.test(next)) return true;
    }
    return compoundNumerals.test(uncoveredSource);
  }
  if (UNSUPPORTED_WORD_NUMBER_RE[lang]?.test(uncoveredSource)) return true;
  if (lang === 'ko' && KO_SINGLE_MAGNITUDE_CONTEXT_RE.test(source)) return true;
  const words = WORD_NUMBERS[lang] ?? WORD_NUMBERS.en;
  const matches = [];
  const re = lang === 'en'
    ? new RegExp(`\\b(?:${Object.keys(words).join('|')})\\b`, 'gi')
    : new RegExp(Object.keys(words).join('|'), 'g');
  for (const match of uncoveredSource.matchAll(re)) matches.push(match);
  return matches.some((match, index) => {
    const previous = matches[index - 1];
    if (!previous) return false;
    const between = uncoveredSource.slice(previous.index + previous[0].length, match.index);
    return lang === 'en' ? /^[\s-]+$/.test(between) : between === '';
  });
}

function isClaimableWordNumber(source, index, word, lang) {
  if (lang === 'ko') {
    const previous = source[index - 1] ?? '';
    const suffix = source.slice(index + word.length);
    const hangul = /\p{Script=Hangul}/u;
    if (hangul.test(previous)) return false;
    if (!hangul.test(suffix[0] ?? '')) return true;
    return /^(?:은|는|이|가|을|를|의|도|만|와|과|에|에서|에게|한테|으로|로|부터|까지|보다|처럼|마저|조차|이라도|라도|(?:개|건|권|그릇|대|마리|명|번|병|살|세|송이|장|채|층|통|편|회|년|월|일|시간|분|초))/.test(suffix);
  }
  if (lang !== 'zh' && lang !== 'ja') return true;
  if (word.length > 1) return true;
  const previous = source[index - 1] ?? '';
  const next = source[index + word.length] ?? '';
  const han = /\p{Script=Han}/u;
  const counters = lang === 'zh'
    ? /[个個项項件名次位本张張条條台岁歲天年个月月日]/u
    : /[つ個ヶか人冊枚本回台歳才年ヶ月月日]/u;
  return counters.test(previous) || counters.test(next) || (!han.test(previous) && !han.test(next));
}

function isStandaloneNumericToken(source, index, length, lang) {
  if (lang !== 'en') return true;
  const previous = source[index - 1] ?? '';
  const next = source[index + length] ?? '';
  const identifier = /[A-Za-z_]/;
  return !identifier.test(previous) && !identifier.test(next);
}

function addClaims(text, lang) {
  const source = String(text ?? '');
  const claims = [];
  const claimIndices = [];
  const occupied = new Array(source.length).fill(false);
  const add = (index, length, claim) => {
    if ([...occupied.slice(index, index + length)].some(Boolean)) return false;
    occupied.fill(true, index, index + length);
    const insertionIndex = claimIndices.findIndex((claimIndex) => claimIndex > index);
    if (insertionIndex === -1) {
      claims.push(claim);
      claimIndices.push(index);
    } else {
      claims.splice(insertionIndex, 0, claim);
      claimIndices.splice(insertionIndex, 0, index);
    }
    return true;
  };
  const matchAll = (re, callback) => {
    re.lastIndex = 0;
    for (const match of source.matchAll(re)) callback(match);
  };

  if (AMBIGUOUS_DATE_RE.test(source) || SLASH_NUMERIC_RE.test(source) || SYMBOL_CURRENCY_RE.test(source) || COMPOUND_UNIT_RE.test(source)) {
  return { ok: false, reason: 'ambiguous_numeric_syntax', claims: [] };
}
  if (LEADING_DOT_DECIMAL_RE.test(source)) {
    return { ok: false, reason: 'unsupported_numeric_syntax', claims: [] };
  }

  matchAll(ISO_DATE_RE, (m) => {
    const [, year, month, day] = m;
    if (!validDate(Number(year), Number(month), Number(day))) return;
    add(m.index, m[0].length, `date:${year}-${month}-${day}`);
  });
  matchAll(LOCALIZED_DATE_RE, (m) => {
    const year = m[1] ?? m[4];
    const month = m[2] ?? m[5];
    const day = m[3] ?? m[6];
    if (!validDate(Number(year), Number(month), Number(day))) return;
    add(m.index, m[0].length, `date:${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
  });
  matchAll(EN_DATE_RE, (m) => {
    const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    const pieces = m[0].replace(',', '').split(/\s+/);
    const monthIndex = monthNames.indexOf((pieces[0].length > 2 ? pieces[0] : pieces[1]).toLowerCase());
    const day = Number(pieces[0].length > 2 ? pieces[1] : pieces[0]);
    const year = Number(pieces[2]);
    if (monthIndex >= 0 && validDate(year, monthIndex + 1, day)) {
      add(m.index, m[0].length, `date:${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    }
  });
  if (hasUnoccupiedMatch(source, occupied, EN_MONTH_DATE_RE) || hasUnoccupiedMatch(source, occupied, DEGREE_TEMPERATURE_RE)) {
    return { ok: false, reason: 'ambiguous_numeric_syntax', claims: [] };
  }


  const number = String.raw`[-+−]?(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)`;
  const currency = new RegExp(String.raw`\b((?:USD|EUR|GBP|JPY|KRW|CNY|CAD|AUD|CHF))\s+(${number})(?![\w]|,\d|\.\d)|(?<![\w.])(${number})\s+((?:USD|EUR|GBP|JPY|KRW|CNY|CAD|AUD|CHF))\b`, 'g');
  matchAll(currency, (m) => {
    const code = m[1] ?? m[4];
    const value = m[2] ?? m[3];
    add(m.index, m[0].length, `currency:${code}:${rational(normalizedNumber(value))}`);
  });

  const percent = new RegExp(String.raw`(?<![\w.])(${number})\s*(?:%|％|\bpercent\b|퍼센트|パーセント)`, 'gi');
  matchAll(percent, (m) => add(m.index, m[0].length, `percent:${rational(normalizedNumber(m[1]))}`));
  const chinesePercent = new RegExp(String.raw`百分之\s*(${number})`, 'g');
  matchAll(chinesePercent, (m) => add(m.index, m[0].length, `percent:${rational(normalizedNumber(m[1]))}`));

  const unit = new RegExp(String.raw`(?<![\w.])(${number})\s*(km|cm|mm|m|kg|g|lb|mL|L)\b`, 'g');
  matchAll(unit, (m) => {
    const [dimension, factor] = UNIT_FACTORS_V1[m[2]];
    add(m.index, m[0].length, `unit:${dimension}:${scaledRational(normalizedNumber(m[1]), factor)}`);
  });
  if (hasUnsupportedNumericSyntax(source, occupied)) {
    return { ok: false, reason: 'unsupported_numeric_syntax', claims: [] };
  }

  matchAll(NUMBER_TOKEN_RE, (m) => {
    if (occupied[m.index]) return;
    let raw = m[0];
    while (/[.,]$/.test(raw) && !/\d/.test(source[m.index + raw.length] ?? '')) raw = raw.slice(0, -1);
    if (!raw || raw === '-' || raw === '+') return;
    if (!isStandaloneNumericToken(source, m.index, raw.length, lang)) return;
    if (!/^[-+−]?(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)$/.test(raw)) {
      claims.push(`invalid:${m[0]}`);
      return;
    }
    add(m.index, raw.length, `number:${rational(normalizedNumber(raw))}`);
  });

  if (hasUnsupportedWordNumberExpression(source, lang, occupied)) {
    return { ok: false, reason: 'unsupported_word_number', claims: [] };
  }

  const words = WORD_NUMBERS[lang] ?? WORD_NUMBERS.en;
  for (const [word, value] of Object.entries(words)) {
    const re = lang === 'en' ? new RegExp(`\\b${word}\\b`, 'gi') : new RegExp(word, 'g');
    matchAll(re, (m) => {
      if (!occupied[m.index] && isClaimableWordNumber(source, m.index, word, lang)) add(m.index, m[0].length, `number:${value}/1`);
    });
  }
  if (claims.some((claim) => claim.startsWith('invalid:'))) {
    return { ok: false, reason: 'ambiguous_number_grouping', claims: [] };
  }
  const residue = source.split('').map((character, index) => (occupied[index] ? ' ' : character)).join('');
  if (/\d/.test(residue)) {
    return { ok: false, reason: 'unsupported_numeric_syntax', claims: [] };
  }
  return { ok: true, claims };
}

/**
 * Fail-closed numeric-claim equivalence. Only exact, documented syntax is
 * accepted; allowed unit equivalence is UNIT_FACTORS_V1.
 *
 * @returns {{ok: boolean, version: string, reason: string|null, originalClaims: string[], rewriteClaims: string[]}}
 */
export function evaluateNumberSafety(original, rewrite, lang = 'ko') {
  const source = addClaims(original, lang);
  const target = addClaims(rewrite, lang);
  if (!source.ok || !target.ok) {
    return {
      ok: false,
      version: NUMERIC_SAFETY_VERSION,
      reason: source.reason ?? target.reason,
      originalClaims: source.claims,
      rewriteClaims: target.claims,
    };
  }
  const sourceCounts = new Map();
  const targetCounts = new Map();
  for (const claim of source.claims) sourceCounts.set(claim, (sourceCounts.get(claim) ?? 0) + 1);
  for (const claim of target.claims) targetCounts.set(claim, (targetCounts.get(claim) ?? 0) + 1);
  const same = source.claims.length === target.claims.length
    && sourceCounts.size === targetCounts.size
    && [...sourceCounts].every(([claim, count]) => targetCounts.get(claim) === count);
  return {
    ok: same,
    version: NUMERIC_SAFETY_VERSION,
    reason: same ? null : 'numeric_claim_changed',
    originalClaims: source.claims,
    rewriteClaims: target.claims,
  };
}

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

  // Signal 1 — fail-closed numeric-claim equivalence. This explicit result is
  // consumed by stream callers to report `number_safety_failed`.
  const numberSafety = evaluateNumberSafety(original, rewrite, lang);
  const dropped = droppedNumbers(original, rewrite);
  if (!numberSafety.ok) {
    reasons.push(`number safety failed: ${numberSafety.reason}`);
    bump('fail');
  } else if (dropped.length > 0) {
    // Retained for compatibility with existing reports; equivalence above is the
    // authoritative safety signal.
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
      numberSafety,
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
