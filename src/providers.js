// @ts-check
// Provider presets: shortcuts for common OpenAI-compatible endpoints.
// Each provider maps to a base URL + a recommended default model + the env
// variable users typically set to authenticate. Selecting a provider is
// equivalent to manually setting --base-url, --model, and the right key.
import { inputError } from './errors.js';

/**
 * Built-in OpenAI-compatible provider presets.
 *
 * @type {Record<string, {name: string, baseURL: string, apiKeyEnv: string, defaultModel: string, freeTier: boolean, note: string}>}
 * @example
 * const openaiBaseURL = PROVIDERS.openai.baseURL;
 */
export const PROVIDERS = {
  openai: {
    name: 'openai',
    baseURL: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o',
    freeTier: false,
    note: 'Paid. Default OpenAI Platform API.',
  },
  gemini: {
    name: 'gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKeyEnv: 'GEMINI_API_KEY',
    defaultModel: 'gemini-2.5-flash',
    freeTier: true,
    note: 'Free tier available. Get a key at https://aistudio.google.com/app/apikey',
  },
  groq: {
    name: 'groq',
    baseURL: 'https://api.groq.com/openai/v1',
    apiKeyEnv: 'GROQ_API_KEY',
    defaultModel: 'llama-3.3-70b-versatile',
    freeTier: true,
    note: 'Free tier with rate limits. Get a key at https://console.groq.com/keys',
  },
  together: {
    name: 'together',
    baseURL: 'https://api.together.xyz/v1',
    apiKeyEnv: 'TOGETHER_API_KEY',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo-Free',
    freeTier: true,
    note: 'Free models available (suffix "-Free"). Get a key at https://api.together.xyz/settings/api-keys',
  },
};

/**
 * Resolve a provider preset by name.
 *
 * @param {string|null|undefined} name Provider name; falsy returns null.
 * @returns {object|null} Provider preset or null.
 * @throws {PatinaCliError} When name is unknown.
 * @example
 * const provider = selectProvider('openai');
 */
export function selectProvider(name) {
  if (!name) return null;
  const provider = PROVIDERS[name];
  if (!provider) {
    throw inputError(
      `Unknown provider: ${name}`,
      `Available providers are: ${Object.keys(PROVIDERS).join(', ')}.`,
      'Run `patina --list-providers` to inspect provider presets.'
    );
  }
  return provider;
}

/**
 * Resolve effective API key, base URL, and model from explicit values, provider, and env.
 *
 * @param {object} options Provider resolution inputs.
 * @param {object|null} [options.provider] Provider preset from {@link selectProvider}.
 * @param {string} [options.apiKey] Explicit API key.
 * @param {string} [options.baseURL] Explicit base URL.
 * @param {string} [options.model] Explicit model id.
 * @returns {{apiKey: string|null, baseURL: string, model: string, apiKeySource: string|null, baseURLSource: string|null, modelSource: string|null}} Resolved provider config.
 * @throws {Error} Propagates validation, filesystem, network, or dependency failures when the underlying operation cannot complete.
 * @example
 * const resolved = resolveProviderConfig({ provider: selectProvider('openai') });
 */
export function resolveProviderConfig({ provider, apiKey, baseURL, model }) {
  // Explicit args win. Then provider preset. Then PATINA_* env vars.
  // Returns the resolved { apiKey, baseURL, model } and the source for each
  // (for debugging/auth status).
  const resolved = {
    apiKey: apiKey || null,
    baseURL: baseURL || null,
    model: model || null,
    apiKeySource: apiKey ? 'flag' : null,
    baseURLSource: baseURL ? 'flag' : null,
    modelSource: model ? 'flag' : null,
  };

  if (provider) {
    if (!resolved.apiKey) {
      const fromEnv = process.env[provider.apiKeyEnv];
      if (fromEnv) {
        resolved.apiKey = fromEnv;
        resolved.apiKeySource = `env:${provider.apiKeyEnv}`;
      }
    }
    if (!resolved.baseURL) {
      resolved.baseURL = provider.baseURL;
      resolved.baseURLSource = `provider:${provider.name}`;
    }
    if (!resolved.model) {
      resolved.model = provider.defaultModel;
      resolved.modelSource = `provider:${provider.name}`;
    }
  }

  if (!resolved.apiKey && process.env.PATINA_API_KEY) {
    resolved.apiKey = process.env.PATINA_API_KEY;
    resolved.apiKeySource = 'env:PATINA_API_KEY';
  }
  if (!resolved.baseURL) {
    resolved.baseURL = process.env.PATINA_API_BASE || 'https://api.openai.com/v1';
    resolved.baseURLSource = process.env.PATINA_API_BASE ? 'env:PATINA_API_BASE' : 'default';
  }
  if (!resolved.model) {
    resolved.model = process.env.PATINA_MODEL || 'gpt-4o';
    resolved.modelSource = process.env.PATINA_MODEL ? 'env:PATINA_MODEL' : 'default';
  }

  return resolved;
}
