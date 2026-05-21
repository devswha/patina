const FAMILY_ALIASES = [
  ['openai', /\b(openai|chatgpt|codex|gpt[-_ ]?\d|gpt\b|o[1345](?:[-_ ]|\b))/i],
  ['claude', /\b(anthropic|claude)\b/i],
  ['gemini', /\b(google|gemini)\b/i],
  ['llama', /\b(meta|llama)\b/i],
  ['mistral', /\b(mistral|mixtral)\b/i],
  ['qwen', /\b(qwen|通义)\b/i],
  ['deepseek', /\bdeepseek\b/i],
];

/**
 * Normalize a user/model/backend family label into a stable judge family.
 *
 * @param {string|null|undefined} value Raw provider, backend, model, or user label.
 * @returns {string|null} Normalized family, or null when unknown.
 * @example
 * normalizeModelFamily('gpt-4o') // 'openai'
 */
export function normalizeModelFamily(value) {
  if (!value) return null;
  const text = String(value).trim().toLowerCase();
  if (!text) return null;

  for (const [family, pattern] of FAMILY_ALIASES) {
    if (pattern.test(text)) return family;
  }
  return null;
}

/**
 * Infer the scoring judge family from the active backend/provider/model tuple.
 *
 * @param {object} context Judge context.
 * @param {string} [context.backendName] Backend name such as openai-http or codex-cli.
 * @param {string} [context.model] Model id.
 * @param {string} [context.providerName] Provider preset name.
 * @returns {string|null} Normalized family, or null when unknown.
 * @example
 * inferJudgeFamily({ backendName: 'gemini-cli' }) // 'gemini'
 */
export function inferJudgeFamily({ backendName, model, providerName } = {}) {
  const backendFamily = normalizeBackendFamily(backendName);
  if (backendFamily) return backendFamily;
  return normalizeModelFamily(model) || normalizeModelFamily(providerName);
}

function normalizeBackendFamily(backendName) {
  const backend = String(backendName || '').toLowerCase();
  if (backend === 'codex-cli') return 'openai';
  if (backend === 'claude-cli') return 'claude';
  if (backend === 'gemini-cli') return 'gemini';
  return null;
}

/**
 * Decide whether the judge and suspected generator are from the same family.
 *
 * @param {object} context Judge overlap context.
 * @param {string} [context.suspectedGenerator] User-supplied suspected generator family.
 * @param {string} [context.backendName] Active backend name.
 * @param {string} [context.model] Active model id.
 * @param {string} [context.providerName] Active provider preset name.
 * @returns {{warn: boolean, generatorFamily: string|null, judgeFamily: string|null}}
 * @example
 * shouldWarnJudgeOverlap({ suspectedGenerator: 'claude', backendName: 'claude-cli' }).warn // true
 */
export function shouldWarnJudgeOverlap({ suspectedGenerator, backendName, model, providerName } = {}) {
  const generatorFamily = normalizeModelFamily(suspectedGenerator);
  const judgeFamily = inferJudgeFamily({ backendName, model, providerName });
  return {
    warn: Boolean(generatorFamily && judgeFamily && generatorFamily === judgeFamily),
    generatorFamily,
    judgeFamily,
  };
}

/**
 * Emit a warning when a score judge appears to match the suspected generator family.
 *
 * @param {object} context Judge overlap context.
 * @param {string} [context.suspectedGenerator] User-supplied suspected generator family.
 * @param {string} [context.backendName] Active backend name.
 * @param {string} [context.model] Active model id.
 * @param {string} [context.providerName] Active provider preset name.
 * @param {object} [context.logger] Logger with warn(event, fields).
 * @returns {{warn: boolean, generatorFamily: string|null, judgeFamily: string|null}}
 * @example
 * maybeWarnJudgeOverlap({ suspectedGenerator: 'gpt', model: 'gpt-4o', logger })
 */
export function maybeWarnJudgeOverlap({ suspectedGenerator, backendName, model, providerName, logger } = {}) {
  const result = shouldWarnJudgeOverlap({ suspectedGenerator, backendName, model, providerName });
  if (result.warn) {
    logger?.warn?.('score.judge_overlap_warning', {
      message: `[patina] score judge family (${result.judgeFamily}) matches --suspected-generator; treat the score as a bias check, not an independent judge.`,
      generator_family: result.generatorFamily,
      judge_family: result.judgeFamily,
      backend: backendName ?? null,
      provider: providerName ?? null,
      model: model ?? null,
    });
  }
  return result;
}
