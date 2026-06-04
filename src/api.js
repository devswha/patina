// @ts-check
import { validateBaseURL } from './security.js';

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
 * @throws {Error} Does not intentionally throw; unexpected Error-like inputs may still propagate JavaScript runtime failures.
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
 * @throws {Error} Propagates validation, filesystem, network, or dependency failures when the underlying operation cannot complete.
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
 * @param {string} [options.model] Model id to request. Defaults to gpt-4o.
 * @param {number} [options.temperature=DEFAULT_TEMPERATURE] Sampling temperature.
 * @param {number|string} [options.seed] Optional deterministic seed forwarded to the provider.
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
  model = 'gpt-4o',
  temperature = DEFAULT_TEMPERATURE,
  seed,
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


  let lastError;
  let attemptsMade = 0;
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
        rawResponse: data,
        content,
      };
      onResponse?.(metadata);

      return content;
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
  }

  const err = new Error(`LLM API failed after ${attemptsMade || 1} attempts: ${lastError?.message ?? 'unknown'}`);
  if (lastError?.name === 'AbortError') err.name = 'AbortError';
  const lastStatus = lastError ? /** @type {any} */ (lastError).status : undefined;
  if (typeof lastStatus === 'number') /** @type {any} */ (err).status = lastStatus;
  throw err;
}

