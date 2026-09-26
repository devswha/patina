// @ts-check

const BUDGET_POLICIES = new Set(['off', 'shadow', 'active']);

const NUMBER_DATE_PERCENT = /[\p{N}%％]|\b(?:percent(?:age)?|january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday|date)\b|(?:퍼센트|백분율|날짜|년|월|일)|(?:百分比|日期|年|月|日)|(?:パーセント|百分率|日付|年|月|日)/iu;
const NEGATION_POLARITY = /\b(?:no|not|never|none|neither|nor|without|cannot|can['’]t|won['’]t|isn['’]t|aren['’]t|wasn['’]t|weren['’]t|don['’]t|doesn['’]t|didn['’]t)\b|(?:안|않|못|없|아닌|부정)|(?:不|没|沒有|无|無|非)|(?:ない|ません|ぬ|ず)/iu;
const CAUSATION = /\b(?:because|since|therefore|thus|hence|due to|caus(?:e|ed|es|ing)|lead(?:s|ing)? to|result(?:s|ed|ing)? in)\b|(?:때문에|때문|인해|원인|결과|따라서|그래서)|(?:因为|由於|由于|导致|造成|因此|所以)|(?:ため|により|原因|結果|そのため|したがって)/iu;
const MULTI_CLAIM_CONNECTOR = /\b(?:and|but|or|yet|however|although|while|whereas|also|moreover|furthermore)\b|(?:그리고|하지만|그러나|또는|및|또한)|(?:和|但|但是|而且|或者|或|同时)|(?:そして|しかし|また|または|及び|しかしながら)/iu;

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isDefaultDocumentType(value) {
  return value === undefined || value === null || value === '' || value === 'default';
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isAbsentChoice(value) {
  return value === undefined || value === null || value === '';
}

/**
 * Classify a request without retaining any request content. This deliberately
 * recognizes a narrow, auditable minimal-safe shape; every other shape is
 * strict.
 *
 * @param {unknown} request
 * @returns {{selected: 'strict'|'minimal', reason: string}}
 */
export function classifyWebPromptBudget(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    return { selected: 'strict', reason: 'invalid_request' };
  }
  const candidate = /** @type {Record<string, unknown>} */ (request);
  if (candidate.mode !== 'first') return { selected: 'strict', reason: 'not_first_turn' };
  if (!['ko', 'en', 'zh', 'ja'].includes(/** @type {string} */ (candidate.lang))) {
    return { selected: 'strict', reason: 'unsupported_language' };
  }
  if (typeof candidate.text !== 'string' || candidate.text.trim().length === 0) {
    return { selected: 'strict', reason: 'invalid_text' };
  }
  if (/\r|\n/u.test(candidate.text)) return { selected: 'strict', reason: 'multiple_blocks' };
  if (Array.from(candidate.text).length > 200) return { selected: 'strict', reason: 'text_too_long' };
  if (!isDefaultDocumentType(candidate.documentType)) return { selected: 'strict', reason: 'non_default_document_type' };
  if (!isAbsentChoice(candidate.persona) || !isAbsentChoice(candidate.register)) {
    return { selected: 'strict', reason: 'persona_or_register' };
  }
  if (Object.hasOwn(candidate, 'rewriteHeadings') && !isAbsentChoice(candidate.rewriteHeadings) && candidate.rewriteHeadings !== false) {
    return { selected: 'strict', reason: 'transformation_options' };
  }
  if (NUMBER_DATE_PERCENT.test(candidate.text)) return { selected: 'strict', reason: 'number_date_or_percent' };
  if (NEGATION_POLARITY.test(candidate.text)) return { selected: 'strict', reason: 'negation_or_polarity' };
  if (CAUSATION.test(candidate.text)) return { selected: 'strict', reason: 'causation' };

  const sentences = candidate.text.match(/[.!?。！？]+/gu) || [];
  if (sentences.length > 1 || /[;；]/u.test(candidate.text) || MULTI_CLAIM_CONNECTOR.test(candidate.text)) {
    return { selected: 'strict', reason: 'multiple_claims' };
  }
  if ((Object.hasOwn(candidate, 'history') && (!Array.isArray(candidate.history) || candidate.history.length > 0))
    || (Object.hasOwn(candidate, 'original') && (typeof candidate.original !== 'string' || candidate.original !== candidate.text))) {
    return { selected: 'strict', reason: 'unexpected_context' };
  }
  return { selected: 'minimal', reason: 'eligible' };
}

/**
 * Resolve the selected budget against the explicit server policy. An invalid
 * or absent policy is off, preserving the strict prompt byte-for-byte.
 *
 * @param {unknown} request
 * @param {Record<string, string|undefined>|undefined|null} env
 * @returns {{policy: 'off'|'shadow'|'active', selected: 'strict'|'minimal', applied: 'strict'|'minimal', reason: string}}
 */
export function resolveWebPromptBudget(request, env) {
  const configured = env?.PATINA_WEB_PROMPT_BUDGET;
  const policy = BUDGET_POLICIES.has(configured) ? /** @type {'off'|'shadow'|'active'} */ (configured) : 'off';
  const classification = classifyWebPromptBudget(request);
  return {
    policy,
    selected: classification.selected,
    applied: policy === 'active' ? classification.selected : 'strict',
    reason: classification.reason,
  };
}
