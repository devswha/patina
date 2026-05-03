import { callLLM } from '../api.js';
import * as codexCli from './codex-cli.js';

const openaiHttp = {
  name: 'openai-http',
  isAvailable: () => true,
  invoke: ({ prompt, apiKey, baseURL, model, timeout }) =>
    callLLM({ prompt, apiKey, baseURL, model, timeout }),
};

const REGISTRY = {
  'openai-http': openaiHttp,
  'codex-cli': codexCli,
};

export function listBackends() {
  return Object.keys(REGISTRY).map((key) => ({
    name: key,
    available: REGISTRY[key].isAvailable(),
  }));
}

export function selectBackend({ name, model } = {}) {
  if (name) {
    const backend = REGISTRY[name];
    if (!backend) {
      throw new Error(`Unknown backend: ${name}. Available: ${Object.keys(REGISTRY).join(', ')}`);
    }
    return backend;
  }

  if (model && /^codex(-|$)/i.test(model)) {
    return REGISTRY['codex-cli'];
  }

  return REGISTRY['openai-http'];
}
