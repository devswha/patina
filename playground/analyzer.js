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
export const DEFAULT_MIN_BURSTINESS_SENTENCES = 3;
export const DEFAULT_MATTR_BANDS = { low: 0.55, high: 0.70 };
export const DEFAULT_MATTR_WINDOW = 50;
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
// Korean translationese (번역투/calque) advisory signal. This mirrors
// src/features/translationese.js and intentionally stays out of score/hot
// coupling; it is exposed as document-level audit metadata only.
// Mirrors BY_PASSIVE_PREDICATE in src/features/translationese.js.
const BY_PASSIVE_PREDICATE =
  '(?:된다|된|될|됨|됐다|됐|돼|되었|되어|되는|되며|되고|됩니다|됩|받는다|받았다|받은|받을|받는|받습니다|받아|당한다|당했다|당하다|당하는|당해|(?:어|아|여)(?:진다|졌다|진|질|지는|집니다|져))';
export const TRANSLATIONESE_RULES = [
  {
    id: 'noun-calque',
    label: '직역 명사구 (pillar/layer 류 calque)',
    strong: true,
    re: () => /커맨드 기둥|명령(?:어)? 기둥|기둥 커맨드|[가-힣]+ 레이어로서/g,
    example: { before: '세 가지 커맨드 기둥을 설치합니다.', after: '핵심 커맨드 세 가지를 설치합니다.' },
  },
  {
    id: 'dummy-subject',
    label: '가주어 "그것은/이것은" (English "it is")',
    strong: true,
    re: () => /(?:^|[.!?。]\s+|\n)\s*(?:그것은|이것은|그것이|이것이)\s/g,
    example: { before: '그것은 매우 중요하다.', after: '매우 중요하다.' },
  },
  {
    id: 'direct-address-you',
    label: '"당신" 직접 호칭 (English "you")',
    strong: true,
    re: () => /당신(?:은|이|의|에게|을|를|께서|께)?/g,
    example: { before: '당신은 이것을 설정할 수 있습니다.', after: '이건 설정할 수 있다.' },
  },
  {
    id: 'a16-pronoun-literal',
    label: '영어식 3인칭 대명사 직역 (he/she/it/they)',
    strong: true,
    // Require a non-Hangul boundary before the pronoun (so 로그/버그/태그 don't match)
    // and an eojeol boundary after it (so 그녀석/그것참 don't match).
    re: () => /(?<![가-힣])(?:그녀(?:는|가|를|의|에게|와|도|만)?|그것(?:은|이|을|의|에|에게)?|그들(?:은|이|을|의|에게|과|도)?|그(?:는|가|를|의|에게|와|도|만))(?=\s|[.,!?。]|$)/g,
    example: { before: '메리는 그녀가 그녀의 어머니에게 전화했다고 말했다.', after: '메리는 어머니에게 전화했다고 말했다.' },
  },
  {
    id: 'a19-double-particle',
    label: '이중 조사 결합 (-에서의/-으로의/-에의)',
    strong: true,
    re: () => /(?:에서의|에로의|으로의|에의|으로부터의|로부터의)/g,
    example: { before: '회의에서의 결정은 앞으로의 운영으로의 전환을 앞당겼다.', after: '회의에서 나온 결정은 앞으로 운영을 전환하는 일을 앞당겼다.' },
  },
  {
    id: 'passive-e-uihae',
    label: '"~에 의해" 피동 (English by-passive)',
    strong: false,
    re: () => /에 의해/g,
    example: { before: '작업은 에이전트에 의해 처리됩니다.', after: '에이전트가 작업을 처리합니다.' },
  },
  {
    id: 't2-by-passive',
    label: '"~에 의해" + 피동 동사 결합',
    strong: true,
    // "에 의해" + a passive predicate in the following token. Matches fused
    // syllable forms (된다/됩니다/될/진다) that the old jamo alternation missed.
    re: () => new RegExp('에\\s*의(?:해|하여)\\s+\\S{0,12}?' + BY_PASSIVE_PREDICATE, 'g'),
    example: { before: '이 작업은 에이전트에 의해 처리되었다.', after: '에이전트가 이 작업을 처리했다.' },
  },
  {
    id: 'a8-double-passive',
    label: '이중 피동 표면형 (-되어진/-보여진/-쓰여진)',
    strong: true,
    re: () => /(?:되어진다|되어졌다|되어진|되어지는|보여진다|보여졌다|보여진|쓰여진다|쓰여졌다|쓰여진|잊혀진|잊혀졌|닫혀진|열려진|불려진|놓여진)/g,
    example: { before: '이 문제는 분석되어진 뒤 보고서에 쓰여진다.', after: '이 문제는 분석된 뒤 보고서에 쓰인다.' },
  },
  {
    id: 'have-overuse',
    label: '"~을 가지고 있다" (English "have")',
    strong: false,
    re: () => /(?:을|를)\s*(?:가지(?:고 있|고 있습니다|고 있다)|갖(?:고 있|고 있습니다|고 있다))/g,
    example: { before: '이 도구는 유연성을 가지고 있습니다.', after: '이 도구는 유연합니다.' },
  },
  {
    id: 'a7-light-verb',
    label: '영어식 have/make light verb 직역',
    strong: false,
    re: () => /(?:회의를\s*가(?:지|졌)|결정을\s*내(?:리|렸)|(?:을|를)\s*갖고\s*있(?:다|습니다|는|었|으)?)/g,
    example: { before: '우리는 회의를 가졌고 중요한 결정을 내렸다.', after: '우리는 회의에서 중요한 결정을 했다.' },
  },
  {
    id: 'one-of',
    label: '"~중 하나" (English "one of the")',
    strong: false,
    re: () => /중\s*하나(?:이다|입니다|인|로|다|예요)?/g,
    example: { before: '가장 빠른 도구 중 하나입니다.', after: '손꼽히게 빠릅니다.' },
  },
  {
    id: 'provides',
    label: '"~을 제공합니다" (English "provides")',
    strong: false,
    re: () => /(?:을|를)\s*제공(?:합니다|한다|해 줍니다|해준다)/g,
    example: { before: '다양한 기능을 제공합니다.', after: '여러 기능을 쓸 수 있다.' },
  },
  {
    id: 'as-follows',
    label: '"다음과 같습니다" (English "as follows")',
    strong: false,
    re: () => /다음과\s*같(?:습니다|다|은|이)/g,
    example: { before: '사용법은 다음과 같습니다.', after: '사용법은 이렇다.' },
  },
  {
    id: 'make-easy',
    label: '"~하게 만들어 준다" (English "make it ~")',
    strong: false,
    re: () => /(?:쉽게|가능하게|간단하게|편하게)\s*(?:만들어\s*(?:줍니다|준다|줘)|만듭니다|만든다)/g,
    example: { before: '설치를 쉽게 만들어 줍니다.', after: '설치가 쉬워진다.' },
  },
  {
    id: 'c11-connective-comma',
    label: '연결어미 뒤 쉼표 (-고,/-며,/-지만,)',
    strong: false,
    minCount: 2,
    re: () => /(?:고|며|지만|면서|아서|어서)\s*,/g,
    example: { before: '그는 자료를 검토하고, 결과를 정리하며, 보고서를 작성했다.', after: '그는 자료를 검토하고 결과를 정리한 뒤 보고서를 작성했다.' },
  },
];

