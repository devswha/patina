// @ts-check

// Server-only Lemon Squeezy License Key entitlement core for the patina Pro tier.
// This module is the revenue gate for the hosted "pro" tier: it turns a
// caller-supplied license key into an allow/deny decision using Lemon Squeezy's
// validate-only endpoint (POST /v1/licenses/validate), fronted by a fail-closed
// admission layer that keeps patina under Lemon Squeezy's 60 req/min ceiling.
//
// Design invariants (all fail-closed — uncertainty NEVER grants entitlement):
//   - Missing config, or (in production) a missing secret/shared-KV, an LS
//     error/timeout/non-2xx/bad-body, a saturated admission bucket, or a held
//     single-flight lock all DENY access.
//   - The raw license key is NEVER written to a log line, an error body, a return
//     value, or a KV key. Every KV key is an HMAC of the license; every return
//     value carries only the HMAC "subject"; every log payload is passed through
//     redactSecrets and only ever carries the subject.
//
// It deliberately reuses the quota primitives (quotaKeyHmac / isProductionPosture /
// createMemoryKv) and the shared redaction/reason contract rather than growing a
// parallel convention. No new runtime dependency: HMAC comes from rate-limit.js,
// fetch from globalThis.fetch (injectable), timeouts from AbortController.

import { createMemoryKv, isProductionPosture, quotaKeyHmac } from './rate-limit.js';
import { QUOTA_REASONS, redactSecrets } from './web-rewrite-contract.js';

/** Lemon Squeezy validate-only endpoint. */
export const LS_LICENSE_VALIDATE_URL = 'https://api.lemonsqueezy.com/v1/licenses/validate';

/** license_key.status values that entitle. Validate-only: an issued-but-inactive key still entitles. */
const USABLE_STATUSES = new Set(['active', 'inactive']);
/** license_key.status values that are explicitly revoked/lapsed. */
const BLOCKED_STATUSES = new Set(['expired', 'disabled']);

/** Default tunables (each overridable via env). */
const DEFAULT_CACHE_TTL_MS = 300_000; // positive-result cache
const DEFAULT_NEGATIVE_CACHE_TTL_MS = 60_000; // negative-result cache
const DEFAULT_TIMEOUT_MS = 2_500; // LS fetch abort deadline
const DEFAULT_VALIDATE_RPM = 50; // stays below LS's hard 60 rpm ceiling
const LOCK_TTL_MS = 10_000; // single-flight lock self-heal window
/** Dev-only HMAC fallback; only ever reached OUTSIDE production (prod requires a real secret). */
const DEV_FALLBACK_SECRET = 'patina-local-license-secret';

/**
 * @typedef {{ok: true, subject: string, tier: 'pro', status: string, cache: 'hit'|'miss'}} EntitlementAllow
 * @typedef {{ok: false, status: 401|403|503, reason: string}} EntitlementDeny
 * @typedef {EntitlementAllow|EntitlementDeny} EntitlementResult
 * @typedef {{get(key: string): Promise<unknown>, set(key: string, val: unknown, options?: {ttlMs?: number}): Promise<void>, incr(key: string, options?: {ttlMs?: number}): Promise<number>, __memory?: boolean}} EntitlementKv
 */

/**
 * Parse a positive integer env value, falling back when absent/invalid/<=0.
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
function readPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/**
 * Extract exactly one `Bearer <token>` license from a request's headers, matching
 * the `authorization` header name case-insensitively (and the scheme
 * case-insensitively, per RFC 7235). Anything ambiguous — absent, blank, a
 * non-Bearer scheme, an empty token, or more than one authorization value — fails
 * closed. Never logs or echoes the raw header/token.
 *
 * @param {Record<string, string|string[]|undefined>|null|undefined} headers
 * @returns {{ok: true, license: string}|{ok: false, status: 401, reason: string}}
 */
