// @ts-check

import { timingSafeEqual } from 'node:crypto';

import { byteLength, QUOTA_REASONS, validateRewriteRequest, WEB_TIERS } from './web-rewrite-contract.js';
import { extractClientIp } from './rate-limit.js';
import { extractBearerLicense } from './entitlement.js';
import { sha256 } from './web-rewrite-receipt.js';
import { emitTelemetry, startTelemetryClock } from './web-observability.js';

/**
 * Cancellation contract: `runRewrite` receives the raw `req`/`res`. Runtimes
 * that expose emitter methods let the runner observe client disconnects —
 * `res` emits 'close' (with `writableEnded === false` on a premature
 * disconnect) and legacy `req` emits 'aborted'. All emitter members are
 * optional so bare serverless/test mocks keep working.
 *
 * @typedef {{method?: string, aborted?: boolean, headers?: Record<string, string|string[]|undefined>, rawHeaders?: string[], body?: unknown, on?: (event: string, listener: (...args: unknown[]) => void) => unknown, off?: (event: string, listener: (...args: unknown[]) => void) => unknown, [Symbol.asyncIterator]?: () => AsyncIterator<Buffer|string|Uint8Array>}} RewriteReq
 * @typedef {{statusCode?: number, setHeader?: (name: string, value: string) => void, write?: (chunk: string) => void, end?: (body?: string) => void, on?: (event: string, listener: (...args: unknown[]) => void) => unknown, off?: (event: string, listener: (...args: unknown[]) => void) => unknown, writableEnded?: boolean, headersSent?: boolean, destroyed?: boolean, destroy?: () => void}} RewriteRes
 * @typedef {{check(input: {tier: string, ip: string|null, subject?: string, chars?: number, requestId?: string, synthetic?: boolean}): Promise<{allowed: true, tier: string, reservation?: import('./quota-reservation.js').ReservationPlan}|{allowed: false, status: number, reason: string, remainingMonthlyChars?: number, limitMonthlyChars?: number}>, acquireConcurrency(input: {tier: string, ip: string|null, subject?: string}): Promise<{allowed: true, tier: string, lease: string}|{allowed: false, status: number, reason: string}>, releaseConcurrency(input: {tier: string, ip: string|null, subject?: string, lease: string}): Promise<void>, settleReservation?(input: {reservation: import('./quota-reservation.js').ReservationPlan, refund: boolean}): Promise<boolean>}} RateLimiter
 * @typedef {{req: RewriteReq, res: RewriteRes, request: import('./web-rewrite-contract.js').WebRewriteRequest, now: () => number, observe?: Function, beforeResponseEnd?: (outcome?: {ok?: boolean, code?: string}) => Promise<void>}} RewriteRunnerInput
 * @typedef {{validate(input: {licenseKey: string, ip?: string|null}): Promise<{ok: true, subject: string, tier: string, status: string, cache: string}|{ok: false, status: number, reason: string}>}} LicenseValidator
 */

/**
 * Create the /api/rewrite handler shell around an injected rewrite runner.
 *
 * The default `maxBodyBytes` (256 KiB) must exceed the worst valid contract
 * payload: 2 × 20K CJK characters (~120 KiB), 12 KiB history, and JSON
 * overhead. Field caps remain enforced by validateRewriteRequest; this
 * envelope only bounds abusive requests.
 *
 * @param {{rateLimiter: RateLimiter, runRewrite: (input: RewriteRunnerInput) => unknown, env?: Record<string, string|undefined>, now?: () => number, logger?: {error?: (...args: unknown[]) => void}, maxBodyBytes?: number, licenseValidator?: LicenseValidator, observe?: (input: {tier: string, outcome: string, status: number, latencyMs: number, totalTokens?: number, llmCalls?: number}) => unknown}} options
 * @returns {(req: RewriteReq, res: RewriteRes) => Promise<unknown>}
 */
