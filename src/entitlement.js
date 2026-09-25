// @ts-check

// Server-only provider-agnostic license entitlement core for the patina Pro tier.
// This revenue gate turns a caller-supplied license key into a fail-closed
// allow/deny decision through a provider descriptor. Polar is the current
// provider; this module owns the shared admission, cache, and security rules.
//
// Design invariants (all fail-closed — uncertainty NEVER grants entitlement):
//   - Missing config, or (in production) a missing secret/shared-KV/client IP, a
//     provider error/timeout/non-2xx/bad-body, a saturated admission bucket, or a
//     held single-flight lock all DENY access.
//   - Admission is charged per CLIENT before the shared provider budget, so one
//     caller can only ever spend a small slice of it; a cached decision charges
//     neither bucket.
//   - The raw license key is NEVER written to a log line, an error body, a return
//     value, or a KV key, and neither is the client IP. Every KV key is an HMAC;
//     every return value carries only the HMAC "subject"; every log payload is
//     passed through redactSecrets and only ever carries the subject.
//
// It deliberately reuses the quota primitives (quotaKeyHmac / createMemoryKv),
// the shared production posture, and the shared redaction/reason contract
// rather than growing a parallel convention. No new runtime dependency: HMAC
// comes from rate-limit.js, fetch from globalThis.fetch (injectable), timeouts
// from AbortController.

import { randomBytes } from 'node:crypto';
import { createMemoryKv, quotaKeyHmac } from './rate-limit.js';
import { isProductionPosture, QUOTA_REASONS, redactSecrets } from './web-rewrite-contract.js';

/** Default tunables (each overridable via env). */
const DEFAULT_CACHE_TTL_MS = 300_000; // positive-result cache
const DEFAULT_NEGATIVE_CACHE_TTL_MS = 60_000; // negative-result cache
const DEFAULT_TIMEOUT_MS = 2_500; // provider fetch abort deadline
const LOCK_TTL_MS = 10_000; // single-flight lock self-heal window
const DEFAULT_LOCK_POLL_INTERVAL_MS = 150; // follower cache-poll cadence while the winner validates
/**
 * Provider calls one client may trigger per minute (its slice of the shared
 * per-minute provider budget). Deliberately a small fraction of `defaultRpm`:
 * the positive cache means one seat validates about once per cache TTL, so a
 * real customer never approaches it, while a single caller can no longer drain
 * the shared budget and lock every other subject out of validation.
 */
const DEFAULT_VALIDATE_IP_RPM = 3;
/** Dev-only HMAC fallback; only ever reached OUTSIDE production (prod requires a real secret). */
const DEV_FALLBACK_SECRET = 'patina-local-license-secret';

/**
 * @typedef {{ok: true, subject: string, tier: 'pro', status: string, cache: 'hit'|'miss'}} EntitlementAllow
 * @typedef {{ok: false, status: 400|401|403|429|503, reason: string}} EntitlementDeny
 * @typedef {EntitlementAllow|EntitlementDeny} EntitlementResult
 * @typedef {{get(key: string): Promise<unknown>, set(key: string, val: unknown, options?: {ttlMs?: number}): Promise<void>, incr(key: string, options?: {ttlMs?: number}): Promise<number>, acquireLease?(registryKey: string, lease: string, maxConcurrent: number, options: {ttlMs: number}): Promise<boolean>, releaseLease?(registryKey: string, lease: string): Promise<boolean>, __memory?: boolean}} EntitlementKv
 */

/**
 * Parse a positive integer env value, falling back when absent/invalid/<=0.
 * @param {unknown} value
 * @param {number} fallback
 * @returns {number}
 */
