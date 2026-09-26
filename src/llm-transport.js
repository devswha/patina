// @ts-check
// Request/response pieces shared by the buffered (api.js) and streaming
// (streaming-api.js) OpenAI-compatible clients. A leaf module: it imports
// nothing, so backends/contract.js can share the retry default without
// pulling in the prompt/scoring graph.

export const DEFAULT_TIMEOUT = 120000;
export const DEFAULT_MAX_RETRIES = 2;
/**
 * Default sampling temperature for OpenAI-compatible chat completion calls.
 *
 * @type {number}
 */
export const DEFAULT_TEMPERATURE = 0.7;

// Cap a single un-terminated SSE line so a malformed provider cannot grow the
// pending buffer without bound (memory-DoS guard on a public proxy boundary).
const MAX_SSE_BUFFER_BYTES = 1024 * 1024;

/** Returned by {@link parseSseData} for the OpenAI `data: [DONE]` sentinel. */
export const SSE_DONE = Symbol('sse-done');

/**
 * @param {string} [message]
 * @returns {Error}
 */
export function abortError(message = 'The operation was aborted') {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

/**
 * Invoke an optional metadata callback without allowing observer code to
 * affect a paid provider request or its result.
 *
 * @param {Function|undefined} callback
 * @param {unknown} metadata
 * @returns {void}
 */
export function dispatchMetadata(callback, metadata) {
  if (typeof callback !== 'function') return;
  try {
    Promise.resolve(callback(metadata)).catch(() => {});
  } catch {
    // Metadata observers are best-effort and must not affect provider calls.
  }
}

/**
 * Build an OpenAI-compatible chat-completions body for one user message.
 *
 * @param {object} options
 * @param {string} options.prompt
 * @param {string} options.model
 * @param {unknown} options.temperature `undefined` omits the field, including a copy passed through extraBody.
 * @param {unknown} [options.extraBody] Provider-specific fields; protocol fields set here win.
 * @param {boolean} [options.stream=false] Request SSE with a trailing usage frame.
 * @returns {Record<string, any>}
 */
export function chatCompletionsBody({ prompt, model, temperature, extraBody, stream = false }) {
  /** @type {Record<string, any>} */
  const body = {
    // Spread first so callers can never clobber the protocol fields below.
    ...(extraBody && typeof extraBody === 'object' && !Array.isArray(extraBody) ? extraBody : {}),
    model,
    messages: [{ role: 'user', content: prompt }],
    // Without include_usage, OpenAI-compatible streams omit the usage frame,
    // so streamed attempts would report no usage.
    ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
  };
  if (temperature !== undefined) body.temperature = temperature;
  else delete body.temperature;
  return body;
}

/**
 * @param {string} apiKey
 * @returns {Record<string, string>} Bearer-auth JSON headers.
 */
export function bearerHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

/**
 * The per-request record handed to `onAttempt` observers.
 *
 * @param {number} attemptIndex One-based.
 * @param {string} requestedModel
 * @param {string} retryReason
 */
export function newAttemptRecord(attemptIndex, requestedModel, retryReason) {
  return {
    attemptIndex,
    requestedModel,
    effectiveModel: null,
    usage: null,
    retryReason,
    minimumChargeApplied: false,
    outcome: 'error',
  };
}

/**
 * Metadata handed to `onResponse` for a successful provider response.
 *
 * @param {object} fields
 * @param {boolean} fields.native Whether the native Anthropic path served the request.
 * @param {string|null} fields.effectiveModel
 * @param {string} fields.requestedModel
 * @param {unknown} fields.temperature The temperature sent, or null when omitted.
 * @param {unknown} [fields.seed] Included in the metadata only when the key is passed.
 * @param {object|null} fields.usage
 * @param {unknown} fields.rawResponse
 * @param {string} fields.content
 */
export function responseMetadata(fields) {
  const { native, effectiveModel, requestedModel, temperature, usage, rawResponse, content } = fields;
  return {
    provider: native ? 'anthropic-native' : 'openai-http',
    model: effectiveModel,
    effectiveModel,
    requestedModel,
    temperature,
    ...('seed' in fields ? { seed: fields.seed } : {}),
    usage,
    cacheTokens: extractCacheTokens(usage),
    rawResponse,
    content,
  };
}

// Surface provider prompt-cache token counts when present, normalized across
// OpenAI-compatible (usage.prompt_tokens_details.cached_tokens) and Anthropic-
// style (usage.cache_read_input_tokens / cache_creation_input_tokens) shapes.
// Returns null when the provider exposes no cache usage.
/**
 * @param {any} usage
 * @returns {{ cachedReadTokens: unknown, cacheCreationTokens: unknown }|null}
 */
function extractCacheTokens(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const cachedRead = usage.prompt_tokens_details?.cached_tokens ?? usage.cache_read_input_tokens ?? null;
  const cacheCreation = usage.cache_creation_input_tokens ?? null;
  if (cachedRead == null && cacheCreation == null) return null;
  return { cachedReadTokens: cachedRead, cacheCreationTokens: cacheCreation };
}

/**
 * @param {unknown} body Fetch response body (web ReadableStream or async iterable).
 * @returns {AsyncIterable<Uint8Array|string>}
 */
function streamChunks(body) {
  if (!body) throw new Error('Streaming response body is empty');
  if (typeof /** @type {any} */ (body).getReader === 'function') {
    return {
      async *[Symbol.asyncIterator]() {
        const reader = /** @type {ReadableStream<Uint8Array>} */ (body).getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value !== undefined) yield value;
          }
        } finally {
          reader.releaseLock?.();
        }
      },
    };
  }
  if (typeof /** @type {any} */ (body)[Symbol.asyncIterator] === 'function') {
    return /** @type {AsyncIterable<Uint8Array|string>} */ (body);
  }
  throw new Error('Streaming response body is not readable');
}

/**
 * Feed each line of an SSE response body to `onLine` until it returns true
 * (the stream's terminal event) or the body ends. A final un-terminated line
 * is delivered only when no terminal event was seen.
 *
 * @param {unknown} body Fetch response body.
 * @param {(line: string) => boolean} onLine Returns true to stop reading.
 * @param {{ beforeChunk?: () => void }} [hooks] `beforeChunk` runs before each chunk is decoded.
 * @returns {Promise<void>}
 */
export async function readSseLines(body, onLine, { beforeChunk } = {}) {
  const decoder = new globalThis.TextDecoder();
  let buffer = '';
  for await (const chunk of streamChunks(body)) {
    beforeChunk?.();
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    if (buffer.length > MAX_SSE_BUFFER_BYTES) throw new Error('SSE response line exceeded the maximum buffer size');
    for (const line of lines) {
      if (onLine(line)) return;
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) onLine(buffer);
}

/**
 * Parse one OpenAI-compatible SSE line.
 *
 * @param {string} line
 * @returns {unknown} The parsed `data:` JSON, {@link SSE_DONE} for `[DONE]`,
 *   or undefined for comments, blank data, other fields, and malformed JSON.
 */
export function parseSseData(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return undefined;
  const data = trimmed.slice(5).trim();
  if (!data) return undefined;
  if (data === '[DONE]') return SSE_DONE;
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}
