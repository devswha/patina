import { ACTIVE_BLOCK_TYPES, isPreservePersona } from './schema.js';

function topItems(items, max = 12) {
  return Array.isArray(items) ? items.filter(Boolean).slice(0, max) : [];
}

function formatList(label, items) {
  const kept = topItems(items);
  return kept.length > 0 ? `${label}: ${kept.join(', ')}` : null;
}

function pushLine(lines, line) {
  if (line) lines.push(line);
}

// Per-language directive label sets. The persona CONTENT (allow/avoid words,
// metaphors, etc.) is authored per persona file; only the surrounding
// instruction scaffolding is localized here so the directive reads natively in
// the rewrite language. Unknown langs fall back to English.
const DIRECTIVE_LABELS = {
  ko: {
    persona: (name, id, depth) => `페르소나: ${name} (${id}, ${depth})`,
    preserve: '원문의 주장·사실·수치·인용·논지 순서를 100% 보존하고 어투·리듬·어휘·문장구조만 페르소나에 맞춘다.',
    content: '강조·coverage 우선순위만 페르소나화한다. 원문에 없는 주장·수치·예시·비유·세계관은 주입하지 않는다. MPS/fidelity hard-floor는 그대로 강제한다.',
    vocab: '어휘', preferred: '선호 어휘', avoid: '피할 어휘',
    density: (n) => `목표 밀도 ${n}/1000토큰`, maxPara: (n) => `문단당 최대 ${n}`,
    metaphor: '비유', allowedMetaphor: '허용 비유', forbidNewFacts: '새 사실을 만들지 않는 비유만 허용', maxNewMetaphor: (n) => `500자당 새 비유 최대 ${n}`,
    explanation: '설명', habits: '설명 습관', avoidHabits: '피할 습관',
    sentence: '문장 구조', register: (r) => `문체 ${r}`, cv: (a, b) => `문장 길이 CV ${a}~${b}`, avgUnits: (a, b) => `평균 어절 ${a}~${b}`, paraSent: (a, b) => `문단 문장 수 ${a}~${b}`, openerDiv: (n) => `문장 시작 다양도 최소 ${n}`,
    active: '활성 블럭', none: '없음',
  },
  en: {
    persona: (name, id, depth) => `Persona: ${name} (${id}, ${depth})`,
    preserve: 'Preserve 100% of the source claims, facts, numbers, quotes, and argument order; adapt only tone, rhythm, wording, and sentence structure to the persona.',
    content: 'Persona-shape emphasis and coverage priority only. Do not inject claims, numbers, examples, metaphors, or worldview absent from the source. The MPS/fidelity hard floors stay enforced.',
    vocab: 'Vocabulary', preferred: 'prefer', avoid: 'avoid',
    density: (n) => `target density ${n}/1000 tokens`, maxPara: (n) => `max ${n}/paragraph`,
    metaphor: 'Metaphors', allowedMetaphor: 'allowed', forbidNewFacts: 'only metaphors that introduce no new facts', maxNewMetaphor: (n) => `max ${n} new/500 chars`,
    explanation: 'Explanation', habits: 'habits', avoidHabits: 'avoid',
    sentence: 'Sentence structure', register: (r) => `register ${r}`, cv: (a, b) => `sentence-length CV ${a}-${b}`, avgUnits: (a, b) => `avg words ${a}-${b}`, paraSent: (a, b) => `sentences/paragraph ${a}-${b}`, openerDiv: (n) => `min opener diversity ${n}`,
    active: 'Active blocks', none: 'none',
  },
  zh: {
    persona: (name, id, depth) => `人格：${name}（${id}，${depth}）`,
    preserve: '完整保留原文的主张、事实、数字、引用与论证顺序，仅将语气、节奏、用词与句式调整为该人格。',
    content: '仅对强调与覆盖优先级进行人格化。不得注入原文没有的主张、数字、示例、比喻或世界观。MPS/fidelity 硬性下限照常强制执行。',
    vocab: '词汇', preferred: '偏好', avoid: '回避',
    density: (n) => `目标密度 ${n}/1000词元`, maxPara: (n) => `每段最多 ${n}`,
    metaphor: '比喻', allowedMetaphor: '允许', forbidNewFacts: '仅允许不产生新事实的比喻', maxNewMetaphor: (n) => `每500字最多 ${n} 个新比喻`,
    explanation: '说明', habits: '习惯', avoidHabits: '回避',
    sentence: '句子结构', register: (r) => `文体 ${r}`, cv: (a, b) => `句长 CV ${a}~${b}`, avgUnits: (a, b) => `平均词数 ${a}~${b}`, paraSent: (a, b) => `每段句数 ${a}~${b}`, openerDiv: (n) => `句首多样度不低于 ${n}`,
    active: '启用模块', none: '无',
  },
  ja: {
    persona: (name, id, depth) => `ペルソナ：${name}（${id}、${depth}）`,
    preserve: '原文の主張・事実・数値・引用・論の順序を100%保持し、語調・リズム・語彙・文構造のみをペルソナに合わせる。',
    content: '強調とカバレッジの優先順位のみをペルソナ化する。原文にない主張・数値・例・比喩・世界観は注入しない。MPS/fidelityのハードフロアはそのまま強制する。',
    vocab: '語彙', preferred: '優先', avoid: '回避',
    density: (n) => `目標密度 ${n}/1000トークン`, maxPara: (n) => `段落あたり最大 ${n}`,
    metaphor: '比喩', allowedMetaphor: '許可', forbidNewFacts: '新しい事実を生まない比喩のみ許可', maxNewMetaphor: (n) => `500字あたり新規比喩 最大 ${n}`,
    explanation: '説明', habits: '習慣', avoidHabits: '回避',
    sentence: '文構造', register: (r) => `文体 ${r}`, cv: (a, b) => `文長CV ${a}~${b}`, avgUnits: (a, b) => `平均語数 ${a}~${b}`, paraSent: (a, b) => `段落あたり文数 ${a}~${b}`, openerDiv: (n) => `文頭の多様度 最小 ${n}`,
    active: '有効ブロック', none: 'なし',
  },
};