export function createRewriteHandler({ rateLimiter, runRewrite, env = {}, now = () => Date.now(), logger = console, maxBodyBytes = 256 * 1024, licenseValidator, observe }) {
  if (typeof runRewrite !== 'function') throw new TypeError('runRewrite must be a function');
  if (!rateLimiter || typeof rateLimiter.check !== 'function'
    || typeof rateLimiter.acquireConcurrency !== 'function' || typeof rateLimiter.releaseConcurrency !== 'function') {
    throw new TypeError('rateLimiter must implement check, acquireConcurrency and releaseConcurrency');
  }
  /** @param {string} reason */
  const limiterOutcome = (reason) => reason === QUOTA_REASONS.SERVICE_UNAVAILABLE ? 'service_disabled' : 'quota_denied';
  /** @param {number} status @param {string} reason */
  const entitlementOutcome = (status, reason) => {
    if (status === 503 || reason === QUOTA_REASONS.LICENSE_UNAVAILABLE) return 'entitlement_unavailable';
    // The validator's own admission guard denies per client, not per license:
    // report it as the quota denial it is, exactly like the limiter's.
    if (status === 429 || reason === QUOTA_REASONS.IP_UNAVAILABLE) return 'quota_denied';
    return 'entitlement_denied';
  };


  return async function rewriteHandler(req, res) {
    const synthetic = isTrustedSynthetic(req.headers || {}, env);
    const customerObserve = synthetic ? undefined : observe;
    const elapsed = typeof customerObserve === 'function' ? startTelemetryClock(now) : undefined;
    /** Closed telemetry is best-effort and never alters a customer response. */
    const observeClosed = (/** @type {string} */ tier, /** @type {string} */ outcome, /** @type {number} */ status) => {
      const latencyMs = elapsed?.();
      if (latencyMs !== undefined) emitTelemetry(/** @type {Function} */ (customerObserve), { tier, outcome, status, latencyMs });
    };
    let clientClosed = req.aborted === true || (res.destroyed === true && !res.writableEnded);
    const isClientClosed = () => clientClosed || req.aborted === true || (res.destroyed === true && !res.writableEnded);
    const onAbort = () => { clientClosed = true; };
    const onClose = () => { if (!res.writableEnded) clientClosed = true; };
    setSecurityHeaders(res);
    try {
      req.on?.('aborted', onAbort); res.on?.('close', onClose);
      if (isClientClosed()) return undefined;
      if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        res.end?.();
        return undefined;
      }
      if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });

      const rawBody = await readRawBody(req, maxBodyBytes);
      if (rawBody === UNPARSEABLE_BODY) return send(res, 400, { error: 'invalid JSON' });
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
        if (Array.isArray(req.rawHeaders) && !hasExactlyOneAuthorizationHeader(req.rawHeaders)) {
          observeClosed(WEB_TIERS.PRO, 'entitlement_denied', 401);
          return send(res, 401, { error: QUOTA_REASONS.LICENSE_REQUIRED });
        }
        bearer = extractBearerLicense(req.headers || {});
        if (bearer.ok === false) {
          observeClosed(WEB_TIERS.PRO, 'entitlement_denied', bearer.status);
          return send(res, bearer.status, { error: bearer.reason });
        }
        options = { proLicenseSource: 'authorization-bearer' };
      }

      const validated = validateRewriteRequest(body, env, options);
      if (!validated.ok) {
        const fail = /** @type {{status: number, error: string}} */ (validated);
        if (
          fail.status === 503
          && (bodyTier === WEB_TIERS.FREE || bodyTier === WEB_TIERS.BYOK || bodyTier === WEB_TIERS.PRO)
        ) {
          observeClosed(bodyTier, 'service_disabled', 503);
        }
        return send(res, fail.status, { error: fail.error });
      }

      const request = validated.value;
      // Reject a stale source before quota admission or a streaming START, so
      // JSON and NDJSON callers both receive the same HTTP conflict status.
      if (request.baseHash !== undefined && request.baseHash !== sha256(request.original)) {
        return send(res, 409, { code: 'source_changed', error: 'source_changed' });
      }
      const tier = typeof request.tier === 'string' ? request.tier : '';
      const ip = extractClientIp(req.headers || {});

      // Pro tier: turn the Bearer license into an HMAC subject via Polar license validation.
      // The subject (never the raw license) is what meters pro concurrency/quota.
      // The client IP goes along so the validator can admit per caller before it
      // spends the shared provider budget on an uncached key; it is HMAC'd there
      // and never stored raw. Fail closed if the validator is unwired, or
      // denies/errors (400/401/403/429/503).
      let subject;
      if (tier === WEB_TIERS.PRO) {
        if (!licenseValidator || typeof licenseValidator.validate !== 'function') {
          observeClosed(tier, 'entitlement_unavailable', 503);
          return send(res, 503, { error: QUOTA_REASONS.LICENSE_UNAVAILABLE });
        }
        let ent;
        try {
          ent = await licenseValidator.validate({ licenseKey: /** @type {{ok: true, license: string}} */ (bearer).license, ip });
        } catch (err) {
          observeClosed(tier, 'entitlement_unavailable', 500);
          throw err;
        }
        if (!ent.ok) {
          const denied = /** @type {{status: number, reason: string}} */ (ent);
          observeClosed(tier, entitlementOutcome(denied.status, denied.reason), denied.status);
          return send(res, denied.status, { error: denied.reason });
        }
        subject = ent.subject;
      }

      // For pro, hand the runner a request whose Authorization header is stripped:
      // the raw Bearer license was already reduced to an HMAC subject above and must
      // never reach the runner (or any log path it might grow). free/byok carry no
      // Authorization, so they pass through unchanged. Cancellation (on/off) still
      // delegates to the real req so 'aborted'/'close' fire normally.
      const runnerReq = withoutSensitiveHeaders(req);
      // Pro meters a per-license monthly total-character cap in addition to the
      // daily/concurrency caps; pass the request's input length so the limiter
      // can accumulate it. Free/BYOK ignore chars; both meter requests by IP.
      const chars = tier === WEB_TIERS.PRO && typeof request.text === 'string' ? request.text.length : 0;
      // The monitor's paid probe runs ~24x a day, which would exhaust a seat's
      // monthly request allowance within days. It is exempted from MONTHLY
      // metering only, and only when BOTH server-side facts hold: the trusted
      // observer marker (a header the boundary strips, never a body field) and
      // a license the validator accepted into a subject. Daily cap,
      // concurrency lease and license validation stay fully in force.
      const trustedSyntheticProbe = synthetic && tier === WEB_TIERS.PRO && typeof subject === 'string' && subject !== '';

      /** @param {{status: number, reason: string, remainingMonthlyChars?: number, limitMonthlyChars?: number}} denied */
      const sendQuotaDenied = (denied) => {
        observeClosed(tier, limiterOutcome(denied.reason), denied.status);
        const body = /** @type {Record<string, unknown>} */ ({ error: denied.reason });
        if (typeof denied.remainingMonthlyChars === 'number') body.remainingMonthlyChars = denied.remainingMonthlyChars;
        if (typeof denied.limitMonthlyChars === 'number') body.limitMonthlyChars = denied.limitMonthlyChars;
        return send(res, denied.status, body);
      };

      if (isClientClosed()) return undefined;

      // Reserve concurrency before allowance. Pro uses an atomic charge receipt
      // so a rejected server rewrite can restore usage exactly once.
      const concurrency = await rateLimiter.acquireConcurrency({ tier, ip, subject });
      if (!concurrency.allowed) {
        const denied = /** @type {{status: number, reason: string}} */ (concurrency);
        observeClosed(tier, limiterOutcome(denied.reason), denied.status);
        return send(res, denied.status, { error: denied.reason });
      }
      if (typeof concurrency.lease !== 'string' || concurrency.lease === '') {
        observeClosed(tier, 'quota_denied', 503);
        return send(res, 503, { error: QUOTA_REASONS.STORAGE_UNAVAILABLE });
      }

      /** @type {Promise<void> | undefined} */
      let releasePromise;
      const releaseSlot = () => {
        releasePromise ??= rateLimiter.releaseConcurrency({ tier, ip, subject, lease: concurrency.lease });
        return releasePromise;
      };
      try {
        if (isClientClosed()) return undefined;
        const refundable = tier === WEB_TIERS.PRO && typeof rateLimiter.settleReservation === 'function';
        const quota = await rateLimiter.check({ tier, ip, subject, chars, ...(refundable ? { requestId: concurrency.lease } : {}), ...(trustedSyntheticProbe ? { synthetic: true } : {}) });
        if (!quota.allowed) {
          await releaseSlot();
          return sendQuotaDenied(/** @type {{status: number, reason: string}} */ (quota));
        }
        if (refundable && !quota.reservation) return send(res, 503, { error: QUOTA_REASONS.STORAGE_UNAVAILABLE });
        let settlement;
        const beforeResponseEnd = async (outcome) => {
          try {
            if (quota.reservation && rateLimiter.settleReservation) {
              settlement ??= rateLimiter.settleReservation({ reservation: quota.reservation,
                refund: outcome?.ok === false && outcome?.code !== 'client_closed' && !isClientClosed() });
              await settlement;
            }
          } finally { await releaseSlot(); }
        };
        if (isClientClosed()) { await beforeResponseEnd({ ok: false, code: 'client_closed' }); return undefined; }
        // Runners that finalize a serverless response must await this hook before
        // res.end(); the finally below retains compatibility with injected runners
        // that do not use it and covers thrown paths.
        try {
          const result = await runRewrite({ req: runnerReq, res, request, now, observe: customerObserve, beforeResponseEnd });
          await beforeResponseEnd(result);
          return result;
        } catch (error) {
          await beforeResponseEnd({ ok: false, code: res.destroyed ? 'client_closed' : 'runner_failed' });
          throw error;
        }
      } finally {
        await releaseSlot();
      }
    } catch {
      logger.error?.({ code: 'rewrite_handler_failed', stage: 'handler' });
      if (isClientClosed()) return undefined;
      return send(res, 500, { error: 'internal error' });
    } finally {
      req.off?.('aborted', onAbort); res.off?.('close', onClose);
    }
  };
}


