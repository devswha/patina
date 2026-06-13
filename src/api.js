// @ts-check
import { validateBaseURL } from './security.js';
import { DEFAULT_BEST_MODELS } from './model-defaults.js';

const DEFAULT_TIMEOUT = 120000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BASE_BACKOFF_MS = 1000;
const DEFAULT_MAX_BACKOFF_MS = 30000;
/**
 * Default sampling temperature for OpenAI-compatible chat completion calls.
 *
 * @type {number}
 * @example
 * const temperature = DEFAULT_TEMPERATURE; // 0.7
 */
export const DEFAULT_TEMPERATURE = 0.7;

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
    super(`HTTP ${status}: ${truncate(body)}`);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
    this.retryAfter = retryAfter;
  }
}

function truncate(text, max = 256) {
  if (typeof text !== 'string') return '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// Surface provider prompt-cache token counts when present, normalized across
// OpenAI-compatible (usage.prompt_tokens_details.cached_tokens) and Anthropic-
// style (usage.cache_read_input_tokens / cache_creation_input_tokens) shapes.
// Absent-safe: returns null when the provider exposes no cache usage, so the
// cache-friendly prompt layout (C1) can be observed without breaking providers
// that omit these fields.
function extractCacheTokens(usage) {
  if (!usage || typeof usage !== 'object') return null;
  const cachedRead = usage.prompt_tokens_details?.cached_tokens ?? usage.cache_read_input_tokens ?? null;
  const cacheCreation = usage.cache_creation_input_tokens ?? null;
  if (cachedRead == null && cacheCreation == null) return null;
  return {
    cachedReadTokens: cachedRead ?? null,
    cacheCreationTokens: cacheCreation ?? null,
  };
}

function abortError(message = 'The operation was aborted') {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
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
  return new Promise((resolve, reject) => {
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
  });
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
 * @param {number} [options.timeout=120000] Per-attempt timeout in milliseconds.
 * @param {number} [options.maxRetries=2] Retry count after the first attempt.
 * @param {number} [options.deadline] Absolute epoch-millisecond deadline for all attempts.
 * @param {AbortSignal} [options.signal] External cancellation signal.
 * @param {boolean} [options.allowInsecureBaseURL=false] Allow non-loopback HTTP base URLs.
 * @param {Function} [options.onResponse] Callback receiving provider metadata.
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
  timeout = DEFAULT_TIMEOUT,
  maxRetries = DEFAULT_MAX_RETRIES,
  deadline,
  signal,
  allowInsecureBaseURL = false,
  onResponse,
  // Allows tests to inject a deterministic delay function.
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => Date.now(),
}) {
  validateBaseURL(baseURL, { allowInsecure: allowInsecureBaseURL });
  const url = `${baseURL}/chat/completions`;
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature,
  };
  if (seed !== undefined && seed !== null) body.seed = seed;
  if (responseFormat) body.response_format = responseFormat;


  let lastError;
  let attemptsMade = 0;
  let success = null;
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
    try {
      const attemptTimeout = Math.min(timeout, remainingBeforeAttempt);
      timer = setTimeout(() => controller.abort(), attemptTimeout);
      if (signal) {
        const onAbort = () => controller.abort();
        signal.addEventListener('abort', onAbort, { once: true });
        signalCleanup = () => signal.removeEventListener('abort', onAbort);
      }
      attemptsMade++;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
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

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from LLM API');
      }

      const metadata = {
        provider: 'openai-http',
        model: data.model ?? model,
        requestedModel: model,
        temperature,
        seed: seed ?? null,
        usage: data.usage ?? null,
        cacheTokens: extractCacheTokens(data.usage),
        rawResponse: data,
        content,
      };
      // Success: stop retrying here. onResponse/return run OUTSIDE the retried
      // block (below) so a throw from the consumer callback can't be misread as
      // a retryable fetch failure (isRetryable treats TypeError as a network
      // error) and re-issue the already-paid request (#444).
      success = { content, metadata };
    } catch (err) {
      lastError = err;
      if (signal?.aborted) break;
      const remainingAfterAttempt = remainingBudgetMs(deadline, now);
      if (remainingAfterAttempt <= 0) {
        lastError = new Error(`LLM API deadline exceeded after attempt ${attempt + 1}: ${err.message}`);
        break;
      }
      if (attempt < maxRetries && isRetryable(err)) {
        const delay = computeBackoffMs(attempt, err.retryAfter, {
          max: Math.min(DEFAULT_MAX_BACKOFF_MS, remainingAfterAttempt),
          now,
        });
        await sleepWithSignal(sleep, delay, signal);
        continue;
      }
      // Non-retryable or out of attempts — bail out.
      break;
    } finally {
      clearTimeout(timer);
      signalCleanup();
    }
    if (success) break;
  }

  if (success) {
    onResponse?.(success.metadata);
    return success.content;
  }

  const err = new Error(`LLM API failed after ${attemptsMade || 1} attempts: ${lastError?.message ?? 'unknown'}`);
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

