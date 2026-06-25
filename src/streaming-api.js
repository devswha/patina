// @ts-check
import { HttpError, redactErrorText } from './api.js';

const DEFAULT_TIMEOUT = 120000;
// Cap a single un-terminated SSE line so a malformed provider cannot grow the
// pending buffer without bound (memory-DoS guard on a public proxy boundary).
const MAX_SSE_BUFFER_BYTES = 1024 * 1024;

// Single source of truth for LLM-transport error redaction lives in api.js.
const redact = redactErrorText;

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
 * @param {Function} [options.fetchImpl] Injectable fetch implementation.
 * @param {() => number} [options.now] Injectable clock retained for API symmetry.
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

  try {
    const response = await fetchImpl(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature,
        stream: true,
      }),
      signal: controller.signal,
    });

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
    const processLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) return;
      const data = trimmed.slice(5).trim();
      if (!data) return;
      if (data === '[DONE]') { streamDone = true; return; } // terminal sentinel
      let parsed;
      try {
        parsed = JSON.parse(data);
      } catch {
        return;
      }
      const choice = parsed?.choices?.[0];
      const chunk = choice?.delta?.content;
      if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason;
      if (typeof chunk === 'string' && chunk.length > 0) {
        text += chunk;
        onDelta?.(chunk);
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
      if (streamDone) break; // stop reading after the [DONE] terminal sentinel
    }
    if (!streamDone) {
      buffer += decoder.decode();
      if (buffer.trim()) processLine(buffer);
    }

    return finishReason ? { text, finishReason } : { text };
  } catch (err) {
    if (timedOut) throw abortError('LLM stream timed out');
    if (signal?.aborted || /** @type {any} */ (err)?.name === 'AbortError') throw abortError('External abort signal canceled LLM stream');
    throw err;
  } finally {
    clearTimeout(timer);
    cleanupSignal();
  }
}
