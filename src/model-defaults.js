// @ts-check

/**
 * Default to the strongest stable model ids that patina documents for each
 * backend family. These values are intentionally centralized so releases can
 * refresh "latest best" defaults without touching backend process plumbing.
 */
export const DEFAULT_BEST_MODELS = Object.freeze({
  openai: 'gpt-5.5',
  codexCli: 'gpt-5.5',
  claudeCli: 'claude-sonnet-4-6',
  geminiCli: 'gemini-2.5-pro',
  kimiCli: 'kimi-code/kimi-for-coding',
});

const BACKEND_MODEL_KEYS = Object.freeze({
  'codex-cli': 'codexCli',
  'claude-cli': 'claudeCli',
  'gemini-cli': 'geminiCli',
  'kimi-cli': 'kimiCli',
});

const BACKEND_SELECTOR_ALIASES = Object.freeze({
  'codex-cli': 'codex',
  'claude-cli': 'claude',
  'gemini-cli': 'gemini',
  'kimi-cli': 'kimi',
});

// Family prefix per local backend, mirroring the selectBackend model heuristic
// in backends/index.js. Used to drop a model that belongs to a different
// backend/API family before it reaches an incompatible local CLI.
const BACKEND_MODEL_FAMILY = Object.freeze({
  // Codex CLI uses OpenAI model ids; accept both codex-* selector ids and gpt/o
  // family ids so explicit newer OpenAI models still pass through.
  'codex-cli': /^(?:codex|gpt|o\d)(-|$|\.)/i,
  'claude-cli': /^claude(-|$)/i,
  'gemini-cli': /^gemini(-|$)/i,
  'kimi-cli': /^kimi(-|$)/i,
});

/**
 * Resolve the model id a local CLI backend should receive.
 *
 * `resolveProviderConfig` always supplies an HTTP default model when the user
 * did not choose one. Local CLIs need their own family-specific defaults, so
 * `modelSource: "default"` is treated as unset. Exact selector aliases such as
 * `--model codex` still route to the backend without becoming invalid model ids.
 *
 * @param {object} options
 * @param {string} options.backendName Local backend name.
 * @param {string|null|undefined} [options.model] Resolved model value.
 * @param {string|null|undefined} [options.modelSource] Source label from provider resolution.
 * @returns {string|null} Effective local CLI model id.
 */
export function resolveLocalCliModel({ backendName, model, modelSource }) {
  const key = BACKEND_MODEL_KEYS[backendName];
  if (!key) return model || null;

  const defaultModel = DEFAULT_BEST_MODELS[key];
  if (!model || modelSource === 'default') return defaultModel;

  const alias = BACKEND_SELECTOR_ALIASES[backendName];
  if (alias && String(model).toLowerCase() === alias) return defaultModel;

  // A model whose family does not match this backend belongs to a different
  // backend/API family (for example PATINA_MODEL=gpt-5.5 or a provider preset
  // paired with `--backend claude-cli`). Forwarding the foreign id would fail
  // this leg on an unknown model; use the backend's own default so env/provider
  // configuration and explicit fallback chains remain usable (#524).
  const family = BACKEND_MODEL_FAMILY[backendName];
  if (family && !family.test(String(model))) {
    return defaultModel;
  }

  return model;
}
