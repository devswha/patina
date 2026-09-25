// @ts-check
import { validateBaseURL } from './security.js';
import { buildNativeBody, nativeAnthropicEnabled, nativeEndpoint, nativeHeaders, normalizeNativeResponse } from './anthropic-native.js';
import { DEFAULT_BEST_MODELS } from './model-defaults.js';
import {
  DEFAULT_MAX_RETRIES,
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

const DEFAULT_BASE_BACKOFF_MS = 1000;
const DEFAULT_MAX_BACKOFF_MS = 30000;

// undici (Node's global fetch) kills a request whose response *headers* have
// not arrived within 300s (`headersTimeout`), regardless of any caller-side
// AbortSignal budget. A non-streaming chat completion only sends headers after
// generation finishes, so any per-attempt budget above this ceiling must
// switch to SSE streaming, where headers arrive immediately and each token
// chunk keeps undici's idle `bodyTimeout` alive (#576).
const UNDICI_HEADERS_TIMEOUT_MS = 300_000;

// Models that rejected the `temperature` field outright (HTTP 400
// "deprecated" / "not supported" — Anthropic's OpenAI-compat endpoint started
// this with claude-sonnet-5; some OpenAI reasoning models do the same).
// Learned at runtime and shared with the streaming client so a warm process
// skips the doomed first attempt on subsequent calls.
const temperatureRejectedModels = new Set();

/**
 * True when the provider rejected a request solely because `temperature` is
 * unsupported/deprecated for the requested model. Callers retry exactly once
 * with the field omitted (and remember the model for this process).
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isTemperatureRejectedError(err) {
  if (!(err instanceof HttpError) || err.status !== 400) return false;
  const text = `${err.message} ${err.body}`;
  return /temperature/i.test(text) && /deprecat|unsupported|not (?:be )?support/i.test(text);
}

/**
 * @param {string} model
 * @returns {boolean} Whether this process already saw the model reject `temperature`.
 */
export function modelRejectsTemperature(model) {
  return temperatureRejectedModels.has(model);
}

/**
 * @param {string} model
 * @returns {void}
 */
export function markTemperatureRejected(model) {
  temperatureRejectedModels.add(model);
}

// Status codes that warrant a retry. Network errors (no status, AbortError)
// are also retryable; auth / validation 4xxs are not.
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

// Subclassed error so the retry loop can read `.status` + `.retryAfter`
// without re-parsing strings.
/**
 * Error raised for non-2xx HTTP responses from an LLM provider.
 *
 * @param {number} status HTTP status code returned by the provider.
 * @param {string} body Response body text, truncated in the message.
 * @param {string|null} retryAfter Raw Retry-After response header, if present.
 * @example
 * throw new HttpError(429, 'rate limit', '2');
 */
export class HttpError extends Error {
  constructor(status, body, retryAfter) {
    super(`HTTP ${status}: ${truncate(redactErrorText(body))}`);
    this.name = 'HttpError';
    this.status = status;
    this.body = redactErrorText(typeof body === 'string' ? body : '');
    this.retryAfter = retryAfter;
  }
}

function truncate(text, max = 256) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * Redact secret-bearing substrings (Bearer tokens, sk- API keys, key= query
 * params) from provider error text BEFORE it enters an error message, error
 * body, or a log line. The single source of truth for LLM-transport error
 * redaction, reused by the streaming helper and the scoring logger so a BYOK
 * key echoed in a provider error response is never persisted (AC11).
 *
 * @param {unknown} text
 * @returns {string}
 */
export function redactErrorText(text) {
  return String(text ?? '')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9._-]{8,}/g, '[REDACTED]')
    .replace(/([?&](?:api[_-]?key|key|token|access[_-]?token)=)[^&\s"']+/gi, '$1[REDACTED]');
}

function remainingBudgetMs(deadline, now) {
  if (deadline === undefined || deadline === null) return Infinity;
  return Math.max(0, deadline - now());
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw abortError('External abort signal canceled LLM API call');
  }
}

function sleepWithSignal(sleep, ms, signal) {
  if (ms <= 0) return Promise.resolve();
  if (!signal) return sleep(ms);
  // `Promise<void>` is spelled out so `resolve()` type-checks with no argument.
  return /** @type {Promise<void>} */ (new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(abortError('External abort signal canceled LLM API retry sleep'));
    };
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    sleep(ms).then(
      () => {
        cleanup();
        resolve();
      },
      (err) => {
        cleanup();
        reject(err);
      }
    );
  }));
}

