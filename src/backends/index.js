import { callLLM } from '../api.js';
import * as codexCli from './codex-cli.js';
import * as claudeCli from './claude-cli.js';
import * as geminiCli from './gemini-cli.js';
import * as patinaHosted from './patina-hosted.js';
import { inspectHttpApiKeySource } from '../auth.js';
import { inputError } from '../errors.js';
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
    cache,
  }) =>
    callLLM({ prompt, apiKey, baseURL, model, signal, timeout, temperature, seed, onResponse, cache }),
};

const REGISTRY = {
  'openai-http': openaiHttp,
  'codex-cli': codexCli,
  'claude-cli': claudeCli,
  'gemini-cli': geminiCli,
  // Opt-in hosted backend. Registered so `--backend patina-hosted` resolves and
  // it shows up in `--list-backends`, but intentionally absent from selectBackend's
  // auto/heuristic paths: it never auto-selects (issue #88). Misconfiguration is
  // an explicit error, not a silent baseline fallback.
  'patina-hosted': patinaHosted,
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
    const backend = resolveBackend(name);
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

export function selectBackendChain({ name, model } = {}) {
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

  const selected = selectBackend({ model });
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
  cache,
  logger,
}) {
  if (!Array.isArray(backends) || backends.length === 0) {
    throw inputError(
      'no backend selected',
      'patina could not resolve a backend to run.',
      'Pass --backend openai-http, codex-cli, claude-cli, or gemini-cli.'
    );
  }

  let lastError = null;
  for (let attemptIndex = 0; attemptIndex < backends.length; attemptIndex++) {
    const backend = backends[attemptIndex];
    try {
      return await backend.invoke({ prompt, apiKey, baseURL, model, modelSource, signal, timeout, temperature, seed, onResponse, cache, logger });
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