/**
 * IncomingMessage.headers collapses duplicate Authorization fields, so use the
 * raw wire pairs when the runtime exposes them.
 * @param {string[]} rawHeaders
 */
function hasExactlyOneAuthorizationHeader(rawHeaders) {
  let count = 0;
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (typeof rawHeaders[index] === 'string' && rawHeaders[index].toLowerCase() === 'authorization') count += 1;
  }
  return count === 1;
}
/**
 * True only for an exact, server-configured internal marker. The marker is
 * removed from every runner request, including invalid attempts, so it cannot
 * reach a provider, stream frame, log, or KV key. The comparison is constant
 * time (a length mismatch is rejected before it) because this marker is one of
 * the two facts that exempt the monitor's probe from monthly metering.
 * @param {Record<string, string|string[]|undefined>} headers
 * @param {Record<string, string|undefined>} env
 */
function isTrustedSynthetic(headers, env) {
  const secret = env.PATINA_SYNTHETIC_OBSERVER_SECRET;
  if (typeof secret !== 'string' || secret.length === 0) return false;
  const values = Object.entries(headers).filter(([key]) => key.toLowerCase() === 'x-patina-synthetic-observer');
  if (values.length !== 1 || typeof values[0][1] !== 'string') return false;
  const provided = Buffer.from(values[0][1], 'utf8');
  const wanted = Buffer.from(secret, 'utf8');
  return provided.length === wanted.length && timingSafeEqual(provided, wanted);
}

