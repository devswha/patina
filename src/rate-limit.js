// @ts-check

import { createHmac, randomBytes } from 'node:crypto';
import { isProductionPosture, QUOTA_REASONS, TIER_LIMITS, WEB_TIERS } from './web-rewrite-contract.js';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const DEFAULT_CONCURRENCY_TTL_MS = 5 * 60 * 1000;

/**
 * Return a hex sha256 HMAC quota key for NUL-separated parts.
 *
 * @param {string} secret
 * @param {...unknown} parts
 * @returns {string}
 */
export function quotaKeyHmac(secret, ...parts) {
  return createHmac('sha256', secret).update(parts.map((part) => String(part)).join('\0')).digest('hex');
}

/**
 * Extract a client IP only from trusted platform headers.
 *
 * Order matters: `x-vercel-forwarded-for` is consulted FIRST because the
 * `x-vercel-*` prefix is platform-controlled under every topology (Vercel
 * always strips/sets it at its own proxy). `x-real-ip` is equally
 * platform-set on a direct Vercel deployment, but its trustworthiness depends
 * on that topology staying true — behind a future fronting proxy/CDN or a
 * verified-proxy setup a client-supplied value could survive, which on this
 * boundary would mint fresh per-IP free-tier quota per spoofed header (#607).
 *
 * @param {Record<string, string|string[]|undefined>} headers
 * @param {{trustedHeaders?: string[]}} [options]
 * @returns {string|null}
 */
export function extractClientIp(headers, { trustedHeaders = ['x-vercel-forwarded-for', 'x-real-ip'] } = {}) {
  for (const name of trustedHeaders) {
    const value = getHeader(headers, name);
    if (!value) continue;
    const first = value.split(',')[0]?.trim();
    if (first) return first;
  }
  return null;
}

/**
 * @param {Record<string, string|string[]|undefined>} headers
 * @param {string} name
 * @returns {string|undefined}
 */
function getHeader(headers, name) {
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() !== lowerName) continue;
    if (Array.isArray(value)) return value[0];
    return value;
  }
  return undefined;
}

/**
 * @typedef {Map<string, number>} LeaseRegistry
 */

/**
 * @param {unknown} value
 * @returns {value is LeaseRegistry}
 */
function isLeaseRegistry(value) {
  if (!(value instanceof Map)) return false;
  for (const [lease, expiry] of value) {
    if (typeof lease !== 'string' || typeof expiry !== 'number') return false;
  }
  return true;
}

/**
 * Create an in-memory KV store for tests and local development only.
 *
 * @param {{now?: () => number}} [options]
 * @returns {{__memory: true, get(key: string): Promise<unknown>, set(key: string, val: unknown, options?: {ttlMs?: number}): Promise<void>, incr(key: string, options?: {ttlMs?: number}): Promise<number>, incrBy(key: string, amount: number, options?: {ttlMs?: number}): Promise<number>, decr(key: string): Promise<number>, acquireLease(registryKey: string, lease: string, maxConcurrent: number, options: {ttlMs: number}): Promise<boolean>, releaseLease(registryKey: string, lease: string): Promise<boolean>}}
 */
export function createMemoryKv({ now = () => Date.now() } = {}) {
  /** @type {Map<string, {value: unknown, expiresAt: number}>} */
  const entries = new Map();

  const expire = () => {
    const timestamp = now();
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= timestamp) entries.delete(key);
    }
  };

  /** @param {number|undefined} ttlMs */
  const expiresAt = (ttlMs) => (typeof ttlMs === 'number' && ttlMs > 0 ? now() + ttlMs : Number.POSITIVE_INFINITY);

  return {
    __memory: true,
    async get(key) {
      expire();
      return entries.get(key)?.value;
    },
    async set(key, val, { ttlMs } = {}) {
      expire();
      entries.set(key, { value: val, expiresAt: expiresAt(ttlMs) });
    },
    async incr(key, { ttlMs } = {}) {
      expire();
      const current = Number(entries.get(key)?.value ?? 0);
      const next = current + 1;
      entries.set(key, { value: next, expiresAt: expiresAt(ttlMs) });
      return next;
    },
    async incrBy(key, amount, { ttlMs } = {}) {
      expire();
      const current = Number(entries.get(key)?.value ?? 0);
      const next = current + Number(amount);
      entries.set(key, { value: next, expiresAt: expiresAt(ttlMs) });
      return next;
    },
    async decr(key) {
      expire();
      const current = Number(entries.get(key)?.value ?? 0);
      const next = Math.max(0, current - 1);
      entries.set(key, { value: next, expiresAt: entries.get(key)?.expiresAt ?? Number.POSITIVE_INFINITY });
      return next;
    },
    async acquireLease(registryKey, lease, maxConcurrent, { ttlMs }) {
      expire();
      const timestamp = now();
      const registry = entries.get(registryKey);
      const leases = registry?.value instanceof Map ? registry.value : new Map();
      for (const [token, expiry] of leases) {
        if (expiry <= timestamp) leases.delete(token);
      }
      if (leases.size >= maxConcurrent) return false;
      leases.set(lease, timestamp + ttlMs);
      entries.set(registryKey, { value: leases, expiresAt: timestamp + ttlMs });
      return true;
    },
    async releaseLease(registryKey, lease) {
      expire();
      const registry = entries.get(registryKey);
      const leases = registry?.value;
      if (!isLeaseRegistry(leases)) return false;
      const expiry = leases.get(lease);
      if (typeof expiry !== 'number' || expiry <= now()) return false;
      leases.delete(lease);
      if (leases.size === 0) entries.delete(registryKey);
      return true;
    },
  };
}

