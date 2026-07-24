// @ts-check
// Native Anthropic Messages API adapter (opt-in via PATINA_ANTHROPIC_NATIVE_CACHE).
//
// Why it exists: the OpenAI-compatibility endpoint silently ignores prompt
// caching in every form (verified empirically 2026-07-24: cache_control on
// content blocks AND at the top level both produce full-price prompt_tokens
// on repeat calls). Caching is the difference between ~$0.16 and ~$0.07 per
// pro rewrite, so the paid path needs the first-party /v1/messages API.
//
// Design constraints:
// - Zero caller-surface change: api.js/streaming-api.js branch internally.
// - Zero prompt-semantics change: the prompt stays ONE user message; the
//   static prefix and dynamic tail become two text blocks of the same message,
//   with cache_control on the prefix block only.
// - Usage objects keep Anthropic's native field names (input_tokens,
//   output_tokens, cache_read_input_tokens, cache_creation_input_tokens):
//   the cache-token extractor and the G002 usage adapter accept that shape.
import { splitPromptForCaching } from './prompt-builder.js';

const ANTHROPIC_VERSION = '2023-06-01';
const DEFAULT_MAX_TOKENS = 8192;

/**
 * @param {object} options
 * @param {string} [options.baseURL]
 * @param {object} [options.env]
 * @returns {boolean} Whether the native adapter should handle this request.
 */
export function nativeAnthropicEnabled({ baseURL, env = process.env }) {
  const flag = env?.PATINA_ANTHROPIC_NATIVE_CACHE;
  if (flag !== '1' && flag !== 'true') return false;
  try {
    return new URL(String(baseURL)).hostname.toLowerCase() === 'api.anthropic.com';
  } catch {
    return false;
  }
}

/**
 * @param {string|null|undefined} baseURL
 * @returns {string} The native Messages endpoint for this base URL.
 */
export function nativeEndpoint(baseURL) {
  return `${String(baseURL).replace(/\/$/, '')}/messages`;
}

/**
 * @param {string} apiKey
 * @returns {Record<string, string>} Native auth headers.
 */
export function nativeHeaders(apiKey) {
  return {
    'x-api-key': apiKey,
    'anthropic-version': ANTHROPIC_VERSION,
    'Content-Type': 'application/json',
  };
}

/**
 * Build a /v1/messages body from a flat prompt.
 *
 * @param {object} options
 * @param {string} options.prompt
 * @param {string} options.model
 * @param {number} [options.temperature] Sent only when within Anthropic's 0..1 range.
 * @param {number} [options.maxTokens]
 * @param {boolean} [options.stream]
 * @returns {object}
 */
export function buildNativeBody({ prompt, model, temperature, maxTokens = DEFAULT_MAX_TOKENS, stream = false }) {
  const { prefix, tail } = splitPromptForCaching(prompt);
  const content = prefix
    ? [
        { type: 'text', text: prefix, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: tail },
      ]
    : tail;
  const body = {
    model,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content }],
  };
  if (typeof temperature === 'number' && Number.isFinite(temperature) && temperature >= 0 && temperature <= 1) {
    body.temperature = temperature;
  }
  if (stream) body.stream = true;
  return body;
}

/**
 * Normalize a buffered /v1/messages response into the OpenAI-ish shape the
 * existing client loop consumes (model, usage, choices[0].message.content).
 *
 * @param {any} data
 * @returns {{ model: string|null, usage: object|null, choices: Array<{message: {content: string|null}, finish_reason: string|null}> }}
 */
export function normalizeNativeResponse(data) {
  const content = Array.isArray(data?.content)
    ? data.content.filter((block) => block?.type === 'text' && typeof block.text === 'string').map((block) => block.text).join('')
    : null;
  return {
    model: typeof data?.model === 'string' ? data.model : null,
    usage: data?.usage && typeof data.usage === 'object' && !Array.isArray(data.usage) ? data.usage : null,
    choices: [{ message: { content: content || null }, finish_reason: data?.stop_reason ?? null }],
  };
}

/**
 * Incremental parser for the native Messages SSE stream. Feed decoded lines;
 * it surfaces text deltas and accumulates model/usage/stop_reason. Anthropic
 * splits usage across message_start (input side) and message_delta (output
 * side); both merge into one usage object.
 *
 * @returns {{ feed: (line: string) => string|null, state: () => { model: string|null, usage: object|null, stopReason: string|null, done: boolean } }}
 */
export function createNativeStreamParser() {
  let model = null;
  /** @type {object|null} */
  let usage = null;
  let stopReason = null;
  let done = false;
  const mergeUsage = (value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    usage = { ...(usage ?? {}), ...value };
  };
  return {
    feed(line) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) return null;
      const payload = trimmed.slice(5).trim();
      if (!payload) return null;
      let parsed;
      try {
        parsed = JSON.parse(payload);
      } catch {
        return null;
      }
      switch (parsed?.type) {
        case 'message_start':
          if (typeof parsed.message?.model === 'string') model = parsed.message.model;
          mergeUsage(parsed.message?.usage);
          return null;
        case 'content_block_delta':
          return parsed.delta?.type === 'text_delta' && typeof parsed.delta.text === 'string' ? parsed.delta.text : null;
        case 'message_delta':
          mergeUsage(parsed.usage);
          if (typeof parsed.delta?.stop_reason === 'string') stopReason = parsed.delta.stop_reason;
          return null;
        case 'message_stop':
          done = true;
          return null;
        default:
          return null;
      }
    },
    state() {
      return { model, usage, stopReason, done };
    },
  };
}