export function extractBearerLicense(headers) {
  const missing = /** @type {{ok: false, status: 401, reason: string}} */ (
    { ok: false, status: 401, reason: QUOTA_REASONS.LICENSE_REQUIRED }
  );
  if (!headers || typeof headers !== 'object') return missing;

  // Case-insensitive header lookup. Two distinct authorization keys is ambiguous.
  /** @type {string|string[]|undefined} */
  let raw;
  let seen = 0;
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === 'authorization') {
      raw = value;
      seen += 1;
    }
  }
  if (seen !== 1 || raw === undefined || raw === null) return missing;

  // A header array with more than one value is "multiple" -> ambiguous -> reject.
  let value;
  if (Array.isArray(raw)) {
    if (raw.length !== 1) return missing;
    value = raw[0];
  } else {
    value = raw;
  }
  if (typeof value !== 'string') return missing;

  // Exactly one token: scheme, whitespace, one non-whitespace token, nothing else.
  const match = /^Bearer\s+(\S+)$/i.exec(value.trim());
  if (!match || !match[1]) return missing;
  return { ok: true, license: match[1] };
}

/**
 * Pure allow/deny evaluation of a Lemon Squeezy validate response against the
 * configured store/variant/product. On any failed check the PUBLIC result is a
 * generic 403 LICENSE_INVALID; the specific failing check is exposed only via the
 * non-authoritative `detail` field (for server-side logging — never returned to
 * the client, never contains the license).
 *
 * @param {any} data Parsed LS validate response body.
 * @param {Record<string, string|undefined>} [env]
 * @param {number} [now] Epoch ms used to evaluate expiry.
 * @returns {{ok: true, status: string, expiresAt: number|null}|{ok: false, status: 403, reason: string, detail: string}}
 */
export function evaluateLicenseResponse(data, env = {}, now = Date.now()) {
  const deny = (/** @type {string} */ detail) => (
    /** @type {{ok: false, status: 403, reason: string, detail: string}} */ (
      { ok: false, status: 403, reason: QUOTA_REASONS.LICENSE_INVALID, detail }
    )
  );

  if (!data || typeof data !== 'object') return deny('malformed-response');
  if (data.valid !== true) return deny('not-valid');

  const licenseKey = data.license_key;
  if (!licenseKey || typeof licenseKey !== 'object') return deny('missing-license_key');

  const status = licenseKey.status;
  if (typeof status !== 'string') return deny('status-missing');
  // Both gates are asserted explicitly even though the sets are disjoint: a status
  // in {expired,disabled} is blocked, and only {active,inactive} is entitled.
  if (BLOCKED_STATUSES.has(status)) return deny(`status-${status}`);
  if (!USABLE_STATUSES.has(status)) return deny('status-not-usable');

  // Expiry: absent/null entitles; present must parse to a strictly future instant.
  let expiresAt = /** @type {number|null} */ (null);
  const rawExpiry = licenseKey.expires_at;
  if (rawExpiry !== null && rawExpiry !== undefined) {
    const parsed = Date.parse(rawExpiry);
    if (!Number.isFinite(parsed) || !(parsed > now)) return deny('expired');
    expiresAt = parsed;
  }

  const meta = data.meta;
  if (!meta || typeof meta !== 'object') return deny('missing-meta');
  if (String(meta.store_id) !== String(env.LS_STORE_ID)) return deny('store-mismatch');
  if (String(meta.variant_id) !== String(env.LS_PRO_VARIANT_ID)) return deny('variant-mismatch');
  const wantProduct = env.LS_PRO_PRODUCT_ID;
  if (wantProduct !== undefined && wantProduct !== null && wantProduct !== '') {
    if (String(meta.product_id) !== String(wantProduct)) return deny('product-mismatch');
  }

  return { ok: true, status, expiresAt };
}

/**
 * Validate and interpret a cached decision. The embedded `expiresAt` (epoch ms) is
 * authoritative on read (the KV TTL only reclaims storage): a missing/NaN/past
 * value, or an unrecognized decision shape, is treated as a miss (returns null).
 *
 * @param {unknown} entry
 * @param {number} nowMs
 * @returns {{decision: 'allow', status: string}|{decision: 'deny', status: number, reason: string}|null}
 */
function readCacheEntry(entry, nowMs) {
  if (!entry || typeof entry !== 'object') return null;
  const e = /** @type {Record<string, unknown>} */ (entry);
  const expiresAt = e.expiresAt;
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= nowMs) return null;
  if (e.decision === 'allow' && typeof e.status === 'string') {
    return { decision: 'allow', status: e.status };
  }
  if (e.decision === 'deny' && typeof e.status === 'number' && typeof e.reason === 'string') {
    return { decision: 'deny', status: e.status, reason: e.reason };
  }
  return null;
}

