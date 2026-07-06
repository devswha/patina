// @ts-check

import { byteLength, QUOTA_REASONS, redactSecrets, validateRewriteRequest, WEB_TIERS } from './web-rewrite-contract.js';
import { extractClientIp } from './rate-limit.js';
import { extractBearerLicense } from './entitlement.js';

/**
 * Cancellation contract: `runRewrite` receives the raw `req`/`res`. Runtimes
 * that expose emitter methods let the runner observe client disconnects —
 * `res` emits 'close' (with `writableEnded === false` on a premature
 * disconnect) and legacy `req` emits 'aborted'. All emitter members are
 * optional so bare serverless/test mocks keep working.
 *
 * @typedef {{method?: string, headers?: Record<string, string|string[]|undefined>, body?: unknown, on?: (event: string, listener: (...args: unknown[]) => void) => unknown, off?: (event: string, listener: (...args: unknown[]) => void) => unknown, [Symbol.asyncIterator]?: () => AsyncIterator<Buffer|string|Uint8Array>}} RewriteReq
 * @typedef {{statusCode?: number, setHeader?: (name: string, value: string) => void, write?: (chunk: string) => void, end?: (body?: string) => void, on?: (event: string, listener: (...args: unknown[]) => void) => unknown, off?: (event: string, listener: (...args: unknown[]) => void) => unknown, writableEnded?: boolean, headersSent?: boolean, destroy?: () => void}} RewriteRes
 * @typedef {{check(input: {tier: string, ip: string|null, subject?: string, chars?: number}): Promise<{allowed: true, tier: string}|{allowed: false, status: number, reason: string, remainingMonthlyChars?: number, limitMonthlyChars?: number}>, acquireConcurrency?(input: {tier: string, ip: string|null, subject?: string}): Promise<{allowed: true, tier: string}|{allowed: false, status: number, reason: string}>, releaseConcurrency?(input: {tier: string, ip: string|null, subject?: string}): Promise<void>}} RateLimiter
 * @typedef {{validate(input: {licenseKey: string}): Promise<{ok: true, subject: string, tier: string, status: string, cache: string}|{ok: false, status: number, reason: string}>}} LicenseValidator
 */

/**
 * Create the /api/rewrite handler shell. The LLM runner is injected by later phases.
 *
 * @param {{rateLimiter: RateLimiter, runRewrite: Function, env?: Record<string, string|undefined>, now?: () => number, logger?: {error?: (...args: unknown[]) => void}, maxBodyBytes?: number, licenseValidator?: LicenseValidator}} options
 * @returns {(req: RewriteReq, res: RewriteRes) => Promise<unknown>}
 */