// isProductionPosture's definition lives in web-rewrite-contract.js (the shared
// base module) so the contract's provider resolution can use it without an
// import cycle; re-exported here for existing importers.
export { isProductionPosture };

/**
 * @typedef {{get?(key: string): Promise<unknown>, set?(key: string, val: unknown, options?: {ttlMs?: number}): Promise<void>, incr(key: string, options?: {ttlMs?: number}): Promise<number>, incrBy?(key: string, amount: number, options?: {ttlMs?: number}): Promise<number>, decr?(key: string): Promise<number>, acquireLease?(registryKey: string, lease: string, maxConcurrent: number, options: {ttlMs: number}): Promise<boolean>, releaseLease?(registryKey: string, lease: string): Promise<boolean>, __memory?: boolean}} QuotaKv
 * @typedef {{allowed: true, tier: string, remainingDay?: number}|{allowed: false, status: number, reason: string, remainingMonthlyChars?: number, limitMonthlyChars?: number}} RateLimitResult
 * @typedef {{allowed: true, tier: string, remainingDay?: number, lease: string}|{allowed: false, status: number, reason: string, remainingMonthlyChars?: number, limitMonthlyChars?: number}} ConcurrencyResult
 * @typedef {{warn?: (...args: unknown[]) => void}} RateLimitLogger
 */

/**
 * Create a fail-closed rate limiter for the shared free proxy.
 *
 * @param {{kv?: QuotaKv|null, hmacSecret?: string, env?: Record<string, string|undefined>, now?: () => number, limits?: typeof TIER_LIMITS, logger?: RateLimitLogger, concurrencyTtlMs?: number, leaseId?: () => string}} options
 *   `concurrencyTtlMs` is the self-healing expiry for a concurrency slot; keep it
 *   >= the maximum stream budget so a slot never expires mid-stream (defaults to 5m).
 * @returns {{check(input: {tier: string, ip?: string|null, subject?: string|null, chars?: number}): Promise<RateLimitResult>, acquireConcurrency(input: {tier: string, ip?: string|null, subject?: string|null}): Promise<ConcurrencyResult>, releaseConcurrency(input: {tier: string, ip?: string|null, subject?: string|null, lease?: string}): Promise<void>}}
 */