export const TRANSLATIONESE_ABS_MIN = 4;
export const TRANSLATIONESE_DENSITY_MIN = 0.5;
export const TRANSLATIONESE_STRONG_MIN = 1;
export const KO_POST_EDITESE_SCHEMA = 'koPostEditese.v1';

const KO_POST_EDITESE_SUFFIX_GROUPS = [
  { className: 'quote', suffixes: ['라고', '이라고'] },
  { className: 'source', suffixes: ['에게서', '한테서', '으로부터', '로부터'] },
  { className: 'instrument', suffixes: ['으로써', '로써'] },
  { className: 'standard', suffixes: ['으로서', '로서'] },
  { className: 'topic', suffixes: ['은', '는'] },
  { className: 'subject', suffixes: ['이', '가', '께서'] },
  { className: 'object', suffixes: ['을', '를'] },
  { className: 'genitive', suffixes: ['의'] },
  { className: 'location', suffixes: ['에서', '에게', '한테', '께', '에'] },
  { className: 'direction', suffixes: ['으로', '로'] },
  { className: 'conjunction', suffixes: ['와', '과', '하고', '랑'] },
  { className: 'additive', suffixes: ['도', '또한'] },
  { className: 'delimiter', suffixes: ['만', '까지', '부터', '마다'] },
  { className: 'comparison', suffixes: ['보다', '처럼'] },
  { className: 'formal_ending', suffixes: ['습니다', '습니까', '합니다', '합니까', '입니다'] },
  { className: 'polite_ending', suffixes: ['어요', '아요', '예요', '이에요', '네요', '군요', '지요'] },
  { className: 'casual_ending', suffixes: ['죠', '네', '군'] },
  { className: 'declarative_ending', suffixes: ['한다', '된다', '했다', '였다', '이다', '있다', '없다'] },
];