/**
 * Decide whether an LLM call failure should be retried.
 *
 * @param {Error|Object} err Error thrown by fetch or {@link HttpError}.
 * @returns {boolean} True for retryable HTTP statuses, aborts, and common network failures.
 * @example
 * const retry = isRetryable(new HttpError(429, 'rate limit', '1'));
 */
export function isRetryable(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return true;
  if (typeof err.status === 'number') return RETRYABLE_STATUS.has(err.status);
  // Heuristic for fetch network errors (no status set).
  return err.name === 'TypeError' || err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED';
}

// Honors Retry-After (seconds or HTTP-date). Falls back to exponential
// backoff with up to 50% jitter, capped at maxDelay.
/**
 * Compute retry delay from Retry-After or exponential backoff with jitter.
 *
 * @param {number} attempt Zero-based retry attempt.
 * @param {string|null|undefined} retryAfter Retry-After seconds or HTTP-date header.
 * @param {object} [opts] Backoff tuning and deterministic test hooks.
 * @param {number} [opts.base=1000] Initial exponential backoff in milliseconds.
 * @param {number} [opts.max=30000] Maximum returned delay in milliseconds.
 * @param {Function} [opts.now] Clock returning epoch milliseconds.
 * @param {Function} [opts.random] Random number provider used for jitter.
 * @returns {number} Delay in milliseconds, capped at opts.max.
 * @example
 * const delay = computeBackoffMs(1, '2'); // 2000
 */
export function computeBackoffMs(attempt, retryAfter, opts = {}) {
  const {
    base = DEFAULT_BASE_BACKOFF_MS,
    max = DEFAULT_MAX_BACKOFF_MS,
    now = () => Date.now(),
    random = Math.random,
  } = opts;

  if (retryAfter) {
    const asNumber = Number(retryAfter);
    if (Number.isFinite(asNumber) && asNumber >= 0) {
      return Math.min(asNumber * 1000, max);
    }
    const asDateMs = Date.parse(retryAfter);
    if (Number.isFinite(asDateMs)) {
      return Math.max(0, Math.min(asDateMs - now(), max));
    }
  }

  const exp = Math.min(base * 2 ** attempt, max);
  const jitter = random() * exp * 0.5;
  return Math.min(exp + jitter, max);
}


/**
 * Read a streamed (SSE) chat-completions response and assemble it into the
 * non-streaming response shape (`choices[0].message.content` plus `model` /
 * `usage` / `finish_reason` when the provider sends them), so the rest of
 * callLLM stays transport-agnostic (#576).
 *
 * @param {{ body: unknown }} response Fetch response with an SSE body.
 * @param {Function} [onMetadata] Optional metadata callback.
 * @returns {Promise<{ choices: Array<{ message: { content: string }, finish_reason?: string }>, model?: string, usage?: object }>}
 */
async function readStreamedCompletion(response, onMetadata) {
  let content = '';
  let finishReason;
  let model;
  let usage = null;
  await readSseLines(/** @type {any} */ (response).body, (line) => {
    const parsed = parseSseData(line);
    if (parsed === SSE_DONE) return true;
    if (parsed === undefined) return false;
    const event = /** @type {any} */ (parsed);
    if (typeof event?.model === 'string' && !model) model = event.model;
    // Providers that report usage on a stream do so on the final chunk.
    if (event?.usage && typeof event.usage === 'object' && !Array.isArray(event.usage)) usage = event.usage;
    onMetadata?.({ effectiveModel: model ?? null, usage });
    const choice = event?.choices?.[0];
    if (typeof choice?.finish_reason === 'string') finishReason = choice.finish_reason;
    const delta = choice?.delta?.content;
    if (typeof delta === 'string') content += delta;
    return false;
  });

  const choice = /** @type {{ message: { content: string }, finish_reason?: string }} */ ({ message: { content } });
  if (finishReason) choice.finish_reason = finishReason;
  const out = /** @type {{ choices: Array<{ message: { content: string }, finish_reason?: string }>, model?: string, usage?: object }} */ ({ choices: [choice] });
  if (model) out.model = model;
  if (usage) out.usage = usage;
  return out;
}

