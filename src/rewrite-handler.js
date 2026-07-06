// @ts-check

import { byteLength, redactSecrets, validateRewriteRequest } from './web-rewrite-contract.js';
import { extractClientIp } from './rate-limit.js';

/**
 * Cancellation contract: `runRewrite` receives the raw `req`/`res`. Runtimes
 * that expose emitter methods let the runner observe client disconnects —
 * `res` emits 'close' (with `writableEnded === false` on a premature
 * disconnect) and legacy `req` emits 'aborted'. All emitter members are
 * optional so bare serverless/test mocks keep working.
 *
 * @typedef {{method?: string, headers?: Record<string, string|string[]|undefined>, body?: unknown, on?: (event: string, listener: (...args: unknown[]) => void) => unknown, off?: (event: string, listener: (...args: unknown[]) => void) => unknown, [Symbol.asyncIterator]?: () => AsyncIterator<Buffer|string|Uint8Array>}} RewriteReq
 * @typedef {{statusCode?: number, setHeader?: (name: string, value: string) => void, write?: (chunk: string) => void, end?: (body?: string) => void, on?: (event: string, listener: (...args: unknown[]) => void) => unknown, off?: (event: string, listener: (...args: unknown[]) => void) => unknown, writableEnded?: boolean, headersSent?: boolean, destroy?: () => void}} RewriteRes
 * @typedef {{check(input: {tier: string, ip: string|null}): Promise<{allowed: true, tier: string}|{allowed: false, status: number, reason: string}>, acquireConcurrency?(input: {tier: string, ip: string|null}): Promise<{allowed: true, tier: string}|{allowed: false, status: number, reason: string}>, releaseConcurrency?(input: {tier: string, ip: string|null}): Promise<void>}} RateLimiter
 */

/**
 * Create the /api/rewrite handler shell. The LLM runner is injected by later phases.
 *
 * @param {{rateLimiter: RateLimiter, runRewrite: Function, env?: Record<string, string|undefined>, now?: () => number, logger?: {error?: (...args: unknown[]) => void}, maxBodyBytes?: number}} options
 * @returns {(req: RewriteReq, res: RewriteRes) => Promise<unknown>}
 */
export function createRewriteHandler({ rateLimiter, runRewrite, env = {}, now = () => Date.now(), logger = console, maxBodyBytes = 65_536 }) {
  if (typeof runRewrite !== 'function') throw new TypeError('runRewrite must be a function');
  if (!rateLimiter || typeof rateLimiter.check !== 'function') throw new TypeError('rateLimiter.check must be a function');

  return async function rewriteHandler(req, res) {
    setSecurityHeaders(res);
    try {
      if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });

      const rawBody = await readRawBody(req, maxBodyBytes);
      if (rawBody == null) return send(res, 413, { error: 'request body too large' });

      let body;
      try {
        body = JSON.parse(rawBody);
      } catch {
        return send(res, 400, { error: 'invalid JSON' });
      }

      const validated = validateRewriteRequest(body, env);
      if (!validated.ok) {
        const fail = /** @type {{status: number, error: string}} */ (validated);
        return send(res, fail.status, { error: fail.error });
      }

      const request = validated.value;
      const tier = typeof request.tier === 'string' ? request.tier : '';
      const ip = extractClientIp(req.headers || {});
      const quota = await rateLimiter.check({ tier, ip });
      if (!quota.allowed) {
        const denied = /** @type {{status: number, reason: string}} */ (quota);
        return send(res, denied.status, { error: denied.reason });
      }

      if (typeof rateLimiter.acquireConcurrency !== 'function') {
        // await so a runner rejection is caught by the redacted 500 handler below.
        return await runRewrite({ req, res, request, now });
      }

      const concurrency = await rateLimiter.acquireConcurrency({ tier, ip });
      if (!concurrency.allowed) {
        const denied = /** @type {{status: number, reason: string}} */ (concurrency);
        return send(res, denied.status, { error: denied.reason });
      }

      try {
        // await so a runner rejection is caught by the redacted 500 handler below.
        return await runRewrite({ req, res, request, now });
      } finally {
        await rateLimiter.releaseConcurrency?.({ tier, ip });
      }
    } catch (err) {
      logger.error?.(redactSecrets({ message: String(/** @type {any} */ (err)?.message ?? err) }));
      return send(res, 500, { error: 'internal error' });
    }
  };
}

/** @param {RewriteRes} res */
function setSecurityHeaders(res) {
  res.setHeader?.('Cache-Control', 'no-store');
  res.setHeader?.('X-Content-Type-Options', 'nosniff');
  res.setHeader?.('Content-Type', 'application/json');
}

/**
 * @param {RewriteRes} res
 * @param {number} status
 * @param {unknown} obj
 * @returns {undefined}
 */
export function send(res, status, obj) {
  // If the response is already committed (an exception escaped after a stream
  // started writing frames), re-setting status/headers would throw
  // ERR_HTTP_HEADERS_SENT inside the caller's catch and reject the handler
  // promise. Fail closed by tearing down the socket: the client's stream
  // contract already reads a truncated (no `done`) response as an error.
  if (res.headersSent || res.writableEnded) {
    res.destroy?.();
    return undefined;
  }
  res.statusCode = status;
  res.setHeader?.('Cache-Control', 'no-store');
  res.setHeader?.('X-Content-Type-Options', 'nosniff');
  res.setHeader?.('Content-Type', 'application/json');
  res.end?.(JSON.stringify(obj));
  return undefined;
}

/**
 * Read a request body. Returns null when the max byte cap is exceeded.
 *
 * @param {RewriteReq} req
 * @param {number} maxBodyBytes
 * @returns {Promise<string|null>}
 */
async function readRawBody(req, maxBodyBytes) {
  if (typeof req.body === 'string') return byteLength(req.body) > maxBodyBytes ? null : req.body;
  if (req.body != null) {
    const serialized = JSON.stringify(req.body);
    return byteLength(serialized) > maxBodyBytes ? null : serialized;
  }

  let raw = '';
  if (typeof req[Symbol.asyncIterator] !== 'function') return '';
  const stream = /** @type {AsyncIterable<Buffer|string|Uint8Array>} */ (/** @type {unknown} */ (req));
  for await (const chunk of stream) {
    raw += Buffer.from(chunk).toString('utf8');
    if (byteLength(raw) > maxBodyBytes) return null;
  }
  return raw;
}