const KO_POST_EDITESE_SUFFIX_MATCHERS = KO_POST_EDITESE_SUFFIX_GROUPS
  .flatMap((group) =>
    group.suffixes.map((suffix) => ({
      className: group.className,
      suffix,
      length: Array.from(suffix).length,
    }))
  )
  .sort((a, b) => b.length - a.length);

const KO_POST_EDITESE_ENDING_SUFFIXES = [
  '습니다', '습니까', '합니다', '합니까', '입니다', '어요', '아요', '예요', '이에요',
  '네요', '군요', '지요', '죠', '한다', '된다', '했다', '였다', '이다', '있다',
  '없다', '왔다', '봤다', '다',
].sort((a, b) => Array.from(b).length - Array.from(a).length);
// Canonical token for regular formal '-ㅂ니다 / -ㅂ니까' endings (됩니다, 줍니다, 합니까…)
// whose ㅂ marker fuses into the stem syllable and so isn't a literal suffix.
const KO_POST_EDITESE_FORMAL_NIDA = 'ㅂ니다';
const KO_POST_EDITESE_FORMAL_ENDINGS = new Set(['습니다', '습니까', '합니다', '합니까', '입니다', KO_POST_EDITESE_FORMAL_NIDA]);
const KO_POST_EDITESE_POLITE_ENDINGS = new Set(['어요', '아요', '예요', '이에요', '네요', '군요', '지요', '죠']);
const KO_POST_EDITESE_DECLARATIVE_DA_ENDINGS = new Set(['한다', '된다', '했다', '였다', '이다', '있다', '없다', '왔다', '봤다', '다']);

// Pronoun-literal calques (he/she/it/they → 그/그녀/그것/그들). The (?<![가-힣])
// lookbehind keeps 로그/태그/블로그 compounds out; the particle cluster accepts
// stacked particles (에게는, 과의, 처럼…) and the (?![가-힣]) boundary keeps bound
// nouns like 그녀석/그것참 out (석/참 are not particle syllables). Bare 그 still
// requires an explicit particle so determiner uses (그 사람) never match.
// Must stay pattern-identical to POST_EDITESE_PRONOUN_LITERAL_RE in src/features/stylometry.js.
const KO_POST_EDITESE_PRONOUN_LITERAL_RE = /(?<![가-힣])(?:(?:그녀|그것|그들)[은는이가을를의도만와과랑에게한테께서처럼보다마저조차까지부터로으요]{0,4}|그(?:는|가|를|의|에게|와|도|만))(?![가-힣])/g;
const KO_POST_EDITESE_DOUBLE_PARTICLE_RE = /(?:에서의|에로의|으로의|에의|으로부터의|로부터의)/g;
const KO_POST_EDITESE_PROGRESSIVE_ASPECT_RE = /고\s*있(?:다|습니다|는|었|으|고|지|기)?/g;
const KO_POST_EDITESE_LIGHT_VERB_RE = /(?:회의를\s*가(?:지|졌)|결정을\s*내(?:리|렸)|(?:을|를)\s*갖고\s*있(?:다|습니다|는|었|으)?)/g;
const KO_POST_EDITESE_BY_PASSIVE_RE = /에\s*의(?:해|하여)/g;
const KO_POST_EDITESE_DOUBLE_PASSIVE_RE = /(?:되어진다|되어졌다|되어진|되어지는|보여진다|보여졌다|보여진|쓰여진다|쓰여졌다|쓰여진|잊혀진|잊혀졌|닫혀진|열려진|불려진|놓여진)/g;
const KO_POST_EDITESE_CONNECTIVE_COMMA_RE = /(?:고|며|지만|면서|아서|어서)\s*,/g;
const KO_POST_EDITESE_RELATIVE_CLAUSE_PROXY_RE = /[가-힣]+(?:하는|되는|받는|받은|쓰인|되어진|보여진|한|할|된|될|던|운|온|인|힌|진|린|킨|쓴)\s+[가-힣]+/g;



