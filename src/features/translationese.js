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

// strong: rarer in good Korean, weighted higher. weak: common, advisory only.
// Each rule: { id, label, strong, re() -> fresh global RegExp, example:{before,after} }
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
    id: 'passive-e-uihae',
    label: '"~에 의해" 피동 (English by-passive)',
    strong: false,
    re: () => /에 의해/g,
    example: { before: '작업은 에이전트에 의해 처리됩니다.', after: '에이전트가 작업을 처리합니다.' },
  },
  {
    id: 'have-overuse',
    label: '"~을 가지고 있다" (English "have")',
    strong: false,
    re: () => /(?:을|를)\s*가지(?:고 있|고 있습니다|고 있다)/g,
    example: { before: '이 도구는 유연성을 가지고 있습니다.', after: '이 도구는 유연합니다.' },
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
];

const ABS_MIN = 4;      // need at least this many total calque hits, and
const DENSITY_MIN = 0.5; // at least this many hits per prose sentence, to call it hot.

/**
 * Scan ko text for translationese (calque) markers.
 * @param {string} text
 * @param {{lang?: string}} [opts]
 * @returns {{count:number, density:number, sentences:number, byRule:Array, hits:string[], hot:boolean, thresholds:{count:number,density:number}}}
 */
export function detectTranslationese(text, opts = {}) {
  const lang = opts.lang ?? 'ko';
  const str = typeof text === 'string' ? text : '';
  if (lang !== 'ko' || !str) {
    return { count: 0, density: 0, sentences: 0, byRule: [], hits: [], hot: false, thresholds: { count: ABS_MIN, density: DENSITY_MIN } };
  }
  const byRule = [];
  const hits = [];
  let count = 0;
  for (const rule of RULES) {
    const matches = str.match(rule.re());
    if (matches && matches.length) {
      count += matches.length;
      byRule.push({ id: rule.id, label: rule.label, strong: rule.strong, count: matches.length, example: rule.example });
      hits.push(...new Set(matches.map((m) => m.trim()).filter(Boolean)));
    }
  }
  const sentences = Math.max(1, splitProseSentences(str).length);
  const density = count / sentences;
  // Conservative: needs both an absolute floor AND a per-sentence density, so
  // long legit docs with a few calques never trip it.
  const hot = count >= ABS_MIN && density >= DENSITY_MIN;
  return {
    count,
    density: Number(density.toFixed(3)),
    sentences,
    byRule: byRule.sort((a, b) => b.count - a.count),
    hits: [...new Set(hits)].slice(0, 8),
    hot,
    thresholds: { count: ABS_MIN, density: DENSITY_MIN },
  };
}

export { RULES as TRANSLATIONESE_RULES, ABS_MIN, DENSITY_MIN };
