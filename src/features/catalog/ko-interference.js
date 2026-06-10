// Shared Korean interference/calque rule catalog.
// Browser-pure: consumed by translationese detection, ko post-editese metrics,
// and the playground through direct ESM imports.

// Surface forms of a passive predicate (되다/받다/당하다/-어지다 families). Listed
// as composed NFC syllables because the passive marker fuses into the stem
// syllable (된다 = 되+ㄴ다), which a jamo alternation cannot match.
export const BY_PASSIVE_PREDICATE_SOURCE =
  '(?:된다|된|될|됨|됐다|됐|돼|되었|되어|되는|되며|되고|됩니다|됩|받는다|받았다|받은|받을|받는|받습니다|받아|당한다|당했다|당하다|당하는|당해|(?:어|아|여)(?:진다|졌다|진|질|지는|집니다|져))';

export const KO_INTERFERENCE_TRANSLATIONESE_RULES = [
  {
    id: 'a16-pronoun-literal',
    label: '영어식 3인칭 대명사 직역 (he/she/it/they)',
    strong: true,
    // Pronoun-literal calques (he/she/it/they → 그/그녀/그것/그들). The (?<![가-힣])
    // lookbehind keeps 로그/태그/블로그 compounds out; the particle cluster accepts
    // stacked particles (에게는, 과의, 처럼…) and the (?![가-힣]) boundary keeps bound
    // nouns like 그녀석/그것참 out. Bare 그 still requires an explicit particle.
    re: () => /(?<![가-힣])(?:(?:그녀|그것|그들)[은는이가을를의도만와과랑에게한테께서처럼보다마저조차까지부터로으요]{0,4}|그(?:는|가|를|의|에게|와|도|만))(?![가-힣])/g,
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
    re: () => /에\s*의(?:해|하여)/g,
    example: { before: '작업은 에이전트에 의해 처리됩니다.', after: '에이전트가 작업을 처리합니다.' },
  },
  {
    id: 't2-by-passive',
    label: '"~에 의해" + 피동 동사 결합',
    strong: true,
    // "에 의해/의하여" + a passive predicate in the following token. Matches fused
    // syllable forms (된다/됩니다/될/진다) that the old jamo alternation missed.
    re: () => new RegExp('에\\s*의(?:해|하여)\\s+\\S{0,12}?' + BY_PASSIVE_PREDICATE_SOURCE, 'g'),
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
    id: 'a7-light-verb',
    label: '영어식 have/make light verb 직역',
    strong: false,
    re: () => /(?:회의를\s*가(?:지|졌)|결정을\s*내(?:리|렸)|(?:을|를)\s*갖고\s*있(?:다|습니다|는|었|으)?)/g,
    example: { before: '우리는 회의를 가졌고 중요한 결정을 내렸다.', after: '우리는 회의에서 중요한 결정을 했다.' },
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

export const KO_INTERFERENCE_RULE_IDS = Object.freeze(
  KO_INTERFERENCE_TRANSLATIONESE_RULES.map((rule) => rule.id)
);

export const KO_POST_EDITESE_INTERFERENCE_RULE_IDS = Object.freeze([
  'a16-pronoun-literal',
  'a19-double-particle',
  'a7-light-verb',
  'passive-e-uihae',
  'a8-double-passive',
  'c11-connective-comma',
]);

const KO_INTERFERENCE_RULES_BY_ID = new Map(
  KO_INTERFERENCE_TRANSLATIONESE_RULES.map((rule) => [rule.id, rule])
);

export function getKoInterferenceRule(id) {
  const rule = KO_INTERFERENCE_RULES_BY_ID.get(id);
  if (!rule) throw new Error(`Unknown Korean interference rule: ${id}`);
  return rule;
}

export function buildKoInterferenceRegex(id) {
  return getKoInterferenceRule(id).re();
}
