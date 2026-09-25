// @ts-check
import { HttpError, isTemperatureRejectedError, markTemperatureRejected, modelRejectsTemperature } from './api.js';
import { buildNativeBody, createNativeStreamParser, nativeAnthropicEnabled, nativeEndpoint, nativeHeaders } from './anthropic-native.js';
import {
  DEFAULT_TEMPERATURE,
  DEFAULT_TIMEOUT,
  SSE_DONE,
  abortError,
  bearerHeaders,
  chatCompletionsBody,
  dispatchMetadata,
  newAttemptRecord,
  parseSseData,
  readSseLines,
  responseMetadata,
} from './llm-transport.js';
import { DEFAULT_BEST_MODELS } from './model-defaults.js';

/**
 * @param {AbortSignal|undefined} signal
 * @returns {void}
 */
function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError('External abort signal canceled LLM stream');
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
 * @param {object} [options.extraBody] Optional provider-specific fields spread into the OpenAI-compat request body (protocol fields cannot be overridden; ignored on the native Anthropic path).
 * @param {Function} [options.fetchImpl] Injectable fetch implementation.
 * @returns {Promise<{ text: string, finishReason?: string }>}
 */
export async function callLLMStream({
  prompt,
  apiKey,
  baseURL = 'https://api.openai.com/v1',
  model = DEFAULT_BEST_MODELS.openai,
  temperature = DEFAULT_TEMPERATURE,
  signal,
  timeout = DEFAULT_TIMEOUT,
  onDelta,
  onResponse,
  onAttempt,
  extraBody,
  fetchImpl = globalThis.fetch,
}) {
  throwIfAborted(signal);

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

  // Native Anthropic branch (opt-in): the compat endpoint ignores prompt
  // caching, so the paid path issues /v1/messages with a cache_control prefix
  // block instead. Same single-user-message semantics, native SSE parsing.
  const native = nativeAnthropicEnabled({ baseURL });
  // Skip `temperature` up front when this process already saw the model
  // reject it (e.g. claude-sonnet-5) — avoids a guaranteed 400 round trip.
  // The body builder also drops a copy passed through extraBody, which would
  // replay the known-invalid request.
  const sendTemperature = modelRejectsTemperature(model) ? undefined : temperature;
  /** @type {Record<string, any>} */
  const payload = native
    ? buildNativeBody({ prompt, model, temperature: sendTemperature, stream: true })
    : chatCompletionsBody({ prompt, model, temperature: sendTemperature, extraBody, stream: true });

  const issue = () => fetchImpl(native ? nativeEndpoint(baseURL) : `${baseURL}/chat/completions`, {
    method: 'POST',
    headers: native ? nativeHeaders(apiKey) : bearerHeaders(apiKey),
    body: JSON.stringify(payload),
    signal: controller.signal,
  });
  let attemptsMade = 0;

  /**
   * @param {'initial'|'temperature_schema'} retryReason
   */
  const runAttempt = async (retryReason) => {
    const attempt = newAttemptRecord(++attemptsMade, model, retryReason);
    try {
      const response = await issue();
      throwIfAborted(signal);
      if (!response.ok) {
        const body = typeof response.text === 'function' ? await response.text() : '';
        throw new HttpError(response.status, body, response.headers?.get?.('retry-after'));
      }

      let text = '';
      let finishReason;
      let rawResponse = null;
      const nativeParser = native ? createNativeStreamParser() : null;
      await readSseLines(response.body, (line) => {
        if (nativeParser) {
          const delta = nativeParser.feed(line);
          const state = nativeParser.state();
          if (state.model && attempt.effectiveModel === null) attempt.effectiveModel = state.model;
          if (state.usage) attempt.usage = state.usage;
          if (state.stopReason) finishReason = state.stopReason;
          if (delta) {
            text += delta;
            dispatchMetadata(onDelta, delta);
          }
          return state.done;
        }
        const parsed = parseSseData(line);
        if (parsed === SSE_DONE) return true;
        if (parsed === undefined) return false;
        const event = /** @type {any} */ (parsed);
        rawResponse = event;
        if (typeof event?.model === 'string' && attempt.effectiveModel === null) {
          attempt.effectiveModel = event.model;
        }
        if (event?.usage && typeof event.usage === 'object' && !Array.isArray(event.usage)) {
          attempt.usage = event.usage;
        }
        const choice = event?.choices?.[0];
        const chunk = choice?.delta?.content;
        if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason;
        if (typeof chunk === 'string' && chunk.length > 0) {
          text += chunk;
          dispatchMetadata(onDelta, chunk);
        }
        return false;
      }, { beforeChunk: () => throwIfAborted(signal) });

      attempt.outcome = 'success';
      const result = finishReason ? { text, finishReason } : { text };
      return {
        result,
        metadata: responseMetadata({
          native,
          effectiveModel: attempt.effectiveModel,
          requestedModel: model,
          temperature: 'temperature' in payload ? temperature : null,
          usage: attempt.usage,
          rawResponse,
          content: text,
        }),
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