export function readPositiveInt(value, fallback) {
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
 * Provider descriptor: the ONLY parts of the entitlement gate that differ
 * between license vendors. Everything else in `createLicenseValidator` —
 * HMAC subjects, the two-layer cache, the cross-instance single-flight lock,
 * the RPM admission bucket, timeout handling, redaction, and the fail-closed
 * defaults — is vendor-independent and must never be duplicated per provider.
 *
 * @typedef {object} LicenseProvider
 * @property {string} id Short namespace for HMAC key prefixes and env names. Changing it invalidates cached decisions, which is intended on a provider switch.
 * @property {(env: Record<string, string|undefined>) => string} url Validate endpoint.
 * @property {(env: Record<string, string|undefined>) => boolean} configured Whether the entitlement-deciding config is present; false fails closed.
 * @property {(license: string, env: Record<string, string|undefined>) => {headers: Record<string,string>, body: string}} request Request headers and serialized body.
 * @property {(status: number, body: any) => boolean} isDefinitiveDenial Whether a non-2xx answer is a license verdict rather than an outage.
 * @property {(data: any, env: Record<string, string|undefined>, now: number) => {ok: true, status: string, expiresAt: number|null}|{ok: false, status: 403, reason: string, detail: string}} evaluate
 * @property {number} defaultRpm Per-minute admission ceiling when unconfigured.
 * @property {(data: any) => string|undefined} [errorText] Vendor error string for triage logging; must never return PII.
 */

/**
 * Build a fail-closed, validate-only license validator with a two-layer cache
 * (positive + negative) and an admission guard (per-client and shared
 * per-minute RPM buckets + per-license single-flight lock) that runs BEFORE any
 * provider network call.
 *
 * The vendor-specific surface is supplied as a `provider` descriptor; this
 * function holds the security machinery that must stay identical across
 * vendors rather than being duplicated per integration.
 *
 * @param {{
 *   provider: LicenseProvider,
 *   kv?: EntitlementKv|null,
 *   hmacSecret?: string,
 *   env?: Record<string, string|undefined>,
 *   fetchImpl?: typeof fetch,
 *   now?: () => number,
 *   logger?: {warn?: (...args: unknown[]) => void, log?: (...args: unknown[]) => void},
 * }} [options]
 * @returns {{validate(input: {licenseKey: string, ip?: string|null}): Promise<EntitlementResult>}}
 */
export function createLicenseValidator({
  provider,
  kv,
  hmacSecret,
  env = {},
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  logger = console,
} = /** @type {any} */ ({})) {
  if (!provider) throw new TypeError('provider is required');
  // Tunable env names are namespaced per provider so a vendor switch cannot
  // silently inherit another provider's settings.
  const tunable = (/** @type {string} */ name) => env[`PATINA_${provider.id.toUpperCase()}_${name}`];
  // Non-production fallback store, created at most once and only when no KV is
  // injected (production already requires a real shared KV below). When a KV is
  // injected this is that same reference.
  const store = kv || createMemoryKv();

  // Base log sink: redactSecrets scrubs secret-named keys and labelled token
  // shapes. Per-request logging additionally routes through `warnSafe` below,
  // which exact-substring-scrubs the current raw license (a provider can echo it under an
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
   * `ip` is the caller's address as resolved from the platform's trusted
   * forwarded-for header (never a client-supplied one); it exists only to key
   * the per-client admission slice below and is HMAC'd before it touches KV.
   *
   * @param {{licenseKey?: string, ip?: string|null}} [input]
   * @returns {Promise<EntitlementResult>}
   */
  const validate = async (input = {}) => {
    const licenseKey = input.licenseKey;
    const ip = typeof input.ip === 'string' && input.ip !== '' ? input.ip : null;
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
    if (!provider.configured(env)) return unavailable();

    const secret = configuredSecret || DEV_FALLBACK_SECRET;

    // 2. Derive HMAC keys. The raw license never appears in any key.
    const subject = quotaKeyHmac(secret, `${provider.id}-license-subject`, licenseKey);
    const cacheKey = quotaKeyHmac(secret, `${provider.id}-license-cache`, licenseKey);
    const nowMs = now();
    /**
     * @param {NonNullable<ReturnType<typeof readCacheEntry>>} hit
     * @returns {EntitlementResult}
     */
    const fromCache = (hit) => (hit.decision === 'allow'
      ? { ok: true, subject, tier: 'pro', status: hit.status, cache: 'hit' }
      : /** @type {EntitlementDeny} */ ({ ok: false, status: hit.status, reason: hit.reason }));

    // 3. Cache lookup. A broken cache read must NOT fail open; fall through to the provider.
    try {
      const hit = readCacheEntry(await store.get(cacheKey), nowMs);
      if (hit) return fromCache(hit);
    } catch {
      /* treat as a miss */
    }

    // 4. Cross-instance single-flight lock FIRST (before the RPM bucket): only
    //    the first caller for a given license proceeds; concurrent callers fail
    //    closed and retry into the cache the winner writes. Acquiring the lock
    //    before charging RPM means a same-license stampede cannot exhaust the
    //    global provider minute budget (only the winner ever charges RPM / calls it).
    //    A per-process in-flight map would dedupe within ONE process only and is
    //    NOT a substitute for this shared-KV lock across instances.
    const warnSafe = (/** @type {string} */ message, /** @type {Record<string, unknown>} */ meta) =>
      warn(message, /** @type {Record<string, unknown>} */ (scrubLicense(meta, licenseKey)));

    const timeoutMs = readPositiveInt(tunable('TIMEOUT_MS'), DEFAULT_TIMEOUT_MS);
    // The lock MUST outlive the fetch it guards, or it could self-heal mid-flight
    // and let a second instance call the provider. Floor at LOCK_TTL_MS; extend past the
    // fetch deadline when a longer timeout is configured.
    const lockTtlMs = Math.max(LOCK_TTL_MS, timeoutMs + 5_000);
    // A 1-slot ZSET lease, never a counter: followers must not touch the
    // registry, or their retries would keep re-arming a crashed winner's
    // expiry and wedge the license at 503. The lease token is the owner, only
    // the owner's member can be released, and per-member expiry self-heals
    // after lockTtlMs. The -sflight suffix keeps it off the old counter key.
    const lockRegistry = quotaKeyHmac(secret, `${provider.id}-sflight`, licenseKey);
    const lockOwner = randomBytes(32).toString('base64url');
    if (typeof store.acquireLease !== 'function' || typeof store.releaseLease !== 'function') return unavailable();
    let lockAcquired;
    try {
      lockAcquired = await store.acquireLease(lockRegistry, lockOwner, 1, { ttlMs: lockTtlMs });
    } catch {
      return unavailable();
    }
    // A degraded adapter must fail closed here, exactly like the counter lock:
    // anything but a clean boolean is storage failure, never a follower signal.
    if (lockAcquired !== true && lockAcquired !== false) return unavailable();
    if (lockAcquired === false) {
      // Follower path: the winner is validating this SAME license right now and
      // writes the cache when it finishes (typically well under timeoutMs). An
      // instant 503 here would break the advertised concurrency for a license's
      // first burst — right after purchase, or whenever the positive cache TTL
      // lapses — so followers briefly poll the cache instead. The loop
      // is bounded by ITERATION COUNT, never the wall clock, so an injected or
      // frozen `now` cannot spin it forever; when the winner crashed or the provider is
      // down, nothing gets cached and this stays fail-closed 503. The follower
      // does NOT touch the lock registry (see the owner-token note above).
      const pollIntervalMs = readPositiveInt(tunable('LOCK_POLL_INTERVAL_MS'), DEFAULT_LOCK_POLL_INTERVAL_MS);
      const lockWaitMs = readPositiveInt(tunable('LOCK_WAIT_MS'), Math.min(lockTtlMs, timeoutMs + 1_000));
      const attempts = Math.max(1, Math.ceil(lockWaitMs / pollIntervalMs));
      for (let i = 0; i < attempts; i += 1) {
        await sleep(pollIntervalMs);
        try {
          const hit = readCacheEntry(await store.get(cacheKey), now());
          if (hit) return fromCache(hit);
        } catch {
          /* a broken cache read never fails open; keep polling */
        }
      }
      warnSafe('entitlement: provider validate single-flight lock held', { subject });
      return unavailable();
    }

    // Winner path: hold the lease; release it on EVERY completion path (cache
    // re-hit, RPM saturation, fetch success/denial/transient failure) so an
    // immediate retry re-validates or hits the freshly written cache. Release
    // removes THIS owner's member only (compare-by-member): a follower that
    // acquired after our TTL lapse is never evicted. lockTtlMs is the crash
    // self-heal and, unlike the old counter, cannot be re-armed by followers.
    let lockReleased = false;
    const releaseLock = async () => {
      if (lockReleased) return;
      lockReleased = true;
      try {
        await store.releaseLease(lockRegistry, lockOwner);
      } catch {
        /* best-effort; the per-member TTL self-heals the lock regardless */
      }
    };

    try {
      // 4b. Re-read the cache now that we hold the lock: a previous winner may
      //     have finished (and released the lock) between our miss above and our
      //     lock acquisition. Serving its cached result closes the follower race
      //     that would otherwise make a duplicate provider call.
      try {
        const hit = readCacheEntry(await store.get(cacheKey), nowMs);
        if (hit) return fromCache(hit);
      } catch {
        /* treat as a miss */
      }

      // 4c. Per-CLIENT admission slice, charged BEFORE the shared bucket below.
      //     Every cache-missing key, entitled or not, would otherwise spend a
      //     token of the single global provider budget, so a handful of
      //     unauthenticated requests could leave paying customers whose cache
      //     lapsed with nothing but 503s. Charging the caller first caps what
      //     any one of them can take out of that shared budget.
      //
      //     Only the single-flight WINNER reaches this point, so neither a
      //     cached decision (steps 3/4b) nor a follower is ever charged: an
      //     already-validated customer cannot be throttled by this guard.
      const minute = Math.floor(nowMs / 60_000);
      if (ip === null) {
        // Production always has a platform-set forwarded-for header, so a
        // missing address there means we cannot admit this caller — fail closed
        // rather than fall through to the shared budget unmetered (the free and
        // BYOK tiers refuse the same way in src/rate-limit.js). Outside
        // production there is no shared budget worth defending and local callers
        // legitimately have no forwarded address, so admission continues.
        if (production) {
          warnSafe('entitlement: validate admission without a client ip', { provider: provider.id, subject });
          return /** @type {EntitlementDeny} */ ({ ok: false, status: 400, reason: QUOTA_REASONS.IP_UNAVAILABLE });
        }
      } else {
        const ipRpmLimit = readPositiveInt(tunable('VALIDATE_IP_RPM'), DEFAULT_VALIDATE_IP_RPM);
        // Own label, so this bucket can never collide with the shared one; the
        // address is HMAC'd exactly like a license and is never stored raw.
        const ipRpmKey = quotaKeyHmac(secret, `${provider.id}-validate-ip-rpm`, minute, ip);
        let ipCount;
        try {
          ipCount = await store.incr(ipRpmKey, { ttlMs: 60_000 });
        } catch {
          return unavailable();
        }
        if (!Number.isSafeInteger(ipCount) || ipCount < 1) return unavailable();
        if (ipCount > ipRpmLimit) {
          // A rate-limit verdict about the CALLER, never about the key: the
          // decision is not cached (a negative entry would turn a throttled
          // customer's valid license into a 403 for the whole negative TTL), the
          // shared bucket below is untouched, and the provider is never called.
          // A same-license follower polling right now finds no cache entry and
          // ends on its own 503; that costs only a cold-cache burst arriving
          // from one address within the same minute.
          warnSafe('entitlement: validate per-client admission saturated', { provider: provider.id, subject, minute, ipCount, ipRpmLimit });
          return /** @type {EntitlementDeny} */ ({ ok: false, status: 429, reason: QUOTA_REASONS.LICENSE_VALIDATION_BURST });
        }
      }

      // 4d. Shared per-minute RPM bucket keeps us under the provider's ceiling.
      //     Charged only by the winner that will actually call the provider.
      const rpmLimit = readPositiveInt(tunable('VALIDATE_RPM'), provider.defaultRpm);
      const rpmKey = quotaKeyHmac(secret, `${provider.id}-rpm`, minute);
      let rpmCount;
      try {
        rpmCount = await store.incr(rpmKey, { ttlMs: 60_000 });
      } catch {
        return unavailable();
      }
      if (!Number.isSafeInteger(rpmCount) || rpmCount < 1) return unavailable();
      if (rpmCount > rpmLimit) {
        warnSafe('entitlement: validate RPM bucket saturated', { provider: provider.id, subject, minute, rpmCount, rpmLimit });
        return unavailable();
      }

      // 5. Validate-only call with a hard timeout.
      const controller = new AbortController();
      const timer = setTimeout(() => {
        try { controller.abort(); } catch { /* noop */ }
      }, timeoutMs);
      let response;
      try {
        const built = provider.request(licenseKey, env);
        response = await fetchImpl(provider.url(env), {
          method: 'POST',
          headers: built.headers,
          body: built.body,
          signal: controller.signal,
        });
      } catch (err) {
        warnSafe('entitlement: validate request failed', { provider: provider.id, subject, error: errorMessage(err) });
        return unavailable();
      } finally {
        clearTimeout(timer);
      }

      if (!response || typeof response.ok !== 'boolean') return unavailable();

      // Non-2xx: some answers are a definitive license verdict rather than an
      // outage. A verdict falls through to the deny path below
      // (403 + negative cache) — treating it as a 503 would break the client
      // contract AND leave every same-key retry re-charging the provider's
      // rate budget. Anything the provider does not call definitive stays a
      // transient 503 and is never cached.
      /** @type {any} */
      let data;
      if (!response.ok) {
        const status = response.status;
        // Only 4xx bodies are worth parsing for a verdict; a 5xx body is an
        // outage payload and parsing it would just waste the deadline.
        let body = null;
        if (typeof status === 'number' && status >= 400 && status < 500) {
          try { body = await response.json(); } catch { body = null; }
        }
        if (!provider.isDefinitiveDenial(status, body)) {
          warnSafe('entitlement: validate non-2xx', { provider: provider.id, subject, status });
          return unavailable();
        }
        data = body;
      } else {
        try {
          data = await response.json();
        } catch (err) {
          warnSafe('entitlement: provider validate response parse failed', { subject, error: errorMessage(err) });
          return unavailable();
        }
      }

      // 6. Evaluate + cache. A denial is cached negatively (bounded); a transient
      //    503 is NEVER cached so a retry re-attempts validation.
      const decision = provider.evaluate(data, env, nowMs);

      // `=== true` (not truthiness) so the fall-through below narrows to the deny shape.
      if (decision.ok === true) {
        const posDefault = readPositiveInt(tunable('CACHE_TTL_MS'), DEFAULT_CACHE_TTL_MS);
        let ttl = posDefault;
        if (decision.expiresAt !== null && Number.isFinite(decision.expiresAt)) {
          const untilExpiry = decision.expiresAt - nowMs;
          if (untilExpiry > 0) ttl = Math.min(posDefault, untilExpiry);
        }
        // Embedded expiresAt is authoritative on read; KV TTL is only for cleanup.
        await safeSet(store, cacheKey, { decision: 'allow', tier: 'pro', status: decision.status, expiresAt: nowMs + ttl }, ttl, warnSafe, subject);
        return { ok: true, subject, tier: 'pro', status: decision.status, cache: 'miss' };
      }

      const negTtl = readPositiveInt(tunable('NEGATIVE_CACHE_TTL_MS'), DEFAULT_NEGATIVE_CACHE_TTL_MS);
      await safeSet(store, cacheKey, { decision: 'deny', tier: 'pro', status: decision.status, reason: decision.reason, expiresAt: nowMs + negTtl }, negTtl, warnSafe, subject);
      // The concrete failing check (plus a provider error string, if any) is logged
      // for triage; the full provider body is never logged because it can carry
      // customer PII that secret-name redaction won't catch.
      const vendorError = provider.errorText ? provider.errorText(data) : undefined;
      warnSafe('entitlement: license denied', { subject, detail: decision.detail, error: vendorError });
      return /** @type {EntitlementDeny} */ ({ ok: false, status: decision.status, reason: decision.reason });
    } finally {
      await releaseLock();
    }
  };

  return { validate };
}

/**
 * Deep exact-substring scrub of a known raw license from a log payload, applied
 * BEFORE the pattern-based redactSecrets. A provider can echo the license
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

/** @param {number} ms @returns {Promise<void>} */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
