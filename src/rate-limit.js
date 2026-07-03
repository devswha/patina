// @ts-check

import { createHmac } from 'node:crypto';
import { QUOTA_REASONS, TIER_LIMITS, WEB_TIERS } from './web-rewrite-contract.js';

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

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
 * @param {Record<string, string|string[]|undefined>} headers
 * @param {{trustedHeaders?: string[]}} [options]
 * @returns {string|null}
 */
export function extractClientIp(headers, { trustedHeaders = ['x-real-ip', 'x-vercel-forwarded-for'] } = {}) {
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
 * Create an in-memory KV store for tests and local development only.
 *
 * @returns {{__memory: true, get(key: string): Promise<unknown>, set(key: string, val: unknown, options?: {ttlMs?: number}): Promise<void>, incr(key: string, options?: {ttlMs?: number}): Promise<number>, decr(key: string): Promise<number>}}
 */
export function createMemoryKv() {
  /** @type {Map<string, {value: unknown, expiresAt: number}>} */
  const entries = new Map();

  const expire = () => {
    const now = Date.now();
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= now) entries.delete(key);
    }
  };

  /** @param {number|undefined} ttlMs */
  const expiresAt = (ttlMs) => (typeof ttlMs === 'number' && ttlMs > 0 ? Date.now() + ttlMs : Number.POSITIVE_INFINITY);

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
    async decr(key) {
      expire();
      const current = Number(entries.get(key)?.value ?? 0);
      const next = current - 1;
      entries.set(key, { value: next, expiresAt: entries.get(key)?.expiresAt ?? Number.POSITIVE_INFINITY });
      return next;
    },
  };
}

/**
 * @param {Record<string, string|undefined>} [env]
 * @returns {boolean}
 */
export function isProductionPosture(env = {}) {
  return env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production' || env.VERCEL === '1';
}

/**
 * @typedef {{get?(key: string): Promise<unknown>, set?(key: string, val: unknown, options?: {ttlMs?: number}): Promise<void>, incr(key: string, options?: {ttlMs?: number}): Promise<number>, decr?(key: string): Promise<number>, __memory?: boolean}} QuotaKv
 * @typedef {{allowed: true, tier: string, remainingDay?: number}|{allowed: false, status: number, reason: string}} RateLimitResult
 * @typedef {{warn?: (...args: unknown[]) => void}} RateLimitLogger
 */

/**
 * Create a fail-closed rate limiter for the shared free proxy.
 *
 * @param {{kv?: QuotaKv|null, hmacSecret?: string, env?: Record<string, string|undefined>, now?: () => number, limits?: typeof TIER_LIMITS, logger?: RateLimitLogger}} options
 * @returns {{check(input: {tier: string, ip?: string|null}): Promise<RateLimitResult>, acquireConcurrency(input: {tier: string, ip?: string|null}): Promise<RateLimitResult>, releaseConcurrency(input: {tier: string, ip?: string|null}): Promise<void>}}
 */
export function createRateLimiter({ kv, hmacSecret, env = {}, now = () => Date.now(), limits = TIER_LIMITS, logger = console }) {
  const getConcurrencyKey = (tier, ip) => {
    if (tier === WEB_TIERS.BYOK) return { ok: false, result: /** @type {RateLimitResult} */ ({ allowed: true, tier }) };
    const production = isProductionPosture(env);
    if (production && (!kv || kv.__memory)) return { ok: false, result: /** @type {RateLimitResult} */ ({ allowed: false, status: 503, reason: QUOTA_REASONS.STORAGE_UNAVAILABLE }) };
    if (production && !hmacSecret) return { ok: false, result: /** @type {RateLimitResult} */ ({ allowed: false, status: 503, reason: QUOTA_REASONS.SECRET_UNAVAILABLE }) };
    if (!kv) return { ok: false, result: /** @type {RateLimitResult} */ ({ allowed: false, status: 503, reason: QUOTA_REASONS.STORAGE_UNAVAILABLE }) };
    if (!ip) return { ok: false, result: /** @type {RateLimitResult} */ ({ allowed: false, status: 400, reason: QUOTA_REASONS.IP_UNAVAILABLE }) };
    const secret = hmacSecret || 'patina-local-quota-secret';
    return { ok: true, key: quotaKeyHmac(secret, 'free', 'concurrent', ip) };
  };

  const releaseKey = async (key) => {
    if (!kv || typeof kv.decr !== 'function') {
      logger.warn?.('quota concurrency release skipped: kv decr unavailable');
      return;
    }
    try {
      await kv.decr(key);
    } catch {
      logger.warn?.('quota concurrency release failed');
    }
  };

  return {
    async check({ tier, ip }) {
      if (tier === WEB_TIERS.BYOK) return { allowed: true, tier };

      const production = isProductionPosture(env);
      if (production && (!kv || kv.__memory)) return { allowed: false, status: 503, reason: QUOTA_REASONS.STORAGE_UNAVAILABLE };
      if (production && !hmacSecret) return { allowed: false, status: 503, reason: QUOTA_REASONS.SECRET_UNAVAILABLE };
      if (!kv) return { allowed: false, status: 503, reason: QUOTA_REASONS.STORAGE_UNAVAILABLE };
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
    },
    async acquireConcurrency({ tier, ip }) {
      const resolved = getConcurrencyKey(tier, ip);
      if (!resolved.ok) return resolved.result;
      const freeLimits = limits.free;
      try {
        const activeCount = await kv.incr(resolved.key, { ttlMs: 5 * 60 * 1000 });
        if (!Number.isSafeInteger(activeCount) || activeCount < 1) {
          return { allowed: false, status: 503, reason: QUOTA_REASONS.STORAGE_UNAVAILABLE };
        }
        if (activeCount > freeLimits.maxConcurrent) {
          await releaseKey(resolved.key);
          return { allowed: false, status: 429, reason: QUOTA_REASONS.CONCURRENT };
        }
        return { allowed: true, tier };
      } catch {
        return { allowed: false, status: 503, reason: QUOTA_REASONS.STORAGE_UNAVAILABLE };
      }
    },
    async releaseConcurrency({ tier, ip }) {
      const resolved = getConcurrencyKey(tier, ip);
      if (!resolved.ok || !resolved.key) return;
      await releaseKey(resolved.key);
    },
  };
}