const SENTENCE_SPLIT_RE = /[.!?]+\s+|(?<=[。！？…])|\n+/u;
const PARAGRAPH_SPLIT_RE = /\n\s*\n/;
const LIST_LINE_RE = /^\s*(?:[-*+]\s+|\d+[.)]\s+)/u;
const EDGE_PUNCT_RE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
const CJK_TOKEN_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\u30FC]|[A-Za-z0-9]+/gu;
const HANGUL_RE = /[\u3131-\u318e\uac00-\ud7a3]/u;
const COMMA_RE = /[,，、]/gu;

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
    singleSyllableRatio:
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
  const matches = [];

  for (const token of eojeols) {
    const match = KO_POST_EDITESE_SUFFIX_MATCHERS.find(
      (candidate) => token.length > candidate.suffix.length && token.endsWith(candidate.suffix)
    );
    if (match) {
      matches.push({ className: match.className, suffix: match.suffix });
    }
  }

  const matchedCount = matches.length;
  const classes = [...new Set(matches.map((match) => match.className))].sort();
  const suffixes = [...new Set(matches.map((match) => match.suffix))].sort();

  return {
    proxy: 'suffix',
    eojeolCount: eojeols.length,
    matchedCount,
    coverage: eojeols.length > 0 ? matchedCount / eojeols.length : null,
    distinctClassCount: classes.length,
    classDiversity: matchedCount > 0 ? classes.length / matchedCount : null,
    distinctSuffixCount: suffixes.length,
    suffixDiversity: matchedCount > 0 ? suffixes.length / matchedCount : null,
    classes,
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

// Density-gated discourse tells (issue #334): fake-candor / manufactured-intimacy
// openers and decorative thematic breaks. Mirrors src/features/discourse-tells.js.
const FAKE_CANDOR_RULES = [
  /\bhere'?s the thing\b/gi,
  /\bhere'?s the kicker\b/gi,
  /\blet'?s be honest\b/gi,
  /\blet'?s be real\b/gi,
  /\bthe truth is\b/gi,
  /\bi'?ll be honest(?: with you)?\b/gi,
  /\breal talk\b/gi,
];
export const DEFAULT_FAKE_CANDOR_MIN = 2;
export const DEFAULT_THEMATIC_BREAK_MIN = 3;
const THEMATIC_BREAK_LINE = /^[ \t]*(?:-[ \t]*){3,}$|^[ \t]*(?:\*[ \t]*){3,}$|^[ \t]*(?:_[ \t]*){3,}$/;
const HEADING_LINE = /^[ \t]*#{1,6}[ \t]+\S/;

export function detectFakeCandor(text) {
  const str = typeof text === 'string' ? text : '';
  const hits = [];
  let count = 0;
  for (const re of FAKE_CANDOR_RULES) {
    const m = str.match(re);
    if (m && m.length) {
      count += m.length;
      hits.push(...new Set(m.map((x) => x.trim().toLowerCase())));
    }
  }
  return { count, hits: [...new Set(hits)].slice(0, 5), hot: count >= DEFAULT_FAKE_CANDOR_MIN, threshold: DEFAULT_FAKE_CANDOR_MIN };
}

export function countFakeCandor(text) {
  return detectFakeCandor(text).count;
}

export function detectThematicBreaks(text) {
  const lines = (typeof text === 'string' ? text : '').split(/\r?\n/);
  let count = 0;
  let adjacentToHeading = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!THEMATIC_BREAK_LINE.test(lines[i])) continue;
    count++;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].trim() === '') continue;
      if (HEADING_LINE.test(lines[j])) adjacentToHeading++;
      break;
    }
  }
  return {
    count,
    adjacentToHeading,
    hot: count >= DEFAULT_THEMATIC_BREAK_MIN,
    threshold: DEFAULT_THEMATIC_BREAK_MIN,
  };
}
export function detectTranslationese(text, opts = {}) {
  const lang = opts.lang ?? 'ko';
  const str = typeof text === 'string' ? text : '';
  if (lang !== 'ko' || !str) {
    return {
      count: 0,
      density: 0,
      sentences: 0,
      byRule: [],
      hits: [],
      hot: false,
      thresholds: { count: TRANSLATIONESE_ABS_MIN, density: TRANSLATIONESE_DENSITY_MIN, strong: TRANSLATIONESE_STRONG_MIN },
    };
  }

  const byRule = [];
  const hits = [];
  const evidence = [];
  for (const rule of TRANSLATIONESE_RULES) {
    const matches = collectTranslationeseRuleMatches(str, rule);
    const minCount = rule.minCount ?? 1;
    if (matches.length >= minCount) {
      byRule.push({ id: rule.id, label: rule.label, strong: rule.strong, count: matches.length, example: rule.example });
      hits.push(...new Set(matches.map((m) => m.text.trim()).filter(Boolean)));
      evidence.push(...matches.map((match) => ({ ...match, strong: Boolean(rule.strong) })));
    }
  }

  const independentEvidence = selectIndependentTranslationeseEvidence(evidence);
  const count = independentEvidence.length;
  const strongCount = independentEvidence.filter((match) => match.strong).length;
  const sentences = Math.max(1, splitProseSentences(str).length);
  const density = count / sentences;
  const hot = count >= TRANSLATIONESE_ABS_MIN &&
    density >= TRANSLATIONESE_DENSITY_MIN &&
    strongCount >= TRANSLATIONESE_STRONG_MIN;
  return {
    count,
    density: Number(density.toFixed(3)),
    sentences,
    byRule: byRule.sort((a, b) => b.count - a.count),
    hits: [...new Set(hits)].slice(0, 8),
    hot,
    thresholds: { count: TRANSLATIONESE_ABS_MIN, density: TRANSLATIONESE_DENSITY_MIN, strong: TRANSLATIONESE_STRONG_MIN },
  };
}

