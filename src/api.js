import { validateBaseURL } from './security.js';

const DEFAULT_TIMEOUT = 120000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BASE_BACKOFF_MS = 1000;
const DEFAULT_MAX_BACKOFF_MS = 30000;
export const DEFAULT_TEMPERATURE = 0.7;

// Status codes that warrant a retry. Network errors (no status, AbortError)
// are also retryable; auth / validation 4xxs are not.
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

// Subclassed error so the retry loop can read `.status` + `.retryAfter`
// without re-parsing strings.
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

export function isRetryable(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return true;
  if (typeof err.status === 'number') return RETRYABLE_STATUS.has(err.status);
  // Heuristic for fetch network errors (no status set).
  return err.name === 'TypeError' || err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED';
}

// Honors Retry-After (seconds or HTTP-date). Falls back to exponential
// backoff with up to 50% jitter, capped at maxDelay.
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

// Bounded-concurrency semaphore. `max <= 0` yields a no-op gate for callers
// that explicitly opt into unlimited fanout.
export function createSemaphore(max) {
  if (!max || max <= 0) {
    return { acquire: () => Promise.resolve(() => {}) };
  }
  let active = 0;
  const queue = [];
  const drain = () => {
    if (active < max && queue.length) {
      active++;
      const resolve = queue.shift();
      resolve(() => {
        active--;
        drain();
      });
    }
  };
  return {
    acquire() {
      return new Promise((resolve) => {
        queue.push(resolve);
        if (active < max) drain();
      });
    },
  };
}

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
  cache,
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

  const cached = cache?.get?.({ prompt, model, temperature, baseURL });
  if (cached) {
    onResponse?.({
      provider: 'cache',
      model: cached.responseModel ?? cached.model ?? model,
      requestedModel: model,
      temperature,
      seed: seed ?? null,
      usage: cached.usage ?? null,
      rawResponse: null,
      content: cached.content,
      cache: { hit: true, key: cached.key, path: cached.path },
    });
    return cached.content;
  }

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
        cache: cache ? { hit: false } : null,
      };
      cache?.set?.({ prompt, model, temperature, baseURL }, content, metadata);
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
  if (typeof lastError?.status === 'number') err.status = lastError.status;
  throw err;
}

export async function callLLMMultiple({
  prompt,
  models,
  apiKey,
  baseURL = 'https://api.openai.com/v1',
  temperature = DEFAULT_TEMPERATURE,
  seed,
  timeout = DEFAULT_TIMEOUT,
  allowInsecureBaseURL = false,
  deadline,
  signal,
  maxConcurrency,
  onStart,
  onComplete,
  onResponse,
  cache,
  callLLM: callLLMImpl = callLLM,
  sleep,
  now = () => Date.now(),
}) {
  validateBaseURL(baseURL, { allowInsecure: allowInsecureBaseURL });
  const effectiveMaxConcurrency =
    maxConcurrency === undefined || maxConcurrency === null
      ? Math.min(models.length, 3)
      : maxConcurrency;
  const sem = createSemaphore(effectiveMaxConcurrency);
  const promises = models.map(async (model) => {
    const release = await sem.acquire();
    if (onStart) onStart(model);
    try {
      const result = await callLLMImpl({
        prompt,
        apiKey,
        baseURL,
        model,
        temperature,
        seed,
        timeout,
        deadline,
        signal,
        allowInsecureBaseURL,
        onResponse,
        cache,
        sleep,
        now,
      });
      if (onComplete) onComplete(model, true);
      return { model, result, ok: true };
    } catch (err) {
      if (onComplete) onComplete(model, false);
      return { model, error: err.message, ok: false };
    } finally {
      release();
    }
  });

  return Promise.all(promises);
}
