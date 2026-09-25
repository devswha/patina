import { ACTIVE_BLOCK_TYPES } from './schema.js';

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
    persona: (name, id) => `페르소나: ${name} (${id})`,
    vocab: '어휘', preferred: '선호 어휘', avoid: '피할 어휘',
    density: (n) => `목표 밀도 ${n}/1000토큰`, maxPara: (n) => `문단당 최대 ${n}`,
    metaphor: '비유', allowedMetaphor: '허용 비유', maxNewMetaphor: (n) => `500자당 새 비유 최대 ${n}`,
    explanation: '설명', habits: '설명 습관', avoidHabits: '피할 습관',
    sentence: '문장 구조', cv: (a, b) => `문장 길이 CV ${a}~${b}`, avgUnits: (a, b) => `평균 어절 ${a}~${b}`, paraSent: (a, b) => `문단 문장 수 ${a}~${b}`, openerDiv: (n) => `문장 시작 다양도 최소 ${n}`,
    active: '활성 블럭', none: '없음',
  },
  en: {
    persona: (name, id) => `Persona: ${name} (${id})`,
    vocab: 'Vocabulary', preferred: 'prefer', avoid: 'avoid',
    density: (n) => `target density ${n}/1000 tokens`, maxPara: (n) => `max ${n}/paragraph`,
    metaphor: 'Metaphors', allowedMetaphor: 'allowed', maxNewMetaphor: (n) => `max ${n} new/500 chars`,
    explanation: 'Explanation', habits: 'habits', avoidHabits: 'avoid',
    sentence: 'Sentence structure', cv: (a, b) => `sentence-length CV ${a}-${b}`, avgUnits: (a, b) => `avg words ${a}-${b}`, paraSent: (a, b) => `sentences/paragraph ${a}-${b}`, openerDiv: (n) => `min opener diversity ${n}`,
    active: 'Active blocks', none: 'none',
  },
  zh: {
    persona: (name, id) => `人格：${name}（${id}）`,
    vocab: '词汇', preferred: '偏好', avoid: '回避',
    density: (n) => `目标密度 ${n}/1000词元`, maxPara: (n) => `每段最多 ${n}`,
    metaphor: '比喻', allowedMetaphor: '允许', maxNewMetaphor: (n) => `每500字最多 ${n} 个新比喻`,
    explanation: '说明', habits: '习惯', avoidHabits: '回避',
    sentence: '句子结构', cv: (a, b) => `句长 CV ${a}~${b}`, avgUnits: (a, b) => `平均词数 ${a}~${b}`, paraSent: (a, b) => `每段句数 ${a}~${b}`, openerDiv: (n) => `句首多样度不低于 ${n}`,
    active: '启用模块', none: '无',
  },
  ja: {
    persona: (name, id) => `ペルソナ：${name}（${id}）`,
    vocab: '語彙', preferred: '優先', avoid: '回避',
    density: (n) => `目標密度 ${n}/1000トークン`, maxPara: (n) => `段落あたり最大 ${n}`,
    metaphor: '比喩', allowedMetaphor: '許可', maxNewMetaphor: (n) => `500字あたり新規比喩 最大 ${n}`,
    explanation: '説明', habits: '習慣', avoidHabits: '回避',
    sentence: '文構造', cv: (a, b) => `文長CV ${a}~${b}`, avgUnits: (a, b) => `平均語数 ${a}~${b}`, paraSent: (a, b) => `段落あたり文数 ${a}~${b}`, openerDiv: (n) => `文頭の多様度 最小 ${n}`,
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
 * @returns {string} Persona prompt directive.
 */
export function formatPersonaDirective(persona, { lang } = {}) {
  if (!persona) return '';
  const resolvedLang = lang ?? persona.lang ?? 'ko';
  const L = DIRECTIVE_LABELS[resolvedLang] ?? DIRECTIVE_LABELS.en;

  const lines = [
    L.persona(persona.name ?? persona.id, persona.id),
  ];


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
    // Casual/professional register is owned by --register, never persona.
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
