// Deterministic, LLM-free numeric-claim equivalence. This is not a semantic
// similarity score: it checks one invariant every meaning-preserving rewrite
// must satisfy, and fails closed on numeric syntax it cannot read, so web
// callers can reject a rewrite with `number_safety_failed`. It imports nothing,
// which keeps it out of reach of backend/scoring modules.
const NUMERIC_SAFETY_VERSION = 'numeric-safety-v2';
const NUMBER_TOKEN_RE = /[-+−]?\d[\d,.]*/g;
const ISO_DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const EN_DATE_RE = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s*(\d{4})\b|\b(\d{1,2})\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/gi;
const LOCALIZED_DATE_RE = /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일|(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日/g;
const AMBIGUOUS_DATE_RE = /\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}\/\d{1,2}\/\d{1,2})\b/;
const SLASH_NUMERIC_RE = /[-+]?\d[\d,.]*\s*\/\s*[-+]?\d[\d,.]*/;
const SYMBOL_CURRENCY_RE = /[$€£¥₩]\s*\d|\d\s*[$€£¥₩]/;
const COMPOUND_UNIT_RE = /\d[\d,.]*\s*(?:km|cm|mm|m|kg|g|lb|L|mL)\s*\/\s*[A-Za-z]+/i;
const DEGREE_TEMPERATURE_RE = /[-+−]?\d[\d,.]*\s*°\s*[CF]\b/gi;
// Clock times as they appear in chat logs, meeting notes, and timelines
// ("16:47", "9:05", "16:47:30", ranges like "16:47 – 16:50"). Minutes/seconds
// require two digits so ratios and scores ("1:2", "3:1") stay fail-closed as
// unsupported operator syntax. Claimed BEFORE the operator check; without this
// pass any digit:digit pair hits NUMERIC_OPERATOR_RE and 422-blocks the whole
// paste even when the rewrite preserves every time verbatim.
const CLOCK_TIME_RE = /(?<![\d:])(?:[01]?\d|2[0-3]):(?:[0-5]\d)(?::(?:[0-5]\d))?(?!\d)/g;
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
const KO_MAGNITUDE_FACTORS = Object.freeze({
  백: 100,
  천: 1000,
  만: 10000,
  억: 100000000,
  조: 1000000000000,
  경: 10000000000000000,
  해: 100000000000000000000,
});
const WORD_NUMBERS = Object.freeze({
  en: Object.freeze({ zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 }),
  ko: Object.freeze({ 영: 0, 하나: 1, 둘: 2, 셋: 3, 넷: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10 }),
  zh: Object.freeze({ 零: 0, 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }),
  ja: Object.freeze({ 零: 0, 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }),
});
// v2 precision pass (2026-07-23): word-number detection is scoped to contexts
// that are actually numeric. v1 flagged bare ordinals/fractions (en: first,
// half, quarter, score) and any Hangul containing a Sino-Korean numeral
// morpheme (이해, 오해, 구조, 조건, 환경이 all matched 이+해 / 구+조 / 조+건 /
// 경+이), which 422-rejected most real KO/EN prose on the live web tier.
// Digit-anchored protection is untouched; word-only numeral drift (e.g.
// "이백" -> "삼백", "first" -> "second") is delegated to the LLM MPS/fidelity
// floors, which remain the enforcement line for non-digit claims.
const UNSUPPORTED_WORD_NUMBER_RE = Object.freeze({
  en: /\b(?:thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|trillion|quadrillion|dozen)\b/i,
  // 쉰 needs a counter ahead: bare 쉰 is overwhelmingly the rest-verb form
  // (목이 쉰 소리, 하루 쉰 다음). 분의 was dropped in v2.2: it is a substring of
  // 여러분의/대부분의 (both everyday words), and digit fractions like 3분의 1
  // are already protected by their claimed digits.
  ko: /(?:열(?:한|두)|스물|서른|마흔|쉰(?=\s?(?:명|살|개|번|세))|예순|일흔|여든|아흔|절반)/u,
  zh: /(?:两|兩|壹|贰|貳|叁|參|肆|伍|陆|陸|柒|捌|玖|拾|廿|卅|卌|半|第|分之|百|千|萬|万|億|亿|兆|京|垓)/,
  ja: /(?:壱|弐|参|肆|伍|陸|漆|捌|玖|拾|半|第|分の|百|千|万|億|兆|京|垓)/,
});
// Bare-magnitude context: digits next to a magnitude are always claimable-
// adjacent ("3백"), and a magnitude char is treated as numeric only when it is
// a standalone eojeol head — `(?<![가-힣])` — so 환경/배경/골백 never fire. The
// spaced/attached counter branches carry only 백천만억: 조/경/해 as bare word
// numerals do not occur without digits, while their morpheme collisions are
// everywhere (조건, 조회, 경우, "그 해 명절").
const KO_SINGLE_MAGNITUDE_CONTEXT_RE = /(?:\d\s*[백천만억조경해]|(?<![가-힣])[백천만억](?:\s+(?:개|건|권|그릇|대|마리|명|번|병|살|세|송이|장|채|층|통|편|회|년|월|일)|(?:달러|원|엔|위안|퍼센트)))/u;
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
    // A bare genitive の/之 next to a counter character is not a fraction:
    // 今回の, 日本の, and 今年之内 must not fail on unchanged input. Keep all
    // existing numeral contexts and 分の/分之 checks on the masked source.
    const unsupported = lang === 'zh'
      ? /[两兩壹贰貳叁參肆伍陆陸柒捌玖拾廿卅卌半第分之百千萬万億亿兆京垓]/gu
      : /[壱弐参肆伍陸漆捌玖拾半第分の百千万億兆京垓]/gu;
    for (const match of uncoveredSource.matchAll(unsupported)) {
      const index = match.index;
      const previous = uncoveredSource[index - 1] ?? '';
      const next = uncoveredSource[index + match[0].length] ?? '';
      const numeralContext = DECIMAL_DIGIT_RE.test(previous) || DECIMAL_DIGIT_RE.test(next)
        || numerals.test(previous) || numerals.test(next);
      const bareGenitive = (match[0] === 'の' || match[0] === '之') && previous !== '分';
      if (numeralContext || (!bareGenitive && (counters.test(previous) || counters.test(next)))) return true;
    }
    return compoundNumerals.test(uncoveredSource);
  }
  if (UNSUPPORTED_WORD_NUMBER_RE[lang]?.test(uncoveredSource)) return true;
  if (lang === 'ko' && KO_SINGLE_MAGNITUDE_CONTEXT_RE.test(uncoveredSource)) return true;
  if (lang === 'ko') {
    // Chained magnitude terms ("1억 2천만", "3만5천") leave residual magnitude
    // chars next to claimed spans or digits after the single-term scaled pass.
    // Partial claims would compare wrong values (천만 -> 천억 undetected), so
    // any leftover magnitude adjacent (space-skipped) to an occupied position
    // or digit fails closed instead.
    for (const match of uncoveredSource.matchAll(/[백천만억조경해]/gu)) {
      let left = match.index - 1;
      while (left >= 0 && /\s/.test(source[left])) left -= 1;
      if (left >= 0 && (occupied[left] || /\d/.test(source[left]))) return true;
      let right = match.index + 1;
      while (right < source.length && /\s/.test(source[right])) right += 1;
      if (right < source.length && (occupied[right] || /\d/.test(source[right]))) return true;
    }
  }
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
    // Bare numeral with nothing attached (space, dash, punctuation, or EOF
    // next): in Korean prose this position is dominated by discourse counters
    // ("사실 하나 —", "팁 하나 공유합니다", "질문 하나.") that filler/hook
    // rewrites legitimately delete; claiming them 422s meaning-preserving
    // rewrites. Genuine quantity claims carry a particle or counter and are
    // claimed below; bare-numeral drift is left to the LLM MPS/fidelity floors.
    if (!hangul.test(suffix[0] ?? '')) return false;
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
  // Clock times, claimed after dates (a claimed date span is already occupied)
  // and before every digit-token pass. The claim keeps the exact time value —
  // only a leading-zero hour is normalized ("09:05" === "9:05") — so a rewrite
  // must reproduce every time, and time drift fails as numeric_claim_changed.
  matchAll(CLOCK_TIME_RE, (m) => {
    add(m.index, m[0].length, `time:${m[0].replace(/^0(?=\d:)/, '')}`);
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

  // KO digit+magnitude ("3만", "1,200만", "1.5억") is the dominant Korean way
  // to write large numbers; v1 rejected it wholesale as unsupported, which
  // 422-blocked most business/news prose. A single digit-anchored magnitude is
  // deterministically convertible, so claim it as a scaled rational.
  //
  // v2.2 extends the accepted notation-equivalence class (previously
  // "3만" == "30000") to two more digit-anchored, exactly-computable forms:
  //  - compound magnitude units: 백/천 multiplying a large base ("3천만",
  //    "2백억") — the factor is the exact product of the two magnitudes;
  //  - STRICTLY DESCENDING integer chains ("1억 2천만", "3만5천", "2만 3천")
  //    claimed as one summed value, so "23,000" == "2만 3천". Live
  //    gemini-3.6-flash serving rewrites grouped digits into this form and was
  //    422-blocked on otherwise meaning-preserving output.
  // Anything else — ascending or repeated magnitudes ("2천 3만"), decimal
  // digits inside a chain ("1.5억 2천만"), or unattached magnitude residue —
  // is NOT claimed and falls through to the fail-closed magnitude-context
  // check on the uncovered residue, exactly as before.
  if (lang === 'ko') {
    // 백/천 may multiply 만억조경 (천만=1e7, 2백억=2e10). 해(1e20) is excluded
    // as a compound base: 천해(1e23) exceeds exact float64 range and does not
    // occur in real usage, so it stays fail-closed.
    const koMag = String.raw`(?:[백천]\s*[만억조경]|[백천만억조경해])`;
    const magFactor = (unit) => {
      let factor = 1n;
      for (const character of unit.replace(/\s+/g, '')) factor *= BigInt(KO_MAGNITUDE_FACTORS[character]);
      return factor;
    };
    const chainDigits = String.raw`\d{1,3}(?:,\d{3})+|\d+`;
    const koChain = new RegExp(String.raw`(?<![\w.])(?:${chainDigits})\s*${koMag}(?:\s*(?:${chainDigits})\s*${koMag})+(?![\d.백천만억조경해])`, 'g');
    matchAll(koChain, (m) => {
      const terms = [...m[0].matchAll(new RegExp(String.raw`(${chainDigits})\s*(${koMag})`, 'g'))];
      let previousFactor = null;
      let sum = 0n;
      for (const [, digits, unit] of terms) {
        const factor = magFactor(unit);
        // Not strictly descending -> leave unclaimed, fail closed downstream.
        if (previousFactor !== null && factor >= previousFactor) return;
        previousFactor = factor;
        sum += BigInt(normalizedNumber(digits)) * factor;
      }
      add(m.index, m[0].length, `number:${sum}/1`);
    });
    const koScaled = new RegExp(String.raw`(?<![\w.])(${number})\s*(${koMag})(?![\d백천만억조경해])`, 'g');
    matchAll(koScaled, (m) => add(m.index, m[0].length, `number:${scaledRational(normalizedNumber(m[1]), Number(magFactor(m[2])))}`));
  }
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