function collectTranslationeseRuleMatches(str, rule) {
  const re = rule.re();
  const matches = [];
  let match;
  while ((match = re.exec(str)) !== null) {
    matches.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
    if (match[0] === '') re.lastIndex += 1;
  }
  return matches;
}

function selectIndependentTranslationeseEvidence(matches) {
  const selected = [];
  const ranked = [...matches].sort((a, b) => {
    if (a.strong !== b.strong) return a.strong ? -1 : 1;
    const lengthDelta = (b.end - b.start) - (a.end - a.start);
    if (lengthDelta !== 0) return lengthDelta;
    return a.start - b.start;
  });

  for (const match of ranked) {
    if (!selected.some((kept) => translationeseEvidenceOverlaps(kept, match))) {
      selected.push(match);
    }
  }

  return selected.sort((a, b) => a.start - b.start);
}

function translationeseEvidenceOverlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}


export function koreanPostEditeseFeatures(text, opts = {}) {
  const lang = opts.lang ?? 'ko';
  const str = typeof text === 'string' ? text.normalize('NFC') : '';
  if (lang !== 'ko') return skippedKoPostEditese(lang, 'non-ko');
  if (str.trim().length === 0) return skippedKoPostEditese(lang, 'empty');

  const paragraphs = splitParagraphs(str);
  const totalEojeols = koreanEojeols(str);
  if (totalEojeols.length === 0) return skippedKoPostEditese(lang, 'no-hangul-eojeols');

  const paragraphRows = paragraphs.map((paragraph, index) => buildKoPostEditeseRow(paragraph, `P${index + 1}`));
  const docSentences = paragraphs.flatMap((paragraph) => splitProseSentences(paragraph));
  return {
    schema: KO_POST_EDITESE_SCHEMA,
    lang,
    analyzed: true,
    skipReason: null,
    paragraphCount: paragraphRows.length,
    sentenceCount: docSentences.length,
    eojeolCount: totalEojeols.length,
    metrics: buildKoPostEditeseMetrics(str, docSentences),
    paragraphs: paragraphRows,
  };
}