/**
 * Build a fail-closed, validate-only Lemon Squeezy license validator with a
 * two-layer cache (positive + negative) and an admission guard (per-minute RPM
 * bucket + per-license single-flight lock) that runs BEFORE any LS network call.
 *
 * @param {{
 *   kv?: EntitlementKv|null,
 *   hmacSecret?: string,
 *   env?: Record<string, string|undefined>,
 *   fetchImpl?: typeof fetch,
 *   now?: () => number,
 *   logger?: {warn?: (...args: unknown[]) => void, log?: (...args: unknown[]) => void},
 * }} [options]
 * @returns {{validate(input: {licenseKey: string}): Promise<EntitlementResult>}}
 */
export function createLemonSqueezyLicenseValidator({
  kv,
  hmacSecret,
  env = {},
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  logger = console,
} = {}) {
  // Non-production fallback store, created at most once and only when no KV is
  // injected (production already requires a real shared KV below). When a KV is
  // injected this is that same reference.
  const store = kv || createMemoryKv();

  // Base log sink: redactSecrets scrubs secret-named keys and labelled token
  // shapes. Per-request logging additionally routes through `warnSafe` below,
  // which exact-substring-scrubs the current raw license (LS can echo it under an
  // unlabelled/non-secret key that pattern redaction alone would miss).
  const warn = (/** @type {string} */ message, /** @type {Record<string, unknown>} */ meta) => {
    try {
      const fn = logger && (logger.warn || logger.log);
      if (typeof fn === 'function') fn.call(logger, message, redactSecrets(meta));
    } catch {
      /* logging must never throw into the request path */
    }
  };

  const unavailable = () => /** @type {EntitlementDeny} */ (
    { ok: false, status: 503, reason: QUOTA_REASONS.LICENSE_UNAVAILABLE }
  );
  const required = () => /** @type {EntitlementDeny} */ (
    { ok: false, status: 401, reason: QUOTA_REASONS.LICENSE_REQUIRED }
  );

  /**
   * @param {{licenseKey?: string}} [input]
   * @returns {Promise<EntitlementResult>}
   */
  const validate = async (input = {}) => {
    const licenseKey = input.licenseKey;
    // 0. Input guard (defense in depth; the handler extracts via extractBearerLicense first).
    if (typeof licenseKey !== 'string' || licenseKey.trim() === '') return required();

    const production = isProductionPosture(env);

    // 1. Fail-closed prerequisites.
    const configuredSecret = hmacSecret || env.PATINA_LICENSE_HMAC_SECRET || env.PATINA_QUOTA_HMAC_SECRET;
    // A memory KV in production is not a shared store: it cannot enforce the
    // cross-instance admission guard, so treat it as unavailable (mirrors the
    // rate limiter's production KV posture).
    if (production && (!kv || kv.__memory)) return unavailable();
    if (production && !configuredSecret) return unavailable();
    // Config is required in every posture: without store/variant we cannot decide entitlement.
    if (!env.LS_STORE_ID || !env.LS_PRO_VARIANT_ID) return unavailable();

    const secret = configuredSecret || DEV_FALLBACK_SECRET;

    // 2. Derive HMAC keys. The raw license never appears in any key.
    const subject = quotaKeyHmac(secret, 'ls-license-subject', licenseKey);
    const cacheKey = quotaKeyHmac(secret, 'ls-license-cache', licenseKey);
    const nowMs = now();

    // 3. Cache lookup. A broken cache read must NOT fail open; fall through to LS.
    try {
      const hit = readCacheEntry(await store.get(cacheKey), nowMs);
      if (hit) {
        if (hit.decision === 'allow') {
          return { ok: true, subject, tier: 'pro', status: hit.status, cache: 'hit' };
        }
        return /** @type {EntitlementDeny} */ ({ ok: false, status: hit.status, reason: hit.reason });
      }
    } catch {
      /* treat as a miss */
    }

    // 4. Cross-instance single-flight lock FIRST (before the RPM bucket): only
    //    the first caller for a given license proceeds; concurrent callers fail
    //    closed and retry into the cache the winner writes. Acquiring the lock
    //    before charging RPM means a same-license stampede cannot exhaust the
    //    global LS minute budget (only the winner ever charges RPM / calls LS).
    //    A per-process in-flight map would dedupe within ONE process only and is
    //    NOT a substitute for this shared-KV lock across instances.
    const warnSafe = (/** @type {string} */ message, /** @type {Record<string, unknown>} */ meta) =>
      warn(message, /** @type {Record<string, unknown>} */ (scrubLicense(meta, licenseKey)));

    const timeoutMs = readPositiveInt(env.PATINA_LS_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
    // The lock MUST outlive the fetch it guards, or it could self-heal mid-flight
    // and let a second instance call LS. Floor at LOCK_TTL_MS; extend past the
    // fetch deadline when a longer timeout is configured.
    const lockTtlMs = Math.max(LOCK_TTL_MS, timeoutMs + 5_000);
    const lockKey = quotaKeyHmac(secret, 'ls-lock', licenseKey);
    let lockCount;
    try {
      lockCount = await store.incr(lockKey, { ttlMs: lockTtlMs });
    } catch {
      return unavailable();
    }
    if (!Number.isSafeInteger(lockCount) || lockCount < 1) return unavailable();
    if (lockCount > 1) {
      warnSafe('entitlement: LS validate single-flight lock held', { subject, lockCount });
      return unavailable();
    }

    // Winner path: hold the lock; release it on EVERY completion path (cache
    // re-hit, RPM saturation, fetch success/denial/transient failure) so an
    // immediate retry re-validates or hits the freshly written cache. Release
    // resets the counter to 0 via set() (a guaranteed KV op): losers that
    // incremented past 1 never decrement, so a decr-based release would leak the
    // counter upward and wedge the lock. lockTtlMs is only the crash self-heal.
    let lockReleased = false;
    const releaseLock = async () => {
      if (lockReleased) return;
      lockReleased = true;
      try {
        await store.set(lockKey, 0, { ttlMs: lockTtlMs });
      } catch {
        /* best-effort; the TTL self-heals the lock regardless */
      }
    };

    try {
      // 4b. Re-read the cache now that we hold the lock: a previous winner may
      //     have finished (and released the lock) between our miss above and our
      //     lock acquisition. Serving its cached result closes the follower race
      //     that would otherwise make a duplicate LS call.
      try {
        const hit = readCacheEntry(await store.get(cacheKey), nowMs);
        if (hit) {
          if (hit.decision === 'allow') {
            return { ok: true, subject, tier: 'pro', status: hit.status, cache: 'hit' };
          }
          return /** @type {EntitlementDeny} */ ({ ok: false, status: hit.status, reason: hit.reason });
        }
      } catch {
        /* treat as a miss */
      }

      // 4c. Per-minute RPM bucket keeps us under LS's 60 rpm ceiling. Charged
      //     only by the winner that will actually call LS.
      const rpmLimit = readPositiveInt(env.PATINA_LS_VALIDATE_RPM, DEFAULT_VALIDATE_RPM);
      const minute = Math.floor(nowMs / 60_000);
      const rpmKey = quotaKeyHmac(secret, 'ls-rpm', minute);
      let rpmCount;
      try {
        rpmCount = await store.incr(rpmKey, { ttlMs: 60_000 });
      } catch {
        return unavailable();
      }
      if (!Number.isSafeInteger(rpmCount) || rpmCount < 1) return unavailable();
      if (rpmCount > rpmLimit) {
        warnSafe('entitlement: LS validate RPM bucket saturated', { subject, minute, rpmCount, rpmLimit });
        return unavailable();
      }

      // 5. LS validate-only call with a hard timeout.
      const controller = new AbortController();
      const timer = setTimeout(() => {
        try { controller.abort(); } catch { /* noop */ }
      }, timeoutMs);
      let response;
      try {
        response = await fetchImpl(LS_LICENSE_VALIDATE_URL, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new globalThis.URLSearchParams({ license_key: licenseKey }).toString(),
          signal: controller.signal,
        });
      } catch (err) {
        warnSafe('entitlement: LS validate request failed', { subject, error: errorMessage(err) });
        return unavailable();
      } finally {
        clearTimeout(timer);
      }

      if (!response || typeof response.ok !== 'boolean') return unavailable();

      // Non-2xx: LS answers an unknown/malformed key with a 4xx whose body still
      // carries `valid: false` (e.g. 404 "license_key not found"). That is a
      // definitive license verdict, not an outage, so it falls through to the
      // deny path below (403 + negative cache) — treating it as a 503 would break
      // the client contract AND leave every same-key retry re-charging the global
      // LS RPM bucket. A 429 (LS's own rate limit), any 5xx, or a 4xx without a
      // parseable valid:false body stays a transient 503 and is never cached.
      /** @type {any} */
      let data;
      if (!response.ok) {
        const status = response.status;
        const verdictCandidate = typeof status === 'number' && status >= 400 && status < 500 && status !== 429;
        let body = null;
        if (verdictCandidate) {
          try { body = await response.json(); } catch { body = null; }
        }
        if (!body || typeof body !== 'object' || body.valid !== false) {
          warnSafe('entitlement: LS validate non-2xx', { subject, status });
          return unavailable();
        }
        data = body;
      } else {
        try {
          data = await response.json();
        } catch (err) {
          warnSafe('entitlement: LS validate response parse failed', { subject, error: errorMessage(err) });
          return unavailable();
        }
      }

      // 6. Evaluate + cache. A denial is cached negatively (bounded); a transient
      //    503 is NEVER cached so a retry re-attempts validation.
      const decision = evaluateLicenseResponse(data, env, nowMs);

      // `=== true` (not truthiness) so the fall-through below narrows to the deny shape.
      if (decision.ok === true) {
        const posDefault = readPositiveInt(env.PATINA_LS_CACHE_TTL_MS, DEFAULT_CACHE_TTL_MS);
        let ttl = posDefault;
        if (decision.expiresAt !== null && Number.isFinite(decision.expiresAt)) {
          const untilExpiry = decision.expiresAt - nowMs;
          if (untilExpiry > 0) ttl = Math.min(posDefault, untilExpiry);
        }
        // Embedded expiresAt is authoritative on read; KV TTL is only for cleanup.
        await safeSet(store, cacheKey, { decision: 'allow', tier: 'pro', status: decision.status, expiresAt: nowMs + ttl }, ttl, warnSafe, subject);
        return { ok: true, subject, tier: 'pro', status: decision.status, cache: 'miss' };
      }

      const negTtl = readPositiveInt(env.PATINA_LS_NEGATIVE_CACHE_TTL_MS, DEFAULT_NEGATIVE_CACHE_TTL_MS);
      await safeSet(store, cacheKey, { decision: 'deny', tier: 'pro', status: decision.status, reason: decision.reason, expiresAt: nowMs + negTtl }, negTtl, warnSafe, subject);
      // The concrete failing check (plus LS's own error string, if any) is logged
      // for triage; the FULL LS body is never logged — its `meta` carries customer
      // PII (customer_email / customer_name) that secret-name redaction won't catch.
      const lsError = data && typeof data.error === 'string' ? data.error : undefined;
      warnSafe('entitlement: license denied', { subject, detail: decision.detail, error: lsError });
      return /** @type {EntitlementDeny} */ ({ ok: false, status: decision.status, reason: decision.reason });
    } finally {
      await releaseLock();
    }
  };

  return { validate };
}

