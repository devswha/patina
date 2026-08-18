import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
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

const MINIMAX_MEDIA_HOSTS = new Set(['api.minimax.io', 'api.minimaxi.com']);
const MINIMAX_MAX_REQUEST_BYTES = 64 * 1024 * 1024;
const MEDIA_TYPES = {
  image: {
    maxBytes: 10 * 1024 * 1024,
    mimeByExtension: {
      '.gif': 'image/gif',
      '.jpeg': 'image/jpeg',
      '.jpg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
    },
  },
  video: {
    maxBytes: 50 * 1024 * 1024,
    mimeByExtension: {
      '.avi': 'video/avi',
      '.mkv': 'video/x-matroska',
      '.mov': 'video/mov',
      '.mp4': 'video/mp4',
    },
  },
};

function supportsMiniMaxMedia({ model, baseURL } = {}) {
  if (model !== 'MiniMax-M3') return false;
  try {
    return MINIMAX_MEDIA_HOSTS.has(new URL(baseURL).hostname);
  } catch {
    return false;
  }
}

function normalizeMiniMaxAttachment(value, kind) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`MiniMax-M3 ${kind} input must be a URL, data URL, or local file path`);
  }
  const source = value.trim();
  const limits = MEDIA_TYPES[kind];

  if (/^https?:\/\//i.test(source) || (kind === 'video' && source.startsWith('mm_file://'))) {
    return source;
  }

  if (source.startsWith('data:')) {
    const match = source.match(/^data:([^;,]+);base64,(.+)$/s);
    const allowedMimes = new Set(Object.values(limits.mimeByExtension));
    if (!match || !allowedMimes.has(match[1]) || Buffer.from(match[2], 'base64').byteLength > limits.maxBytes) {
      throw new Error(`MiniMax-M3 ${kind} data URL has an unsupported type or exceeds its size limit`);
    }
    return source;
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(source)) {
    throw new Error(`MiniMax-M3 ${kind} input uses an unsupported URL scheme`);
  }

  const mime = limits.mimeByExtension[extname(source).toLowerCase()];
  if (!mime) {
    throw new Error(`MiniMax-M3 ${kind} file has an unsupported extension`);
  }
  if (statSync(source).size > limits.maxBytes) {
    throw new Error(`MiniMax-M3 ${kind} file exceeds its size limit`);
  }
  return `data:${mime};base64,${readFileSync(source).toString('base64')}`;
}

function buildMiniMaxMessageContent(prompt, images = [], videos = []) {
  const content = [
    { type: 'text', text: prompt },
    ...images.map((image) => ({
      type: 'image_url',
      image_url: { url: normalizeMiniMaxAttachment(image, 'image') },
    })),
    ...videos.map((video) => ({
      type: 'video_url',
      video_url: { url: normalizeMiniMaxAttachment(video, 'video') },
    })),
  ];
  if (Buffer.byteLength(JSON.stringify(content)) > MINIMAX_MAX_REQUEST_BYTES) {
    throw new Error('MiniMax-M3 media request exceeds the 64 MB body limit');
  }
  return content;
}

const openaiHttp = {
  name: 'openai-http',
  supportsImages: supportsMiniMaxMedia,
  supportsVideos: supportsMiniMaxMedia,
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
    images,
    videos,
  }) => {
    const hasImages = Array.isArray(images) && images.length > 0;
    const hasVideos = Array.isArray(videos) && videos.length > 0;
    if ((hasImages || hasVideos) && !supportsMiniMaxMedia({ model, baseURL })) {
      throw new Error('HTTP media input is supported only for MiniMax-M3 on an official MiniMax endpoint');
    }
    const messageContent = hasImages || hasVideos
      ? buildMiniMaxMessageContent(prompt, images, videos)
      : undefined;
    return callLLM({ prompt, messageContent, apiKey, baseURL, model, signal, timeout, deadline, maxRetries, temperature, seed, onResponse });
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
      supportsImages: typeof b.supportsImages === 'boolean' ? b.supportsImages : false,
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

// Image-capable local backends in default OCR preference order.
const OCR_BACKEND_ORDER = ['claude-cli', 'gemini-cli', 'codex-cli'];

// Resolve the backend chain for OCR calls: keep the user's selected
// image-capable backends (their order), otherwise fall back to the available
// + authenticated capable CLIs.
export function selectOcrBackends(selectedBackends = [], { logger, model, baseURL } = {}) {
  const capable = selectedBackends.filter((backend) => {
    const support = REGISTRY[backend.name]?.supportsImages;
    return typeof support === 'function' ? support({ model, baseURL }) : Boolean(support);
  });
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
  videos,
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
          // Thread the shared chain deadline so a multi-retry HTTP backend's
          // total wall-clock stays bounded by the one budget, not per-attempt
          // (#527 H6). CLI backends ignore it.
          deadline,
          maxRetries: effectiveMaxRetries,
          temperature,
          seed,
          onResponse,
          logger,
          images,
          videos,
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
