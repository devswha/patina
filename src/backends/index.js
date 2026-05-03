import { callLLM } from '../api.js';
import * as codexCli from './codex-cli.js';

const openaiHttp = {
  name: 'openai-http',
  isAvailable: () => true,
  isAuthenticated: () => Boolean(process.env.PATINA_API_KEY),
  authHint: () =>
    'Set PATINA_API_KEY (or pass --api-key). Get a key at https://platform.openai.com/api-keys.',
  invoke: ({ prompt, apiKey, baseURL, model, timeout }) =>
    callLLM({ prompt, apiKey, baseURL, model, timeout }),
};

const REGISTRY = {
  'openai-http': openaiHttp,
  'codex-cli': codexCli,
};

export function listBackends() {
  return Object.keys(REGISTRY).map((key) => {
    const b = REGISTRY[key];
    return {
      name: key,
      available: b.isAvailable(),
      authenticated: b.isAuthenticated(),
      authHint: b.authHint(),
    };
  });
}

export function selectBackend({ name, model, hasApiKey } = {}) {
  if (name) {
    const backend = REGISTRY[name];
    if (!backend) {
      throw new Error(`Unknown backend: ${name}. Available: ${Object.keys(REGISTRY).join(', ')}`);
    }
    return { backend, autoSelected: false, reason: 'explicit' };
  }

  if (model && /^codex(-|$)/i.test(model)) {
    return { backend: REGISTRY['codex-cli'], autoSelected: false, reason: 'model heuristic' };
  }

  // Auto-fallback: no API key, but codex is installed and authenticated
  const noKey = hasApiKey === false || (hasApiKey === undefined && !process.env.PATINA_API_KEY);
  if (noKey && REGISTRY['codex-cli'].isAvailable() && REGISTRY['codex-cli'].isAuthenticated()) {
    return { backend: REGISTRY['codex-cli'], autoSelected: true, reason: 'no API key; codex authenticated' };
  }

  return { backend: REGISTRY['openai-http'], autoSelected: false, reason: 'default' };
}
