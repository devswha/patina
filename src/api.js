import { validateBaseURL } from './security.js';

const DEFAULT_TIMEOUT = 120000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BASE_BACKOFF_MS = 1000;
const DEFAULT_MAX_BACKOFF_MS = 30000;

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

// Bounded-concurrency semaphore. `max <= 0` (or undefined) yields a
// no-op gate so the existing parallel-fanout behavior is unchanged when
// the caller doesn't ask for a limit.
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
  temperature = 0.7,
  timeout = DEFAULT_TIMEOUT,
  maxRetries = DEFAULT_MAX_RETRIES,
  allowInsecureBaseURL = false,
  // Allows tests to inject a deterministic delay function.
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  validateBaseURL(baseURL, { allowInsecure: allowInsecureBaseURL });
  const url = `${baseURL}/chat/completions`;
  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature,
  };

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    let timer;
    try {
      timer = setTimeout(() => controller.abort(), timeout);

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

      return content;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries && isRetryable(err)) {
        const delay = computeBackoffMs(attempt, err.retryAfter);
        await sleep(delay);
        continue;
      }
      // Non-retryable or out of attempts — bail out.
      break;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`LLM API failed after ${maxRetries + 1} attempts: ${lastError?.message ?? 'unknown'}`);
}

export async function callLLMMultiple({
  prompt,
  models,
  apiKey,
  baseURL = 'https://api.openai.com/v1',
  temperature = 0.7,
  timeout = DEFAULT_TIMEOUT,
  allowInsecureBaseURL = false,
  maxConcurrency = 0, // 0 = unlimited (preserves prior behavior)
  onStart,
  onComplete,
}) {
  validateBaseURL(baseURL, { allowInsecure: allowInsecureBaseURL });
  const sem = createSemaphore(maxConcurrency);
  const promises = models.map(async (model) => {
    const release = await sem.acquire();
    if (onStart) onStart(model);
    try {
      const result = await callLLM({
        prompt,
        apiKey,
        baseURL,
        model,
        temperature,
        timeout,
        allowInsecureBaseURL,
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
