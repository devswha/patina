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
    maxRetries,
    temperature,
    seed,
    onResponse,
    images,
  }) => {
    if (Array.isArray(images) && images.length > 0) {
      // By design, not a gap: OCR stays on local CLI backends so image bytes
      // never ride an HTTP API call.
      throw new Error('openai-http backend: image input is not supported — use codex-cli, claude-cli, or gemini-cli for OCR');
    }
    return callLLM({ prompt, apiKey, baseURL, model, signal, timeout, maxRetries, temperature, seed, onResponse });
  },
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
    const safety = getBackendSafety(key);
    return {
      name: key,
      kind: meta.kind,
      selectWith: meta.selectWith,
      defaultModel: meta.defaultModel || null,
      safety,
      maxConcurrency: safety.maxConcurrency,
      maxRetries: safety.maxRetries,
      promptMode: safety.promptMode,
      agentRuntime: safety.agentRuntime,
      available: b.isAvailable(),
      authenticated: b.isAuthenticated(),
      supportsImages: Boolean(b.supportsImages),
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

// Image-capable backends in default OCR preference order: claude verbatim
// Korean fidelity (measured), gemini near-verbatim and slightly faster,
// codex native -i attachment. kimi-cli and openai-http reject images.
const OCR_BACKEND_ORDER = ['claude-cli', 'gemini-cli', 'codex-cli'];

// Resolve the backend chain for OCR calls: keep the user's selected
// image-capable backends (their order), otherwise fall back to the available
// + authenticated capable CLIs.
export function selectOcrBackends(selectedBackends = [], { logger } = {}) {
  const capable = selectedBackends.filter((backend) => REGISTRY[backend.name]?.supportsImages);
  if (capable.length > 0) return capable;
  const fallback = OCR_BACKEND_ORDER
    .map((name) => REGISTRY[name])
    .filter((backend) => backend.isAvailable() && backend.isAuthenticated());
  if (fallback.length > 0) {
    // The selected backend cannot read images, so OCR falls back to an
    // image-capable CLI the user did not name. Surface it at warn level
    // (issue #88: agent-CLI use should be visible) — only --quiet hides it.
    logger?.warn?.('ocr.backend_fallback', {
      message: `[patina] --ocr will try ${fallback.map((b) => b.name).join(' → ')} for image text (the selected backend cannot read images).`,
    });
  }
  return fallback;
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
  images,
}) {
  if (!Array.isArray(backends) || backends.length === 0) {
    throw inputError(
      'no backend selected',
      'patina could not resolve a backend to run.',
      'Pass --backend openai-http, codex-cli, claude-cli, gemini-cli, or kimi-cli.'
    );
  }

  let lastError = null;
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
          maxRetries: effectiveMaxRetries,
          temperature,
          seed,
          onResponse,
          logger,
          images,
        }),
      });
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