function skippedKoPostEditese(lang, skipReason) {
  return {
    schema: KO_POST_EDITESE_SCHEMA,
    lang,
    analyzed: false,
    skipReason,
    paragraphCount: 0,
    sentenceCount: 0,
    eojeolCount: 0,
    metrics: zeroKoPostEditeseMetrics(),
    paragraphs: [],
  };
}

function zeroKoPostEditeseMetrics() {
  return {
    lexical: {
      tokenCount: 0,
      typeCount: 0,
      ttr: null,
      mattr: null,
      endingTypeCount: 0,
      endingDiversity: null,
    },
    endings: {
      declarativeDaCount: 0,
      declarativeDaRatio: null,
      handaCount: 0,
      doendaCount: 0,
      idaCount: 0,
      formalEndingCount: 0,
      politeEndingCount: 0,
      endingStreakMax: 0,
    },
    interference: {
      pronounLiteralCount: 0,
      doubleParticleCount: 0,
      progressiveAspectCount: 0,
      lightVerbCount: 0,
      byPassiveCount: 0,
      doublePassiveCount: 0,
      connectiveCommaCount: 0,
      relativeClauseProxyCount: 0,
    },
    rhythm: {
      meanSentenceEojeols: null,
      sentenceEojeolCV: null,
      meanEojeolLength: null,
      eojeolLengthCV: null,
      commaPerSentence: null,
      commaPer100Chars: null,
      suffixMatchedCount: 0,
      suffixClassDiversity: null,
      suffixDiversity: null,
    },
  };
}

function buildKoPostEditeseRow(paragraph, id) {
  const sentences = splitProseSentences(paragraph);
  const eojeols = koreanEojeols(paragraph);
  return {
    id,
    sentenceCount: sentences.length,
    eojeolCount: eojeols.length,
    metrics: buildKoPostEditeseMetrics(paragraph, sentences),
  };
}

function buildKoPostEditeseMetrics(text, sentences = splitProseSentences(text)) {
  const eojeols = koreanEojeols(text);
  const lowerEojeols = eojeols.map((token) => token.toLowerCase());
  const typeCount = new Set(lowerEojeols).size;
  const lengths = eojeols.map(koreanLength).filter((length) => length > 0);
  const endings = sentences.map(extractKoPostEditeseSentenceEnding).filter(Boolean);
  const endingTypeCount = new Set(endings).size;
  const suffixStats = koPostEditeseSuffixStats(eojeols);
  const comma = commaDensity(text, sentences.length);
  const sentenceEojeolCounts = sentences
    .map((sentence) => koreanEojeols(sentence).length)
    .filter((count) => count > 0);

  return {
    lexical: {
      tokenCount: eojeols.length,
      typeCount,
      ttr: ratio(typeCount, eojeols.length),
      mattr: roundMetric(mattr(eojeols)),
      endingTypeCount,
      endingDiversity: ratio(endingTypeCount, sentences.length),
    },
    endings: buildKoPostEditeseEndings(endings),
    interference: {
      pronounLiteralCount: countPattern(text, KO_POST_EDITESE_PRONOUN_LITERAL_RE),
      doubleParticleCount: countPattern(text, KO_POST_EDITESE_DOUBLE_PARTICLE_RE),
      progressiveAspectCount: countPattern(text, KO_POST_EDITESE_PROGRESSIVE_ASPECT_RE),
      lightVerbCount: countPattern(text, KO_POST_EDITESE_LIGHT_VERB_RE),
      byPassiveCount: countPattern(text, KO_POST_EDITESE_BY_PASSIVE_RE),
      doublePassiveCount: countPattern(text, KO_POST_EDITESE_DOUBLE_PASSIVE_RE),
      connectiveCommaCount: countPattern(text, KO_POST_EDITESE_CONNECTIVE_COMMA_RE),
      relativeClauseProxyCount: countPattern(text, KO_POST_EDITESE_RELATIVE_CLAUSE_PROXY_RE),
    },
    rhythm: {
      meanSentenceEojeols: ratio(eojeols.length, sentences.length),
      sentenceEojeolCV: roundMetric(coefficientOfVariation(sentenceEojeolCounts)),
      meanEojeolLength: roundMetric(mean(lengths)),
      eojeolLengthCV: roundMetric(coefficientOfVariation(lengths)),
      commaPerSentence: roundMetric(comma.perSentence),
      commaPer100Chars: roundMetric(comma.per100Chars),
      suffixMatchedCount: suffixStats.matchedCount,
      suffixClassDiversity: roundMetric(suffixStats.classDiversity),
      suffixDiversity: roundMetric(suffixStats.suffixDiversity),
    },
  };
}