/**
 * Deep exact-substring scrub of a known raw license from a log payload, applied
 * BEFORE the pattern-based redactSecrets. Lemon Squeezy can echo the license
 * under an unlabelled or non-secret key that pattern redaction alone misses, so
 * we replace the exact value we hold. Guarded on length so trivially short
 * values can't over-redact unrelated text.
 *
 * @param {unknown} value
 * @param {string} license
 * @returns {unknown}
 */
function scrubLicense(value, license) {
  if (typeof license !== 'string' || license.length < 4) return value;
  const walk = (/** @type {unknown} */ v) => {
    if (typeof v === 'string') return v.split(license).join('[REDACTED]');
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      /** @type {Record<string, unknown>} */
      const out = {};
      for (const [k, val] of Object.entries(v)) out[k] = walk(val);
      return out;
    }
    return v;
  };
  return walk(value);
}

/** @param {unknown} err @returns {string} */
function errorMessage(err) {
  if (err && typeof err === 'object' && 'message' in err) return String(/** @type {{message: unknown}} */ (err).message);
  return String(err);
}

/**
 * Best-effort cache write. A caching failure must never fail an otherwise-valid
 * decision, so errors are swallowed after a redacted log.
 * @param {EntitlementKv} store
 * @param {string} key
 * @param {unknown} value
 * @param {number} ttlMs
 * @param {(message: string, meta: Record<string, unknown>) => void} warn
 * @param {string} subject
 * @returns {Promise<void>}
 */
async function safeSet(store, key, value, ttlMs, warn, subject) {
  try {
    await store.set(key, value, { ttlMs });
  } catch (err) {
    warn('entitlement: cache write failed', { subject, error: errorMessage(err) });
  }
}
