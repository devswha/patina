// @ts-check

import { byteLength, redactSecrets, validateRewriteRequest } from './web-rewrite-contract.js';
import { extractClientIp } from './rate-limit.js';

/**
 * @typedef {{method?: string, headers?: Record<string, string|string[]|undefined>, body?: unknown, [Symbol.asyncIterator]?: () => AsyncIterator<Buffer|string|Uint8Array>}} RewriteReq
 * @typedef {{statusCode?: number, setHeader?: (name: string, value: string) => void, end?: (body?: string) => void}} RewriteRes
 * @typedef {{check(input: {tier: string, ip: string|null}): Promise<{allowed: true, tier: string}|{allowed: false, status: number, reason: string}>}} RateLimiter
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

      // await so a runner rejection is caught by the redacted 500 handler below.
      return await runRewrite({ req, res, request, now });
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
