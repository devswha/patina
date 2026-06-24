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

/**
 * Render a compact, side-effect-free Korean persona directive from a normalized persona.
 *
 * @param {object} persona Normalized persona object from validatePersona().
 * @param {object} [options] Formatting options.
 * @param {boolean} [options.korean=true] Reserved for prompt parity; v1 emits Korean guidance.
 * @returns {string} Persona prompt directive.
 */
export function formatPersonaDirective(persona, { korean = true } = {}) {
  void korean;
  if (!persona) return '';

  const lines = [
    `페르소나: ${persona.name ?? persona.id} (${persona.id}, ${persona.depth})`,
  ];

  if (isPreservePersona(persona) || persona.depth === 'style-only') {
    lines.push('원문의 주장·사실·수치·인용·논지 순서를 100% 보존하고 어투·리듬·어휘·문장구조만 페르소나에 맞춘다.');
  }
  if (persona.depth === 'content') {
    lines.push('강조·coverage 우선순위만 페르소나화한다. 원문에 없는 주장·수치·예시·비유·세계관은 주입하지 않는다. MPS/fidelity hard-floor는 그대로 강제한다.');
  }

  const blocks = persona.blocks ?? {};
  const preferredWords = blocks.preferredWords ?? {};
  if (preferredWords.active) {
    const parts = [
      formatList('선호 어휘', preferredWords.allow),
      formatList('피할 어휘', preferredWords.avoid),
    ].filter(Boolean);
    const density = preferredWords.density ?? {};
    if (density.targetPer1000Tokens != null) parts.push(`목표 밀도 ${density.targetPer1000Tokens}/1000토큰`);
    if (density.maxPerParagraph != null) parts.push(`문단당 최대 ${density.maxPerParagraph}`);
    pushLine(lines, parts.length > 0 ? `- 어휘: ${parts.join('; ')}` : null);
  }

  const preferredMetaphors = blocks.preferredMetaphors ?? {};
  if (preferredMetaphors.active) {
    const parts = [formatList('허용 비유', preferredMetaphors.allow)].filter(Boolean);
    if (preferredMetaphors.forbidNewFacts) parts.push('새 사실을 만들지 않는 비유만 허용');
    if (preferredMetaphors.maxNewMetaphorsPer500Chars != null) {
      parts.push(`500자당 새 비유 최대 ${preferredMetaphors.maxNewMetaphorsPer500Chars}`);
    }
    pushLine(lines, parts.length > 0 ? `- 비유: ${parts.join('; ')}` : null);
  }

  const explanationHabits = blocks.explanationHabits ?? {};
  if (explanationHabits.active) {
    const parts = [
      formatList('설명 습관', explanationHabits.moves),
      formatList('피할 습관', explanationHabits.avoid),
    ].filter(Boolean);
    pushLine(lines, parts.length > 0 ? `- 설명: ${parts.join('; ')}` : null);
  }

  const sentenceStructure = blocks.sentenceStructure ?? {};
  if (sentenceStructure.active) {
    const parts = [];
    if (sentenceStructure.register) parts.push(`문체 ${sentenceStructure.register}`);
    if (sentenceStructure.sentenceLengthCvTarget) parts.push(`문장 길이 CV ${sentenceStructure.sentenceLengthCvTarget.join('~')}`);
    if (sentenceStructure.avgSentenceEojeolTarget) parts.push(`평균 어절 ${sentenceStructure.avgSentenceEojeolTarget.join('~')}`);
    if (sentenceStructure.paragraphSentenceCountTarget) parts.push(`문단 문장 수 ${sentenceStructure.paragraphSentenceCountTarget.join('~')}`);
    if (sentenceStructure.openerDiversityMin != null) parts.push(`문장 시작 다양도 최소 ${sentenceStructure.openerDiversityMin}`);
    pushLine(lines, parts.length > 0 ? `- 문장 구조: ${parts.join('; ')}` : null);
  }

  lines.push(`활성 블럭: ${ACTIVE_BLOCK_TYPES.filter((type) => {
    const camel = type.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    return blocks[camel]?.active === true;
  }).join(', ') || '없음'}`);
  return lines.join('\n');
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
