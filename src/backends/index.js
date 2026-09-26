import { callLLM } from '../api.js';
import * as codexCli from './codex-cli.js';
import * as claudeCli from './claude-cli.js';
import * as geminiCli from './gemini-cli.js';
import * as agyCli from './agy-cli.js';
import { inspectHttpApiKeySource } from '../auth.js';
import { inputError } from '../errors.js';
import { DEFAULT_BEST_MODELS } from '../model-defaults.js';
import {
  DEFAULT_BACKEND_TIMEOUT_MS,
  describeBackendError,
  getBackendSafety,
  isRetryableBackendError,
  resolveBackendMaxConcurrency,
  resolveBackendMaxRetries,
  withBackendConcurrencySlot,
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
    deadline,
    maxRetries,
    temperature,
    seed,
    onResponse,
  }) => callLLM({ prompt, apiKey, baseURL, model, signal, timeout, deadline, maxRetries, temperature, seed, onResponse }),
};

const REGISTRY = {
  'openai-http': openaiHttp,
  'codex-cli': codexCli,
  'claude-cli': claudeCli,
  'gemini-cli': geminiCli,
  'agy-cli': agyCli,
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
  'agy-cli': {
    kind: 'local-cli',
    // Antigravity serves gemini-*, claude-* and gpt-oss-* ids, so no model
    // prefix can route here unambiguously; selection is explicit only.
    selectWith: '--backend agy-cli, --model agy',
    defaultModel: DEFAULT_BEST_MODELS.agyCli,
  },
};

export function listBackends() {
  return Object.keys(REGISTRY).map((key) => {
    const b = REGISTRY[key];
    const meta = BACKEND_META[key];
    const safety = getBackendSafety(key);
    return {
      name: key,
      kind: meta.kind,
      selectWith: meta.selectWith,
      defaultModel: meta.defaultModel,
      safety,
      maxConcurrency: safety.maxConcurrency,
      maxRetries: safety.maxRetries,
      promptMode: safety.promptMode,
      agentRuntime: safety.agentRuntime,
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
    return { backend, reason: 'explicit' };
  }

  const useModelHeuristic = model && (modelSource === undefined || modelSource === 'flag');

  if (useModelHeuristic && /^codex(-|$)/i.test(model)) {
    return { backend: REGISTRY['codex-cli'], reason: 'model heuristic' };
  }
  if (useModelHeuristic && /^claude(-|$)/i.test(model)) {
    return { backend: REGISTRY['claude-cli'], reason: 'model heuristic' };
  }
  if (useModelHeuristic && /^gemini(-|$)/i.test(model)) {
    return { backend: REGISTRY['gemini-cli'], reason: 'model heuristic' };
  }
  if (useModelHeuristic && /^agy$/i.test(model)) {
    return { backend: REGISTRY['agy-cli'], reason: 'model heuristic' };
  }

  // No silent auto-fallback to any CLI backend. Sending arbitrary text to a
  // coding agent is a higher-trust action than calling a plain completion
  // API, so require an explicit `--backend <name>` (or `--model <prefix>`).
  // See issue #88.
  return { backend: REGISTRY['openai-http'], reason: 'default' };
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
      reason: names.length > 1 ? 'explicit chain' : 'explicit',
    };
  }

  const selected = selectBackend({ model, modelSource });
  return {
    backends: [selected.backend],
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
  maxConcurrency,
  maxRetries,
  temperature,
  seed,
  onResponse,
  logger,
}) {
  if (!Array.isArray(backends) || backends.length === 0) {
    throw inputError(
      'no backend selected',
      'patina could not resolve a backend to run.',
      'Pass --backend openai-http, codex-cli, claude-cli, gemini-cli, or agy-cli.'
    );
  }

  // One shared deadline across both phases (slot-wait + run budget) so the
  // combined wall-clock can never reach 2x `timeout` under cap saturation
  // (#506 defect 1). withBackendConcurrencySlot hands the run phase whatever
  // time remains after the slot wait.
  const deadline = Number.isFinite(timeout) ? Date.now() + timeout : Infinity;
  for (let attemptIndex = 0; attemptIndex < backends.length; attemptIndex++) {
    const backend = backends[attemptIndex];
    const effectiveMaxConcurrency = resolveBackendMaxConcurrency(backend.name, maxConcurrency);
    const effectiveMaxRetries = resolveBackendMaxRetries(backend.name, maxRetries);
    try {
      return await withBackendConcurrencySlot({
        backendName: backend.name,
        maxConcurrency: effectiveMaxConcurrency,
        signal,
        timeout,
        deadline,
        fn: (remainingTimeout) => backend.invoke({
          prompt,
          apiKey,
          baseURL,
          model,
          modelSource,
          signal,
          timeout: remainingTimeout,
          // Thread the shared chain deadline so a multi-retry HTTP backend's
          // total wall-clock stays bounded by the one budget, not per-attempt
          // (#527 H6). CLI backends ignore it.
          deadline,
          maxRetries: effectiveMaxRetries,
          temperature,
          seed,
          onResponse,
          logger,
        }),
      });
    } catch (err) {
      const next = backends[attemptIndex + 1];
      if (!next || !isRetryableBackendError(err, { signal })) {
        throw err;
      }
      logger?.warn?.('backend.fallback', {
        message: `[patina] ${backend.name} failed with ${describeBackendError(err)}; falling back to ${next.name}`,
      });
    }
  }
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