/**
 * Return a request view with sensitive server-only headers removed, delegating
 * cancellation emitter methods (on/off) to the real request.
 * @param {RewriteReq} req
 * @returns {RewriteReq}
 */
function withoutSensitiveHeaders(req) {
  /** @type {Record<string, string|string[]|undefined>} */
  const headers = {};
  for (const [k, v] of Object.entries(req.headers || {})) {
    const lower = k.toLowerCase();
    if (lower === 'authorization' || lower === 'x-patina-synthetic-observer') continue;
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
  setCorsHeaders(res);
}

/** @param {RewriteRes} res */
function setCorsHeaders(res) {
  res.setHeader?.('Access-Control-Allow-Origin', '*');
  res.setHeader?.('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader?.('Access-Control-Allow-Methods', 'POST, OPTIONS');
}

/**
 * @param {RewriteRes} res
 * @param {number} status
 * @param {unknown} obj
 * @returns {undefined}
 */
function send(res, status, obj) {
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
  setCorsHeaders(res);
  res.end?.(JSON.stringify(obj));
  return undefined;
}

const UNPARSEABLE_BODY = Symbol('unparseable-body');

/**
 * Read a request body. Returns null when the max byte cap is exceeded, and
 * UNPARSEABLE_BODY when the platform already rejected the bytes as JSON.
 *
 * @param {RewriteReq} req
 * @param {number} maxBodyBytes
 * @returns {Promise<string|null|typeof UNPARSEABLE_BODY>}
 */
async function readRawBody(req, maxBodyBytes) {
  // Vercel's Node helper exposes `body` as a lazy getter that parses JSON on
  // first access and THROWS on malformed input. Unguarded, that throw reached
  // the handler's outer catch: production answered 500 "internal error" and
  // logged rewrite_handler_failed for what is a plain client error.
  let preParsed;
  try {
    preParsed = req.body;
  } catch {
    return UNPARSEABLE_BODY;
  }
  if (typeof preParsed === 'string') return byteLength(preParsed) > maxBodyBytes ? null : preParsed;
  if (preParsed != null) {
    const serialized = JSON.stringify(preParsed);
    return byteLength(serialized) > maxBodyBytes ? null : serialized;
  }

  let raw = '';
  let rawBytes = 0;
  if (typeof req[Symbol.asyncIterator] !== 'function') return '';
  const encoder = new globalThis.TextEncoder();
  const decoder = new globalThis.TextDecoder();
  const stream = /** @type {AsyncIterable<Buffer|string|Uint8Array>} */ (/** @type {unknown} */ (req));
  for await (const chunk of stream) {
    const bytes = typeof chunk === 'string' ? encoder.encode(chunk) : chunk;
    rawBytes += bytes.byteLength;
    if (rawBytes > maxBodyBytes) return null;
    // HTTP chunks may split a multi-byte CJK code point. Streaming decode keeps
    // incomplete UTF-8 bytes until the next chunk instead of inserting U+FFFD
    // and corrupting otherwise-valid JSON.
    raw += decoder.decode(bytes, { stream: true });
  }
  raw += decoder.decode();
  return raw;
}