function buildKoPostEditeseEndings(endings) {
  const declarativeDaCount = endings.filter((ending) => KO_POST_EDITESE_DECLARATIVE_DA_ENDINGS.has(ending)).length;
  return {
    declarativeDaCount,
    declarativeDaRatio: ratio(declarativeDaCount, endings.length),
    handaCount: endings.filter((ending) => ending === '한다').length,
    doendaCount: endings.filter((ending) => ending === '된다').length,
    idaCount: endings.filter((ending) => ending === '이다').length,
    formalEndingCount: endings.filter((ending) => KO_POST_EDITESE_FORMAL_ENDINGS.has(ending)).length,
    politeEndingCount: endings.filter((ending) => KO_POST_EDITESE_POLITE_ENDINGS.has(ending)).length,
    endingStreakMax: maxKoPostEditeseDeclarativeDaStreak(endings),
  };
}

function extractKoPostEditeseSentenceEnding(sentence) {
  const eojeol = koreanEojeols(sentence).at(-1);
  if (!eojeol) return null;
  const matched = KO_POST_EDITESE_ENDING_SUFFIXES.find((ending) => eojeol.endsWith(ending)) ?? null;
  // Regular formal '-ㅂ니다 / -ㅂ니까' (됩니다, 표시됩니다, 합니까…) fuse the ㅂ marker into
  // the stem syllable, so they fall through to the bare '다' bucket and get miscounted as
  // declarative '-다' style. Reclassify them as a formal ending.
  if ((matched === '다' || matched === null) && isKoPostEditeseFormalFusedEnding(eojeol)) {
    return KO_POST_EDITESE_FORMAL_NIDA;
  }
  return matched;
}

// True for '-ㅂ니다 / -ㅂ니까' formal endings: the syllable before 니다/니까 carries a ㅂ
// jongseong (batchim index 17). Distinguishes 됩니다/아닙니다 (formal) from 아니다 (plain).
function isKoPostEditeseFormalFusedEnding(eojeol) {
  const m = /(.)(?:니다|니까)$/.exec(eojeol);
  if (!m) return false;
  const code = m[1].charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 === 17;
}

function maxKoPostEditeseDeclarativeDaStreak(endings) {
  let current = 0;
  let max = 0;
  for (const ending of endings) {
    if (KO_POST_EDITESE_DECLARATIVE_DA_ENDINGS.has(ending)) {
      current += 1;
      max = Math.max(max, current);
    } else {
      current = 0;
    }
  }
  return max;
}

function koPostEditeseSuffixStats(eojeols) {
  const matches = [];
  for (const token of eojeols) {
    const match = KO_POST_EDITESE_SUFFIX_MATCHERS.find(
      (candidate) => token.length > candidate.suffix.length && token.endsWith(candidate.suffix)
    );
    if (match) matches.push({ className: match.className, suffix: match.suffix });
  }
  const matchedCount = matches.length;
  const classCount = new Set(matches.map((match) => match.className)).size;
  const suffixCount = new Set(matches.map((match) => match.suffix)).size;
  return {
    matchedCount,
    classDiversity: matchedCount > 0 ? classCount / matchedCount : null,
    suffixDiversity: matchedCount > 0 ? suffixCount / matchedCount : null,
  };
}

function countPattern(text, pattern) {
  return (String(text ?? '').match(pattern) ?? []).length;
}

function ratio(numerator, denominator) {
  return denominator > 0 ? roundMetric(numerator / denominator) : null;
}

function roundMetric(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(3)) : null;
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

function cleanKoreanEojeol(chunk) {
  return String(chunk ?? '')
    .normalize('NFC')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

function koreanEojeols(paragraph) {
  if (!paragraph || !HANGUL_RE.test(paragraph)) return [];
  return paragraph
    .split(/\s+/u)
    .map(cleanKoreanEojeol)
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
