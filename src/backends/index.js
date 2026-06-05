import { callLLM } from '../api.js';
import * as codexCli from './codex-cli.js';
import * as claudeCli from './claude-cli.js';
import * as geminiCli from './gemini-cli.js';
import * as kimiCli from './kimi-cli.js';
import { inspectHttpApiKeySource } from '../auth.js';
import { inputError } from '../errors.js';
import { DEFAULT_BEST_MODELS } from '../model-defaults.js';
import {
  DEFAULT_BACKEND_TIMEOUT_MS,
  describeBackendError,
  isRetryableBackendError,
} from './contract.js';

const openaiHttp = {
  name: 'openai-http',
  isAvailable: () => true,
  isAuthenticated: () => inspectHttpApiKeySource().ok,
  authHint: () => inspectHttpApiKeySource().detail,
  invoke: ({
    prompt,
    apiKey,
    baseURL,
    model,
    signal,
    timeout = DEFAULT_BACKEND_TIMEOUT_MS,
    temperature,
    seed,
    onResponse,
  }) =>
    callLLM({ prompt, apiKey, baseURL, model, signal, timeout, temperature, seed, onResponse }),
};

const REGISTRY = {
  'openai-http': openaiHttp,
  'codex-cli': codexCli,
  'claude-cli': claudeCli,
  'gemini-cli': geminiCli,
  'kimi-cli': kimiCli,
};

const BACKEND_META = {
  'openai-http': {
    kind: 'http',
    selectWith: 'default, --backend openai-http, --provider <name>',
    defaultModel: DEFAULT_BEST_MODELS.openai,
  },
  'codex-cli': {
    kind: 'local-cli',
    selectWith: '--backend codex-cli, --model codex-*',
    defaultModel: DEFAULT_BEST_MODELS.codexCli,
  },
  'claude-cli': {
    kind: 'local-cli',
    selectWith: '--backend claude-cli, --model claude-*',
    defaultModel: DEFAULT_BEST_MODELS.claudeCli,
  },
  'gemini-cli': {
    kind: 'local-cli',
    selectWith: '--backend gemini-cli, --model gemini-*',
    defaultModel: DEFAULT_BEST_MODELS.geminiCli,
  },
  'kimi-cli': {
    kind: 'local-cli',
    selectWith: '--backend kimi-cli, --model kimi-*',
    defaultModel: DEFAULT_BEST_MODELS.kimiCli,
  },
};

export function listBackends() {
  return Object.keys(REGISTRY).map((key) => {
    const b = REGISTRY[key];
    const meta = BACKEND_META[key] || { kind: 'unknown', selectWith: `--backend ${key}` };
    return {
      name: key,
      kind: meta.kind,
      selectWith: meta.selectWith,
      defaultModel: meta.defaultModel || null,
      available: b.isAvailable(),
      authenticated: b.isAuthenticated(),
      authHint: b.authHint(),
      loginCommand: b.loginCommand || null,
      installHint: b.installHint || null,
    };
  });
}

export function listBackendNames() {
  return Object.keys(REGISTRY);
}

export function selectBackend({ name, model, modelSource } = {}) {
  if (name) {
    const backend = resolveBackend(name);
    return { backend, autoSelected: false, reason: 'explicit' };
  }

  const useModelHeuristic = model && (modelSource === undefined || modelSource === 'flag');

  if (useModelHeuristic && /^codex(-|$)/i.test(model)) {
    return { backend: REGISTRY['codex-cli'], autoSelected: false, reason: 'model heuristic' };
  }
  if (useModelHeuristic && /^claude(-|$)/i.test(model)) {
    return { backend: REGISTRY['claude-cli'], autoSelected: false, reason: 'model heuristic' };
  }
  if (useModelHeuristic && /^gemini(-|$)/i.test(model)) {
    return { backend: REGISTRY['gemini-cli'], autoSelected: false, reason: 'model heuristic' };
  }
  if (useModelHeuristic && /^kimi(-|$)/i.test(model)) {
    return { backend: REGISTRY['kimi-cli'], autoSelected: false, reason: 'model heuristic' };
  }

  // No silent auto-fallback to any CLI backend. Sending arbitrary text to a
  // coding agent is a higher-trust action than calling a plain completion
  // API, so require an explicit `--backend <name>` (or `--model <prefix>`).
  // See issue #88.
  return { backend: REGISTRY['openai-http'], autoSelected: false, reason: 'default' };
}

export function selectBackendChain({ name, model, modelSource } = {}) {
  if (name) {
    const names = String(name)
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (names.length === 0) {
      throw inputError(
        '--backend expects at least one backend name',
        'The comma-separated backend list was empty.',
        `Available backends are: ${Object.keys(REGISTRY).join(', ')}.`
      );
    }
    return {
      backends: names.map(resolveBackend),
      autoSelected: false,
      reason: names.length > 1 ? 'explicit chain' : 'explicit',
    };
  }

  const selected = selectBackend({ model, modelSource });
  return {
    backends: [selected.backend],
    autoSelected: selected.autoSelected,
    reason: selected.reason,
  };
}

export async function invokeBackendChain({
  backends,
  prompt,
  apiKey,
  baseURL,
  model,
  modelSource,
  signal,
  timeout = DEFAULT_BACKEND_TIMEOUT_MS,
  temperature,
  seed,
  onResponse,
  logger,
}) {
  if (!Array.isArray(backends) || backends.length === 0) {
    throw inputError(
      'no backend selected',
      'patina could not resolve a backend to run.',
      'Pass --backend openai-http, codex-cli, claude-cli, gemini-cli, or kimi-cli.'
    );
  }

  let lastError = null;
  for (let attemptIndex = 0; attemptIndex < backends.length; attemptIndex++) {
    const backend = backends[attemptIndex];
    try {
      return await backend.invoke({ prompt, apiKey, baseURL, model, modelSource, signal, timeout, temperature, seed, onResponse, logger });
    } catch (err) {
      lastError = err;
      const next = backends[attemptIndex + 1];
      if (!next || !isRetryableBackendError(err, { attemptIndex, signal })) {
        throw err;
      }
      logger?.warn?.('backend.fallback', {
        message: `[patina] ${backend.name} failed with ${describeBackendError(err)}; falling back to ${next.name}`,
      });
    }
  }

  throw lastError || new Error('backend fallback chain failed without an error');
}

export function resolveBackend(name) {
  const backend = REGISTRY[name];
  if (!backend) {
    throw inputError(
      `Unknown backend: ${name}`,
      `Available backends are: ${Object.keys(REGISTRY).join(', ')}.`,
      'Run `patina --list-backends` to inspect local availability.'
    );
  }
  return backend;
}
