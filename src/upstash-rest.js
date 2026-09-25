// @ts-check
// Upstash REST transport shared by the hosted API functions.

const UPSTASH_HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.upstash\.io$/i;

/** Atomic "INCRBY then PEXPIRE" in one round trip, so a counter never outlives its window. */
export const INCRBY_PEXPIRE_LUA = "local v = redis.call('INCRBY', KEYS[1], ARGV[1]) redis.call('PEXPIRE', KEYS[1], ARGV[2]) return v";

/**
 * The origin of a bare `https://<name>.upstash.io/` REST root, or null for
 * anything else: another host, credentials, a port, a path, a query or a
 * fragment.
 *
 * @param {string|undefined} base
 * @returns {string|null}
 */
export function upstashOrigin(base) {
  if (!base) return null;
  let url;
  try {
    url = new URL(base);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port
    || !UPSTASH_HOST.test(url.hostname) || url.pathname !== '/' || url.search || url.hash) return null;
  return url.origin;
}

/**
 * Make one Upstash REST call and return its parsed JSON body. Redirects are
 * refused so the bearer token cannot be forwarded to another host. With
 * `deadlineMs`, the call (response headers and body) is aborted and rejected
 * once it runs over.
 *
 * @param {string} url
 * @param {{method?: string, headers?: Record<string, string>, body?: string}} init
 * @param {{failureMessage: string, deadlineMs?: number, deadlineMessage?: string, fetchImpl?: typeof fetch}} options
 * @returns {Promise<any>}
 */
export async function upstashFetch(url, init, {
  failureMessage,
  deadlineMs,
  deadlineMessage = 'upstash request deadline exceeded',
  fetchImpl = globalThis.fetch,
}) {
  const controller = deadlineMs === undefined ? null : new AbortController();
  const request = (async () => {
    const response = await fetchImpl(url, { ...init, redirect: 'error', ...(controller ? { signal: controller.signal } : {}) });
    if (!response?.ok) throw new Error(failureMessage);
    return response.json();
  })();
  if (!controller) return request;
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(deadlineMessage));
    }, deadlineMs);
  });
  try {
    return await Promise.race([request, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
