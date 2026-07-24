// @ts-check
import { HttpError, redactErrorText, isTemperatureRejectedError, markTemperatureRejected, modelRejectsTemperature } from './api.js';

const DEFAULT_TIMEOUT = 120000;
// Cap a single un-terminated SSE line so a malformed provider cannot grow the
// pending buffer without bound (memory-DoS guard on a public proxy boundary).
const MAX_SSE_BUFFER_BYTES = 1024 * 1024;

// Single source of truth for LLM-transport error redaction lives in api.js.
const redact = redactErrorText;
/**
 * Invoke optional metadata callbacks without allowing observers to affect a
 * provider request or its result.
 *
 * @param {Function|undefined} callback
 * @param {unknown} metadata
 * @returns {void}
 */
function dispatchMetadata(callback, metadata) {
  if (typeof callback !== 'function') return;
  try {
    Promise.resolve(callback(metadata)).catch(() => {});
  } catch {
    // Metadata observers are best-effort.
  }
}
/**
 * @param {object|null} usage
 * @returns {{ cachedReadTokens: unknown, cacheCreationTokens: unknown }|null}
 */
function extractCacheTokens(usage) {
  if (!usage) return null;
  const cachedRead = /** @type {any} */ (usage).prompt_tokens_details?.cached_tokens
    ?? /** @type {any} */ (usage).cache_read_input_tokens
    ?? null;
  const cacheCreation = /** @type {any} */ (usage).cache_creation_input_tokens ?? null;
  return cachedRead === null && cacheCreation === null
    ? null
    : { cachedReadTokens: cachedRead, cacheCreationTokens: cacheCreation };
}


/** @param {string} [message] */
function abortError(message = 'The operation was aborted') {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

/**
 * @param {AbortSignal|undefined} signal
 * @returns {void}
 */
function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError('External abort signal canceled LLM stream');
}

/**
 * @param {unknown} body
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
 * Call an OpenAI-compatible chat-completions endpoint as an SSE stream.
 *
 * @param {object} options
 * @param {string} options.prompt Prompt sent as the single user chat message.
 * @param {string} [options.apiKey] Bearer token for the provider.
 * @param {string} [options.baseURL] OpenAI-compatible API base URL.
 * @param {string} [options.model] Model id.
 * @param {number} [options.temperature] Sampling temperature.
 * @param {AbortSignal} [options.signal] External cancellation signal.
 * @param {number} [options.timeout] Per-request timeout in milliseconds.
 * @param {(chunk: string) => void} [options.onDelta] Called for every text delta.
 * @param {Function} [options.onResponse] Called with metadata from a successful provider response.
 * @param {Function} [options.onAttempt] Called once for every issued provider request.
 * @param {() => number} [options.now] Injectable clock retained for API symmetry.
 * @param {Function} [options.fetchImpl] Injectable fetch implementation.
 * @returns {Promise<{ text: string, finishReason?: string }>}
 */