/**
 * Call an OpenAI-compatible chat completions endpoint with retries, timeout, and abort support.
 *
 * @param {object} options LLM request options.
 * @param {string} options.prompt User prompt sent as the single chat message.
 * @param {string} [options.apiKey] Bearer token for the provider.
 * @param {string} [options.baseURL] OpenAI-compatible API base URL. Defaults to https://api.openai.com/v1.
 * @param {string} [options.model] Model id to request. Defaults to gpt-5.5.
 * @param {number} [options.temperature=DEFAULT_TEMPERATURE] Sampling temperature.
 * @param {number|string} [options.seed] Optional deterministic seed forwarded to the provider.
 * @param {object} [options.responseFormat] Optional OpenAI-compatible structured-output request field (sent as response_format) when provided.
 * @param {object} [options.extraBody] Optional provider-specific fields spread into the OpenAI-compat request body (protocol fields cannot be overridden; ignored on the native Anthropic path).
 * @param {number} [options.timeout=120000] Per-attempt timeout in milliseconds. Budgets above 300s automatically switch the request to SSE streaming so undici's headersTimeout cannot kill long-running local backends (#576).
 * @param {number} [options.maxRetries=2] Retry count after the first attempt.
 * @param {number} [options.deadline] Absolute epoch-millisecond deadline for all attempts.
 * @param {AbortSignal} [options.signal] External cancellation signal.
 * @param {Function} [options.onResponse] Callback receiving successful provider metadata. Its exceptions are ignored.
 * @param {Function} [options.onAttempt] Callback receiving each completed paid transport attempt as `{ attemptIndex, requestedModel, effectiveModel, usage, retryReason, minimumChargeApplied, outcome }`. Attempt indexes are one-based; its exceptions are ignored.
 * @param {Function} [options.sleep] Injectable sleep function for tests.
 * @param {Function} [options.now] Clock returning epoch milliseconds.
 * @returns {Promise<string>} Assistant message content.
 * @throws {HttpError} When the provider returns a non-2xx response after retries.
 * @throws {Error} On abort, timeout, malformed provider payload, or base URL validation failure.
 * @example
 * const text = await callLLM({ prompt: 'Rewrite this', apiKey: process.env.OPENAI_API_KEY });
 */