export function createRewriteHandler({ rateLimiter, runRewrite, env = {}, now = () => Date.now(), logger = console, maxBodyBytes = 65_536, licenseValidator }) {
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

      // Establish the pro license source out-of-band BEFORE contract validation:
      // a pro request MUST carry its license as an Authorization: Bearer header
      // (never a body field, never the provider apiKey). The raw license stays in
      // this handler frame (`bearer.license`); it is never placed on `request`,
      // handed to runRewrite, or logged.
      const bodyTier = body?.tier;
      /** @type {{ok: true, license: string}|{ok: false, status: number, reason: string}|undefined} */
      let bearer;
      /** @type {{proLicenseSource?: string}} */
      let options = {};
      if (bodyTier === WEB_TIERS.PRO) {
        bearer = extractBearerLicense(req.headers || {});
        if (bearer.ok === false) return send(res, bearer.status, { error: bearer.reason });
        options = { proLicenseSource: 'authorization-bearer' };
      }

      const validated = validateRewriteRequest(body, env, options);
      if (!validated.ok) {
        const fail = /** @type {{status: number, error: string}} */ (validated);
        return send(res, fail.status, { error: fail.error });
      }

      const request = validated.value;
      const tier = typeof request.tier === 'string' ? request.tier : '';
      const ip = extractClientIp(req.headers || {});

      // Pro tier: turn the Bearer license into an HMAC subject via LS validate-only.
      // The subject (never the raw license) is what meters pro concurrency/quota.
      // Fail closed if the validator is unwired, or denies/errors (401/403/503).
      let subject;
      if (tier === WEB_TIERS.PRO) {
        if (!licenseValidator || typeof licenseValidator.validate !== 'function') {
          return send(res, 503, { error: QUOTA_REASONS.LICENSE_UNAVAILABLE });
        }
        const ent = await licenseValidator.validate({ licenseKey: /** @type {{ok: true, license: string}} */ (bearer).license });
        if (!ent.ok) {
          const denied = /** @type {{status: number, reason: string}} */ (ent);
          return send(res, denied.status, { error: denied.reason });
        }
        subject = ent.subject;
      }

      // For pro, hand the runner a request whose Authorization header is stripped:
      // the raw Bearer license was already reduced to an HMAC subject above and must
      // never reach the runner (or any log path it might grow). free/byok carry no
      // Authorization, so they pass through unchanged. Cancellation (on/off) still
      // delegates to the real req so 'aborted'/'close' fire normally.
      const runnerReq = tier === WEB_TIERS.PRO ? withoutAuthorization(req) : req;
      // Pro meters a per-license monthly total-character cap in addition to the
      // daily/concurrency caps; pass the request's input length so the limiter
      // can accumulate it. free/byok ignore chars (metered by IP/unmetered).
      const chars = tier === WEB_TIERS.PRO && typeof request.text === 'string' ? request.text.length : 0;
      const quota = await rateLimiter.check({ tier, ip, subject, chars });
      if (!quota.allowed) {
        const denied = /** @type {{status: number, reason: string, remainingMonthlyChars?: number, limitMonthlyChars?: number}} */ (quota);
        const body = /** @type {Record<string, unknown>} */ ({ error: denied.reason });
        if (typeof denied.remainingMonthlyChars === 'number') body.remainingMonthlyChars = denied.remainingMonthlyChars;
        if (typeof denied.limitMonthlyChars === 'number') body.limitMonthlyChars = denied.limitMonthlyChars;
        return send(res, denied.status, body);
      }

      if (typeof rateLimiter.acquireConcurrency !== 'function') {
        // await so a runner rejection is caught by the redacted 500 handler below.
        return await runRewrite({ req: runnerReq, res, request, now });
      }

      const concurrency = await rateLimiter.acquireConcurrency({ tier, ip, subject });
      if (!concurrency.allowed) {
        const denied = /** @type {{status: number, reason: string}} */ (concurrency);
        return send(res, denied.status, { error: denied.reason });
      }

      try {
        // await so a runner rejection is caught by the redacted 500 handler below.
        return await runRewrite({ req: runnerReq, res, request, now });
      } finally {
        await rateLimiter.releaseConcurrency?.({ tier, ip, subject });
      }
    } catch (err) {
      logger.error?.(redactSecrets({ message: String(/** @type {any} */ (err)?.message ?? err) }));
      return send(res, 500, { error: 'internal error' });
    }
  };
}


/**
 * Return a request view with the Authorization header removed, delegating
 * cancellation emitter methods (on/off) to the real request. The pro handler
 * passes this to the runner so the raw Bearer license — already reduced to an
 * HMAC subject — never reaches the rewrite runner or a log path it might add.
 * @param {RewriteReq} req
 * @returns {RewriteReq}
 */
function withoutAuthorization(req) {
  /** @type {Record<string, string|string[]|undefined>} */
  const headers = {};
  for (const [k, v] of Object.entries(req.headers || {})) {
    if (k.toLowerCase() === 'authorization') continue;
    headers[k] = v;
  }
  return {
    method: req.method,
    headers,
    on: typeof req.on === 'function' ? (event, listener) => req.on?.(event, listener) : undefined,
    off: typeof req.off === 'function' ? (event, listener) => req.off?.(event, listener) : undefined,
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
