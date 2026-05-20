import { callLLM } from '../api.js';
import * as codexCli from './codex-cli.js';
import * as claudeCli from './claude-cli.js';
import * as geminiCli from './gemini-cli.js';
import { inspectHttpApiKeySource } from '../auth.js';
import { inputError } from '../errors.js';

const openaiHttp = {
  name: 'openai-http',
  isAvailable: () => true,
  isAuthenticated: () => inspectHttpApiKeySource().ok,
  authHint: () => inspectHttpApiKeySource().detail,
  invoke: ({ prompt, apiKey, baseURL, model, signal, timeout }) =>
    callLLM({ prompt, apiKey, baseURL, model, signal, timeout }),
};

const REGISTRY = {
  'openai-http': openaiHttp,
  'codex-cli': codexCli,
  'claude-cli': claudeCli,
  'gemini-cli': geminiCli,
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

export function listBackendNames() {
  return Object.keys(REGISTRY);
}

export function selectBackend({ name, model } = {}) {
  if (name) {
    const backend = REGISTRY[name];
    if (!backend) {
      throw inputError(
        `Unknown backend: ${name}`,
        `Available backends are: ${Object.keys(REGISTRY).join(', ')}.`,
        'Run `patina --list-backends` to inspect local availability.'
      );
    }
    return { backend, autoSelected: false, reason: 'explicit' };
  }

  if (model && /^codex(-|$)/i.test(model)) {
    return { backend: REGISTRY['codex-cli'], autoSelected: false, reason: 'model heuristic' };
  }
  if (model && /^claude(-|$)/i.test(model)) {
    return { backend: REGISTRY['claude-cli'], autoSelected: false, reason: 'model heuristic' };
  }
  if (model && /^gemini(-|$)/i.test(model)) {
    return { backend: REGISTRY['gemini-cli'], autoSelected: false, reason: 'model heuristic' };
  }

  // No silent auto-fallback to any CLI backend. Sending arbitrary text to a
  // coding agent is a higher-trust action than calling a plain completion
  // API, so require an explicit `--backend <name>` (or `--model <prefix>`).
  // See issue #88.
  return { backend: REGISTRY['openai-http'], autoSelected: false, reason: 'default' };
}