/**
 * Render a compact, side-effect-free persona directive from a normalized
 * persona, localized to the rewrite language.
 *
 * @param {object} persona Normalized persona object from validatePersona().
 * @param {object} [options] Formatting options.
 * @param {string} [options.lang] Directive language (defaults to persona.lang, then ko).
 * @param {object} [options.tone] Resolved tone metadata (resolveTone result). When an
 *   explicit tone is in effect (tone_source user/auto), the tone block owns register,
 *   so the persona's own register line is suppressed to avoid a contradiction.
 *   Precedence: --tone/config tone > persona.register > profile voice.
 * @param {boolean} [options.korean] Deprecated back-compat alias: true → ko, false → en (only when lang is unset).
 * @returns {string} Persona prompt directive.
 */
export function formatPersonaDirective(persona, { lang, tone, korean } = {}) {
  if (!persona) return '';
  const resolvedLang = lang ?? persona.lang ?? (korean === false ? 'en' : 'ko');
  const L = DIRECTIVE_LABELS[resolvedLang] ?? DIRECTIVE_LABELS.en;
  // An explicit tone (--tone / config tone, or auto inference) owns register; the
  // persona defers so the directive never contradicts the Tone Resolution block.
  const toneOwnsRegister = Boolean(tone && (tone.tone_source === 'user' || tone.tone_source === 'auto'));

  const lines = [
    L.persona(persona.name ?? persona.id, persona.id, persona.depth),
  ];

  if (isPreservePersona(persona) || persona.depth === 'style-only') {
    lines.push(L.preserve);
  }
  if (persona.depth === 'content') {
    lines.push(L.content);
  }

  const blocks = persona.blocks ?? {};
  const preferredWords = blocks.preferredWords ?? {};
  if (preferredWords.active) {
    const parts = [
      formatList(L.preferred, preferredWords.allow),
      formatList(L.avoid, preferredWords.avoid),
    ].filter(Boolean);
    const density = preferredWords.density ?? {};
    if (density.targetPer1000Tokens != null) parts.push(L.density(density.targetPer1000Tokens));
    if (density.maxPerParagraph != null) parts.push(L.maxPara(density.maxPerParagraph));
    pushLine(lines, parts.length > 0 ? `- ${L.vocab}: ${parts.join('; ')}` : null);
  }

  const preferredMetaphors = blocks.preferredMetaphors ?? {};
  if (preferredMetaphors.active) {
    const parts = [formatList(L.allowedMetaphor, preferredMetaphors.allow)].filter(Boolean);
    if (preferredMetaphors.forbidNewFacts) parts.push(L.forbidNewFacts);
    if (preferredMetaphors.maxNewMetaphorsPer500Chars != null) {
      parts.push(L.maxNewMetaphor(preferredMetaphors.maxNewMetaphorsPer500Chars));
    }
    pushLine(lines, parts.length > 0 ? `- ${L.metaphor}: ${parts.join('; ')}` : null);
  }

  const explanationHabits = blocks.explanationHabits ?? {};
  if (explanationHabits.active) {
    const parts = [
      formatList(L.habits, explanationHabits.moves),
      formatList(L.avoidHabits, explanationHabits.avoid),
    ].filter(Boolean);
    pushLine(lines, parts.length > 0 ? `- ${L.explanation}: ${parts.join('; ')}` : null);
  }

  const sentenceStructure = blocks.sentenceStructure ?? {};
  if (sentenceStructure.active) {
    const parts = [];
    if (sentenceStructure.register && !toneOwnsRegister) parts.push(L.register(sentenceStructure.register));
    if (sentenceStructure.sentenceLengthCvTarget) parts.push(L.cv(...sentenceStructure.sentenceLengthCvTarget));
    if (sentenceStructure.avgSentenceEojeolTarget) parts.push(L.avgUnits(...sentenceStructure.avgSentenceEojeolTarget));
    if (sentenceStructure.paragraphSentenceCountTarget) parts.push(L.paraSent(...sentenceStructure.paragraphSentenceCountTarget));
    if (sentenceStructure.openerDiversityMin != null) parts.push(L.openerDiv(sentenceStructure.openerDiversityMin));
    pushLine(lines, parts.length > 0 ? `- ${L.sentence}: ${parts.join('; ')}` : null);
  }

  const activeBlocks = ACTIVE_BLOCK_TYPES.filter((type) => {
    const camel = type.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    return blocks[camel]?.active === true;
  }).join(', ');
  lines.push(`${L.active}: ${activeBlocks || L.none}`);
  return lines.join('\n');
}

/**
 * Whether a persona injects ACTIVE voice traits — content-depth emphasis or any
 * active voice block. This is NOT a statement about voice OWNERSHIP: under the
 * v6.2 contract any active persona (including the `preserve` default) is the
 * sole voice owner. This predicate answers only the narrower question the
 * profile-voice-retirement migration warning needs: does the persona carry
 * genre voice traits? A trait-less persona like `preserve` returns false, so a
 * user still relying on the retired profile voice gets nudged toward a
 * genre-voicing persona.
 *
 * @param {object} persona Normalized persona object.
 * @returns {boolean} True if the persona injects active voice traits.
 */
export function personaHasVoiceTraits(persona) {
  if (!persona) return false;
  if (persona.depth === 'content') return true;
  const blocks = persona.blocks ?? {};
  return ACTIVE_BLOCK_TYPES.some((type) => {
    const camel = type.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    return blocks[camel]?.active === true;
  });
}

/**
 * Return deterministic persona target features for scoring.
 *
 * @param {object} persona Normalized persona object.
 * @returns {object} Target feature mapping.
 */
export function personaTargetFeatures(persona) {
  return persona?.targetFeatures ?? {};
}