export function createRateLimiter({ kv, hmacSecret, env = {}, now = () => Date.now(), limits = TIER_LIMITS, logger = console, concurrencyTtlMs = DEFAULT_CONCURRENCY_TTL_MS, leaseId = () => randomBytes(32).toString('base64url') }) {
  const productionGuard = () => {
    const production = isProductionPosture(env);
    if (production && (!kv || kv.__memory)) return /** @type {RateLimitResult} */ ({ allowed: false, status: 503, reason: QUOTA_REASONS.STORAGE_UNAVAILABLE });
    if (production && !hmacSecret) return /** @type {RateLimitResult} */ ({ allowed: false, status: 503, reason: QUOTA_REASONS.SECRET_UNAVAILABLE });
    if (!kv) return /** @type {RateLimitResult} */ ({ allowed: false, status: 503, reason: QUOTA_REASONS.STORAGE_UNAVAILABLE });
    return null;
  };

  // Resolve the concurrency-slot key per tier: BYOK is unmetered (allow, no-op),
  // FREE keys on the client IP, PRO keys on the license subject (never the IP).
  // An unknown tier is a stable 400 (defense-in-depth). The production/KV/secret
  // guards are shared with `check` via productionGuard.
  const getConcurrencyKey = (tier, ip, subject) => {
    switch (tier) {
      case WEB_TIERS.BYOK:
        return { ok: false, result: /** @type {RateLimitResult} */ ({ allowed: true, tier }) };
      case WEB_TIERS.FREE: {
        const guard = productionGuard();
        if (guard) return { ok: false, result: guard };
        if (!ip) return { ok: false, result: /** @type {RateLimitResult} */ ({ allowed: false, status: 400, reason: QUOTA_REASONS.IP_UNAVAILABLE }) };
        const secret = hmacSecret || 'patina-local-quota-secret';
        return { ok: true, key: quotaKeyHmac(secret, 'free', 'concurrent', ip), maxConcurrent: limits.free.maxConcurrent };
      }
      case WEB_TIERS.PRO: {
        const guard = productionGuard();
        if (guard) return { ok: false, result: guard };
        if (typeof subject !== 'string' || subject === '') return { ok: false, result: /** @type {RateLimitResult} */ ({ allowed: false, status: 401, reason: QUOTA_REASONS.LICENSE_REQUIRED }) };
        const secret = hmacSecret || 'patina-local-quota-secret';
        return { ok: true, key: quotaKeyHmac(secret, 'pro', 'concurrent', subject), maxConcurrent: limits.pro.maxConcurrent };
      }
      default:
        return { ok: false, result: /** @type {RateLimitResult} */ ({ allowed: false, status: 400, reason: 'unsupported tier' }) };
    }
  };

  const releaseKey = async (key, lease) => {
    if (!kv || typeof kv.releaseLease !== 'function' || typeof lease !== 'string' || lease === '') return;
    try {
      await kv.releaseLease(key, lease);
    } catch {
      logger.warn?.('quota concurrency release failed');
    }
  };

  return {
    async check({ tier, ip, subject, chars }) {
      switch (tier) {
        case WEB_TIERS.BYOK:
          return { allowed: true, tier };
        case WEB_TIERS.FREE: {
          const guard = productionGuard();
          if (guard) return guard;
          if (!ip) return { allowed: false, status: 400, reason: QUOTA_REASONS.IP_UNAVAILABLE };

          const secret = hmacSecret || 'patina-local-quota-secret';
          const timestamp = now();
          const dayBucket = Math.floor(timestamp / DAY_MS);
          const hourBucket = Math.floor(timestamp / HOUR_MS);
          const freeLimits = limits.free;
          const dayKey = quotaKeyHmac(secret, 'free', 'day', ip, dayBucket);
          const hourKey = quotaKeyHmac(secret, 'free', 'hour', ip, hourBucket);
          const dayTtlMs = (dayBucket + 1) * DAY_MS - timestamp;
          const hourTtlMs = (hourBucket + 1) * HOUR_MS - timestamp;

          try {
            // A degraded KV adapter that resolves a malformed counter (undefined,
            // NaN, an object, a non-integer) instead of throwing must be treated as
            // storage-unavailable, not silently allowed: `bad > limit` is false and
            // would otherwise fail OPEN on a public abuse boundary.
            const dayCount = await kv.incr(dayKey, { ttlMs: dayTtlMs });
            if (!Number.isSafeInteger(dayCount) || dayCount < 1) {
              return { allowed: false, status: 503, reason: QUOTA_REASONS.STORAGE_UNAVAILABLE };
            }
            if (dayCount > freeLimits.reqPerDay) {
              return { allowed: false, status: 429, reason: QUOTA_REASONS.DAILY };
            }
            const hourCount = await kv.incr(hourKey, { ttlMs: hourTtlMs });
            if (!Number.isSafeInteger(hourCount) || hourCount < 1) {
              return { allowed: false, status: 503, reason: QUOTA_REASONS.STORAGE_UNAVAILABLE };
            }
            if (hourCount > freeLimits.burstPerHour) {
              return { allowed: false, status: 429, reason: QUOTA_REASONS.HOURLY };
            }
            return { allowed: true, tier, remainingDay: Math.max(0, freeLimits.reqPerDay - dayCount) };
          } catch {
            return { allowed: false, status: 503, reason: QUOTA_REASONS.STORAGE_UNAVAILABLE };
          }
        }
        case WEB_TIERS.PRO: {
          const guard = productionGuard();
          if (guard) return guard;
          // Defense-in-depth: the contract already 401s an unauthenticated pro
          // request, but a subject is REQUIRED here so a mis-wired caller can
          // never meter pro traffic against a shared/absent identity.
          if (typeof subject !== 'string' || subject === '') return { allowed: false, status: 401, reason: QUOTA_REASONS.LICENSE_REQUIRED };

          const secret = hmacSecret || 'patina-local-quota-secret';
          const timestamp = now();
          const dayBucket = Math.floor(timestamp / DAY_MS);
          const proLimits = limits.pro;
          // Pro meters a daily cap only (no hourly burst), keyed on the license
          // subject — never the IP — so usage is counted per license seat.
          const dayKey = quotaKeyHmac(secret, 'pro', 'day', subject, dayBucket);
          const dayTtlMs = (dayBucket + 1) * DAY_MS - timestamp;

          try {
            const dayCount = await kv.incr(dayKey, { ttlMs: dayTtlMs });
            if (!Number.isSafeInteger(dayCount) || dayCount < 1) {
              return { allowed: false, status: 503, reason: QUOTA_REASONS.STORAGE_UNAVAILABLE };
            }
            if (dayCount > proLimits.reqPerDay) {
              return { allowed: false, status: 429, reason: QUOTA_REASONS.DAILY };
            }
            // Monthly total-character cap (per license subject), the margin
            // defense against a single seat burning far more than the $9.99/mo
            // subscription value under the daily/per-request caps. Only engages
            // when a positive char count is supplied AND a positive cap is
            // configured; the counter is atomic (incrBy) and resets at the UTC
            // month boundary via the key bucket + TTL.
            const monthlyCap = proLimits.charsPerMonth;
            const reqChars = Number.isSafeInteger(chars) && chars > 0 ? chars : 0;
            if (reqChars > 0 && Number.isSafeInteger(monthlyCap) && monthlyCap > 0) {
              const monthDate = new Date(timestamp);
              const monthBucket = monthDate.getUTCFullYear() * 12 + monthDate.getUTCMonth();
              const monthKey = quotaKeyHmac(secret, 'pro', 'chars-month', subject, monthBucket);
              const nextMonthStart = Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 1);
              const monthTtlMs = nextMonthStart - timestamp;
              const monthTotal = await kv.incrBy(monthKey, reqChars, { ttlMs: monthTtlMs });
              if (!Number.isSafeInteger(monthTotal) || monthTotal < 1) {
                return { allowed: false, status: 503, reason: QUOTA_REASONS.STORAGE_UNAVAILABLE };
              }
              if (monthTotal > monthlyCap) {
                return { allowed: false, status: 429, reason: QUOTA_REASONS.MONTHLY_CHARS, remainingMonthlyChars: 0, limitMonthlyChars: monthlyCap };
              }
            }
            return { allowed: true, tier, remainingDay: Math.max(0, proLimits.reqPerDay - dayCount) };
          } catch {
            return { allowed: false, status: 503, reason: QUOTA_REASONS.STORAGE_UNAVAILABLE };
          }
        }
        default:
          // Defense-in-depth: the contract already rejects unknown tiers; a
          // stable 400 keeps a mis-wired caller fail-closed, never fail-open.
          return { allowed: false, status: 400, reason: 'unsupported tier' };
      }
    },
    async acquireConcurrency({ tier, ip, subject }) {
      const resolved = getConcurrencyKey(tier, ip, subject);
      if (!resolved.ok) {
        if (!resolved.result.allowed) {
          if (
            'status' in resolved.result
            && Number.isSafeInteger(resolved.result.status)
            && 'reason' in resolved.result
            && typeof resolved.result.reason === 'string'
          ) {
            return { allowed: false, status: resolved.result.status, reason: resolved.result.reason };
          }
          return { allowed: false, status: 503, reason: QUOTA_REASONS.STORAGE_UNAVAILABLE };
        }
        try {
          const lease = leaseId();
          if (typeof lease === 'string' && lease !== '') return { allowed: true, tier: resolved.result.tier, lease };
        } catch {
          // An unavailable cryptographic token source cannot grant a capability.
        }
        return { allowed: false, status: 503, reason: QUOTA_REASONS.STORAGE_UNAVAILABLE };
      }
      if (!kv || typeof kv.acquireLease !== 'function' || typeof kv.releaseLease !== 'function') {
        return { allowed: false, status: 503, reason: QUOTA_REASONS.STORAGE_UNAVAILABLE };
      }
      let lease;
      try {
        lease = leaseId();
      } catch {
        return { allowed: false, status: 503, reason: QUOTA_REASONS.STORAGE_UNAVAILABLE };
      }
      if (typeof lease !== 'string' || lease === '') {
        return { allowed: false, status: 503, reason: QUOTA_REASONS.STORAGE_UNAVAILABLE };
      }
      try {
        const acquired = await kv.acquireLease(resolved.key, lease, resolved.maxConcurrent, { ttlMs: concurrencyTtlMs });
        if (acquired === true) return { allowed: true, tier, lease };
        if (acquired === false) return { allowed: false, status: 429, reason: QUOTA_REASONS.CONCURRENT };
        return { allowed: false, status: 503, reason: QUOTA_REASONS.STORAGE_UNAVAILABLE };
      } catch {
        return { allowed: false, status: 503, reason: QUOTA_REASONS.STORAGE_UNAVAILABLE };
      }
    },
    async releaseConcurrency({ tier, ip, subject, lease }) {
      const resolved = getConcurrencyKey(tier, ip, subject);
      if (!resolved.ok || !resolved.key) return;
      await releaseKey(resolved.key, lease);
    },
  };
}
