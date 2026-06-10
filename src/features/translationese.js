// Korean translationese (번역투 / calque) detector. The stylometry + lexicon
// signals catch STRUCTURE (sentence rhythm, AI lexicon); they do NOT catch
// lexical calques — phrasings that are grammatical Korean but read as
// translated-from-English ("커맨드 기둥" for "command pillars", "~에 의해" passives,
// "당신" for "you"). This deterministic, auditable detector fills that gap.
//
// IMPORTANT — precision first. Most of these constructions ALSO appear in good
// native Korean (formal/technical prose especially). So this is a DENSITY-GATED
// SUSPICION signal, not proof: a single "~에 의해" means nothing. It is surfaced
// as its own `translationese` signal and does NOT flip the document `hot`
// verdict (so it cannot regress benchmark false positives); the SKILL / callers
// decide what to do with it. Each rule ships a before→after example.
//
// ko-only for now (calques are language-specific).
import { splitProseSentences } from './segment.js';

// Surface forms of a passive predicate (되다/받다/당하다/-어지다 families). Listed
// as composed NFC syllables because the passive marker fuses into the stem
// syllable (된다 = 되+ㄴ다), which a jamo alternation cannot match.
const BY_PASSIVE_PREDICATE =
  '(?:된다|된|될|됨|됐다|됐|돼|되었|되어|되는|되며|되고|됩니다|됩|받는다|받았다|받은|받을|받는|받습니다|받아|당한다|당했다|당하다|당하는|당해|(?:어|아|여)(?:진다|졌다|진|질|지는|집니다|져))';

// Strong rules are rarer and can satisfy the hot gate; weak rules are common
// advisory evidence and never make the detector hot on their own.
// Each rule: { id, label, strong, re() -> fresh global RegExp, minCount?, example:{before,after} }
const RULES = [
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

const ABS_MIN = 4;        // need at least this many independent evidence spans, and
const DENSITY_MIN = 0.5;  // at least this many independent spans per prose sentence.
const STRONG_MIN = 1;     // weak/common rules are advisory-only unless a strong signal also fires.


/**
 * Scan ko text for translationese (calque) markers.
 * @param {string} text
 * @param {{lang?: string}} [opts]
 * @returns {{count:number, density:number, sentences:number, byRule:Array, hits:string[], hot:boolean, thresholds:{count:number,density:number,strong:number}}}
 */
export function detectTranslationese(text, opts = {}) {
  const lang = opts.lang ?? 'ko';
  const str = typeof text === 'string' ? text : '';
  if (lang !== 'ko' || !str) {
    return { count: 0, density: 0, sentences: 0, byRule: [], hits: [], hot: false, thresholds: { count: ABS_MIN, density: DENSITY_MIN, strong: STRONG_MIN } };
  }
  const byRule = [];
  const hits = [];
  const evidence = [];
  for (const rule of RULES) {
    const matches = collectRuleMatches(str, rule);
    const minCount = rule.minCount ?? 1;
    if (matches.length >= minCount) {
      byRule.push({ id: rule.id, label: rule.label, strong: rule.strong, count: matches.length, example: rule.example });
      hits.push(...new Set(matches.map((m) => m.text.trim()).filter(Boolean)));
      evidence.push(...matches.map((match) => ({ ...match, strong: Boolean(rule.strong) })));
    }
  }
  const independentEvidence = selectIndependentEvidence(evidence);
  const count = independentEvidence.length;
  const strongCount = independentEvidence.filter((match) => match.strong).length;
  const sentences = Math.max(1, splitProseSentences(str).length);
  const density = count / sentences;
  // Conservative: needs enough independent spans, enough density, and at least
  // one strong signal. Weak/common calques remain advisory even when clustered.
  const hot = count >= ABS_MIN && density >= DENSITY_MIN && strongCount >= STRONG_MIN;
  return {
    count,
    density: Number(density.toFixed(3)),
    sentences,
    byRule: byRule.sort((a, b) => b.count - a.count),
    hits: [...new Set(hits)].slice(0, 8),
    hot,
    thresholds: { count: ABS_MIN, density: DENSITY_MIN, strong: STRONG_MIN },
  };
}

function collectRuleMatches(str, rule) {
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

function selectIndependentEvidence(matches) {
  const selected = [];
  const ranked = [...matches].sort((a, b) => {
    if (a.strong !== b.strong) return a.strong ? -1 : 1;
    const lengthDelta = (b.end - b.start) - (a.end - a.start);
    if (lengthDelta !== 0) return lengthDelta;
    return a.start - b.start;
  });

  for (const match of ranked) {
    if (!selected.some((kept) => overlaps(kept, match))) {
      selected.push(match);
    }
  }

  return selected.sort((a, b) => a.start - b.start);
}

function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}

export { RULES as TRANSLATIONESE_RULES, ABS_MIN, DENSITY_MIN, STRONG_MIN };
