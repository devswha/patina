import { inputError } from '../errors.js';
import { validateBaseURL } from '../security.js';
import { DEFAULT_BACKEND_TIMEOUT_MS } from './contract.js';
import { buildHostedRequest, parseHostedResponse } from './patina-hosted-schema.js';

// Opt-in hosted backend. It is NOT auto-selected: it only runs when the user
// passes `--backend patina-hosted` (alone or inside an explicit fallback
// chain). An unset URL, unset key, or server failure is an *explicit* error —
// patina never silently falls back to the open baseline. Fallback happens only
// when the user spells out a chain such as `--backend patina-hosted,openai-http`
// and the hosted leg fails with a retryable status. See issue #88.
export const name = 'patina-hosted';
export const urlEnvVar = 'PATINA_HOSTED_URL';
export const keyEnvVar = 'PATINA_HOSTED_KEY';
const ENDPOINT_PATH = 'v1/humanize';

export function isAvailable() {
  return Boolean(process.env[urlEnvVar]);
}

export function isAuthenticated() {
  return Boolean(process.env[keyEnvVar]);
}

export function authHint() {
  return `Set ${urlEnvVar} to your patina-hosted endpoint and ${keyEnvVar} to your API key. The hosted backend never falls back silently — an unset URL or key is an explicit error.`;
}

export async function invoke({
  prompt,
  model,
  lang,
  profile,
  signal,
  timeout = DEFAULT_BACKEND_TIMEOUT_MS,
  onResponse,
} = {}) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('patina-hosted backend: prompt must be a non-empty string');
  }
  throwIfAborted(signal);

  const baseUrl = process.env[urlEnvVar];
  if (!baseUrl) {
    throw inputError(
      'patina-hosted backend is not configured',
      `${urlEnvVar} is unset, so patina cannot reach the hosted endpoint.`,
      `Set ${urlEnvVar} (and ${keyEnvVar}), or choose a different --backend. patina-hosted never falls back to the open baseline on its own.`
    );
  }
  const apiKey = process.env[keyEnvVar];
  if (!apiKey) {
    throw inputError(
      'patina-hosted backend is not authenticated',
      `${keyEnvVar} is unset, so patina cannot authenticate to the hosted endpoint.`,
      `Set ${keyEnvVar}, or choose a different --backend. patina-hosted never falls back to the open baseline on its own.`
    );
  }

  // Reuse the SSRF / plaintext-HTTP guard used for provider base URLs. Loopback
  // HTTP is allowed (local mock servers); any other host needs HTTPS unless the
  // operator explicitly opted in via the documented PATINA_ALLOW_* env flags.
  validateBaseURL(baseUrl);
  const endpoint = joinUrl(baseUrl, ENDPOINT_PATH);
  const requestBody = buildHostedRequest({ text: prompt, lang, profile, model });

  const controller = new AbortController();
  let signalCleanup = () => {};
  const timer = setTimeout(() => controller.abort(), timeout);
  if (signal) {
    const onAbort = () => controller.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    signalCleanup = () => signal.removeEventListener('abort', onAbort);
  }

  try {
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } catch (err) {
      if (signal?.aborted) throw abortError('patina-hosted backend: aborted');
      if (err?.name === 'AbortError') {
        throw abortError(`patina-hosted backend: timed out after ${timeout}ms`);
      }
      throw new Error(`patina-hosted backend: request to ${endpoint} failed (${err?.message || err})`);
    }

    if (!response.ok) {
      let detail = '';
      try {
        detail = (await response.text()).slice(0, 256);
      } catch {
        detail = '';
      }
      const err = new Error(
        `patina-hosted backend: HTTP ${response.status}${detail ? ` — ${detail}` : ''}`
      );
      // Surface the status so an explicit fallback chain can treat 429/503 as
      // retryable (see backends/contract.js isRetryableBackendError). Auth/4xx
      // stays non-retryable, so a misconfigured chain fails loudly.
      err.status = response.status;
      throw err;
    }

    let payload;
    try {
      payload = await response.json();
    } catch (err) {
      throw new Error(`patina-hosted backend: response was not valid JSON (${err?.message || err})`);
    }

    const parsed = parseHostedResponse(payload);
    onResponse?.({
      provider: name,
      model: model ?? null,
      requestedModel: model ?? null,
      schemaVersion: parsed.schemaVersion,
      spans: parsed.spans,
      content: parsed.text,
    });
    return parsed.text;
  } finally {
    clearTimeout(timer);
    signalCleanup();
  }
}

function joinUrl(base, path) {
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function abortError(message) {
  const err = new Error(message);
  err.name = 'AbortError';
  return err;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError('patina-hosted backend: aborted');
}