export async function callLLM({
  prompt,
  apiKey,
  baseURL = 'https://api.openai.com/v1',
  model = DEFAULT_BEST_MODELS.openai,
  temperature = DEFAULT_TEMPERATURE,
  seed,
  // Optional OpenAI-compatible structured-output request field, e.g.
  // { type: 'json_object' } or a json_schema spec. Opt-in: when omitted, no
  // response_format is sent so endpoints that reject the field are unaffected.
  responseFormat,
  // Optional provider-specific body fields spread into the OpenAI-compat
  // request verbatim (e.g. DeepSeek `thinking: {type:"disabled"}`, Gemini
  // `reasoning_effort: "low"`, Alibaba `enable_thinking: false`). Known
  // fields above cannot be overridden. Ignored on the native Anthropic path.
  extraBody,
  timeout = DEFAULT_TIMEOUT,
  maxRetries = DEFAULT_MAX_RETRIES,
  deadline,
  signal,
  onResponse,
  onAttempt,
  // Allows tests to inject a deterministic delay function.
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => Date.now(),
}) {
  validateBaseURL(baseURL);
  // Native Anthropic branch (opt-in): buffered /v1/messages with a cached
  // prompt prefix. seed/response_format have no native equivalent and are
  // omitted there — schema-retry already covers structured-output parsing.
  const native = nativeAnthropicEnabled({ baseURL });
  const url = native ? nativeEndpoint(baseURL) : `${baseURL}/chat/completions`;
  // Skip `temperature` up front when this process already saw the model
  // reject it (e.g. claude-sonnet-5) — avoids a guaranteed 400 round trip.
  const sendTemperature = modelRejectsTemperature(model) ? undefined : temperature;
  /** @type {Record<string, any>} */
  const body = native
    ? buildNativeBody({ prompt, model, temperature: sendTemperature })
    : chatCompletionsBody({ prompt, model, temperature: sendTemperature, extraBody });
  if (!native && seed !== undefined && seed !== null) body.seed = seed;
  if (!native && responseFormat) body.response_format = responseFormat;


  let lastError;
  let attemptsMade = 0;
  let success = null;
  let retryReason = 'initial';
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      throwIfAborted(signal);
    } catch (err) {
      lastError = err;
      break;
    }
    const remainingBeforeAttempt = remainingBudgetMs(deadline, now);
    if (remainingBeforeAttempt <= 0) {
      lastError = new Error('LLM API deadline exceeded before the next retry attempt');
      break;
    }

    const controller = new AbortController();
    let timer;
    let signalCleanup = () => {};
    let attemptRecord = null;
    try {
      const attemptTimeout = Math.min(timeout, remainingBeforeAttempt);
      // Past undici's headersTimeout a non-streaming request cannot survive:
      // headers for a buffered completion only arrive after generation ends.
      // Stream instead and assemble the response client-side (#576).
      // The native path stays buffered: its SSE framing differs and our
      // attempt timeouts sit under the undici headers ceiling.
      const useStream = !native && attemptTimeout > UNDICI_HEADERS_TIMEOUT_MS;
      timer = setTimeout(() => controller.abort(), attemptTimeout);
      if (signal) {
        const onAbort = () => controller.abort();
        signal.addEventListener('abort', onAbort, { once: true });
        signalCleanup = () => signal.removeEventListener('abort', onAbort);
      }
      attemptsMade++;
      attemptRecord = newAttemptRecord(attemptsMade, model, retryReason);

      const response = await fetch(url, {
        method: 'POST',
        headers: native ? nativeHeaders(apiKey) : bearerHeaders(apiKey),
        body: JSON.stringify(useStream ? { ...body, stream: true } : body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new HttpError(
          response.status,
          errorText,
          response.headers.get('retry-after')
        );
      }

      // A minimal OpenAI-compatible server may ignore `stream: true` and reply
      // with a buffered JSON completion — detect that via Content-Type and
      // parse whichever shape actually arrived (#576).
      const streamedReply = useStream &&
        !(response.headers?.get?.('content-type') ?? '').includes('application/json');
      const data = streamedReply
        ? await readStreamedCompletion(response, (metadata) => {
          attemptRecord.effectiveModel = metadata.effectiveModel;
          attemptRecord.usage = metadata.usage;
        })
        : native ? normalizeNativeResponse(await response.json()) : await response.json();
      const effectiveModel = typeof data.model === 'string' ? data.model : null;
      const usage = data.usage && typeof data.usage === 'object' && !Array.isArray(data.usage)
        ? data.usage
        : null;
      attemptRecord.effectiveModel = effectiveModel;
      attemptRecord.usage = usage;
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from LLM API');
      }
      const metadata = responseMetadata({
        native,
        effectiveModel,
        requestedModel: model,
        temperature: 'temperature' in body ? temperature : null,
        seed: seed ?? null,
        usage,
        rawResponse: data,
        content,
      });
      attemptRecord.outcome = 'success';
      success = { content, metadata };
    } catch (err) {
      lastError = err;
      if (signal?.aborted) break;
      const remainingAfterAttempt = remainingBudgetMs(deadline, now);
      if (remainingAfterAttempt <= 0) {
        lastError = new Error(`LLM API deadline exceeded after attempt ${attempt + 1}: ${err.message}`);
        break;
      }
      // `temperature` rejected for this model: drop the field and re-issue
      // immediately. Does not consume a backoff attempt; cannot loop because
      // the field is gone from `body` after the first hit.
      if (isTemperatureRejectedError(err) && 'temperature' in body) {
        markTemperatureRejected(model);
        delete body.temperature;
        retryReason = 'temperature_schema';
        attempt--;
        continue;
      }
      if (attempt < maxRetries && isRetryable(err)) {
        retryReason = err.name === 'AbortError'
          ? 'timeout'
          : typeof err.status === 'number'
            ? 'transport'
            : 'network';
        const delay = computeBackoffMs(attempt, err.retryAfter, {
          max: Math.min(DEFAULT_MAX_BACKOFF_MS, remainingAfterAttempt),
          now,
        });
        if (attemptRecord) {
          dispatchMetadata(onAttempt, attemptRecord);
          attemptRecord = null;
        }
        await sleepWithSignal(sleep, delay, signal);
        continue;
      }
      // Non-retryable or out of attempts — bail out.
      break;
    } finally {
      clearTimeout(timer);
      signalCleanup();
      if (attemptRecord) dispatchMetadata(onAttempt, attemptRecord);
    }
    if (success) break;
  }

  if (success) {
    dispatchMetadata(onResponse, success.metadata);
    return success.content;
  }

  const err = new Error(`LLM API failed after ${attemptsMade || 1} attempts: ${redactErrorText(lastError?.message ?? 'unknown')}`);
  if (lastError?.name === 'AbortError') {
    // Distinguish a real external cancellation from a per-attempt timeout:
    // only an aborted external signal stays AbortError (callers rethrow that as
    // cancellation). A timer-driven abort is a transient timeout and must take
    // the same fail-closed/fallback path as other transient failures (#444).
    err.name = signal?.aborted ? 'AbortError' : 'TimeoutError';
  }
  const lastStatus = lastError ? /** @type {any} */ (lastError).status : undefined;
  if (typeof lastStatus === 'number') /** @type {any} */ (err).status = lastStatus;
  throw err;
}