export async function callLLMStream({
  prompt,
  apiKey,
  baseURL = 'https://api.openai.com/v1',
  model = 'gpt-5.5',
  temperature = 0.7,
  signal,
  timeout = DEFAULT_TIMEOUT,
  onDelta,
  onResponse,
  onAttempt,
  fetchImpl = globalThis.fetch,
  now: _now,
}) {
  void _now;
  throwIfAborted(signal);
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');

  const controller = new AbortController();
  let timer;
  let timedOut = false;
  let cleanupSignal = () => {};
  if (timeout && Number.isFinite(timeout) && timeout > 0) {
    timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
  }
  if (signal) {
    const onAbort = () => controller.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    cleanupSignal = () => signal.removeEventListener('abort', onAbort);
  }

  // Skip `temperature` up front when this process already saw the model
  // reject it (e.g. claude-sonnet-5) — avoids a guaranteed 400 round trip.
  const payload = {
    model,
    messages: [{ role: 'user', content: prompt }],
    stream: true,
    // Without include_usage, OpenAI-compatible streams omit the usage frame
    // entirely, so successful streamed attempts recorded usage: null — which
    // blinds cost observability and made PAY-B-COST billing evidence
    // unassemblable for the rewrite stage (2026-07-24). Verified supported by
    // the Anthropic compat endpoint; the #576 buffered fallback still covers
    // servers that ignore streaming options.
    stream_options: { include_usage: true },
  };
  if (!modelRejectsTemperature(model)) payload.temperature = temperature;

  const issue = () => fetchImpl(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: controller.signal,
  });
  let attemptsMade = 0;

  /**
   * @param {'initial'|'temperature_schema'} retryReason
   */
  const runAttempt = async (retryReason) => {
    const attempt = {
      attemptIndex: ++attemptsMade,
      requestedModel: model,
      effectiveModel: null,
      usage: null,
      retryReason,
      minimumChargeApplied: false,
      outcome: 'error',
    };
    try {
      const response = await issue();
      throwIfAborted(signal);
      if (!response.ok) {
        const body = typeof response.text === 'function' ? await response.text() : '';
        throw new HttpError(response.status, redact(body), response.headers?.get?.('retry-after'));
      }

      const decoder = new globalThis.TextDecoder();
      let buffer = '';
      let text = '';
      let finishReason;
      let streamDone = false;
      let rawResponse = null;
      const processLine = (line) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) return;
        const data = trimmed.slice(5).trim();
        if (!data) return;
        if (data === '[DONE]') { streamDone = true; return; }
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          return;
        }
        rawResponse = parsed;
        if (typeof parsed?.model === 'string' && attempt.effectiveModel === null) {
          attempt.effectiveModel = parsed.model;
        }
        if (parsed?.usage && typeof parsed.usage === 'object' && !Array.isArray(parsed.usage)) {
          attempt.usage = parsed.usage;
        }
        const choice = parsed?.choices?.[0];
        const chunk = choice?.delta?.content;
        if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason;
        if (typeof chunk === 'string' && chunk.length > 0) {
          text += chunk;
          dispatchMetadata(onDelta, chunk);
        }
      };

      for await (const chunk of streamChunks(response.body)) {
        throwIfAborted(signal);
        buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? '';
        // A single un-terminated line over the cap = malformed/abusive provider.
        if (buffer.length > MAX_SSE_BUFFER_BYTES) throw new Error('SSE response line exceeded the maximum buffer size');
        for (const line of lines) {
          processLine(line);
          if (streamDone) break;
        }
        if (streamDone) break;
      }
      if (!streamDone) {
        buffer += decoder.decode();
        if (buffer.trim()) processLine(buffer);
      }

      attempt.outcome = 'success';
      const result = finishReason ? { text, finishReason } : { text };
      return {
        result,
        metadata: {
          provider: 'openai-http',
          model: attempt.effectiveModel,
          effectiveModel: attempt.effectiveModel,
          requestedModel: model,
          temperature: 'temperature' in payload ? temperature : null,
          usage: attempt.usage,
          cacheTokens: extractCacheTokens(attempt.usage),
          rawResponse,
          content: text,
        },
      };
    } finally {
      dispatchMetadata(onAttempt, attempt);
    }
  };

  try {
    let success;
    try {
      success = await runAttempt('initial');
    } catch (err) {
      // `temperature` rejected for this model: drop the field and re-issue
      // once. Cannot loop — the field is gone from `payload` after this hit.
      if (!isTemperatureRejectedError(err) || !('temperature' in payload)) throw err;
      markTemperatureRejected(model);
      delete payload.temperature;
      success = await runAttempt('temperature_schema');
    }
    dispatchMetadata(onResponse, success.metadata);
    return success.result;
  } catch (err) {
    if (timedOut) throw abortError('LLM stream timed out');
    if (signal?.aborted || /** @type {any} */ (err)?.name === 'AbortError') throw abortError('External abort signal canceled LLM stream');
    throw err;
  } finally {
    clearTimeout(timer);
    cleanupSignal();
  }
}
