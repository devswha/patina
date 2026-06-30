// @ts-check
// Pro usage metering (server-side only).
//
// Bounds Pro cost/abuse with per-entitlement day/hour/minute request caps over
// the shared KV store contract (G002). A "month" subscription is sold as
// fair-use, NOT literally unlimited: these caps make a shared/scripted key
// unable to run LLM spend far past revenue. Fail-closed: a malformed counter or
// a storage failure denies the request rather than failing open on an abuse
// boundary (mirrors src/rate-limit.js). Keys are opaque (the entitlement id is
// already an HMAC hash); no raw key/email is ever a metering key.

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/** Per-entitlement Pro caps (the plan's recommended values). */
export const PRO_LIMITS = Object.freeze({ reqPerDay: 100, reqPerHour: 20, reqPerMinute: 6, maxChars: 12000 });

/**
 * Cost-alert thresholds (USD). The metering layer emits a sanitized alert event
 * when an entitlement's estimated spend crosses a warning/throttle line, and a
 * global operator alert for total daily/monthly spend. These are advisory
 * signals for observability; the hard request caps above are the enforcement.
 */
export const COST_ALERT = Object.freeze({
  keyDayWarnUsd: 2, keyMonthWarnUsd: 15,
  keyDayThrottleUsd: 3, keyMonthThrottleUsd: 25,
  globalDayUsd: 25, globalMonthUsd: 300,
});

/** @param {string} id opaque entitlement id @param {string} window @param {number} bucket */
function meterKey(id, window, bucket) {
  return `prometer:${window}:${id}:${bucket}`;
}

/**
 * Create the Pro metering checker.
 *
 * @param {{
 *   kv: {incr(key:string, opts?:{ttlMs?:number}):Promise<number>},
 *   now?: () => number,
 *   limits?: typeof PRO_LIMITS,
 * }} deps
 */
export function createProMetering({ kv, now = () => Date.now(), limits = PRO_LIMITS }) {
  return {
    /**
     * Count one Pro request against the day/hour/minute caps. Fail-closed.
     *
     * @param {{entitlementId:string}} input
     * @returns {Promise<{allowed:true, remainingDay:number}|{allowed:false, status:number, reason:string}>}
     */
    async check({ entitlementId }) {
      if (typeof entitlementId !== 'string' || entitlementId.length === 0) {
        return { allowed: false, status: 403, reason: 'no entitlement' };
      }
      if (!kv || typeof kv.incr !== 'function') {
        return { allowed: false, status: 503, reason: 'metering storage unavailable' };
      }

      const t = now();
      const dayBucket = Math.floor(t / DAY_MS);
      const hourBucket = Math.floor(t / HOUR_MS);
      const minuteBucket = Math.floor(t / MINUTE_MS);

      try {
        const dayCount = await kv.incr(meterKey(entitlementId, 'd', dayBucket), { ttlMs: (dayBucket + 1) * DAY_MS - t });
        if (!Number.isSafeInteger(dayCount) || dayCount < 1) return { allowed: false, status: 503, reason: 'metering storage unavailable' };
        if (dayCount > limits.reqPerDay) return { allowed: false, status: 429, reason: 'daily cap exceeded' };

        const hourCount = await kv.incr(meterKey(entitlementId, 'h', hourBucket), { ttlMs: (hourBucket + 1) * HOUR_MS - t });
        if (!Number.isSafeInteger(hourCount) || hourCount < 1) return { allowed: false, status: 503, reason: 'metering storage unavailable' };
        if (hourCount > limits.reqPerHour) return { allowed: false, status: 429, reason: 'hourly cap exceeded' };

        const minuteCount = await kv.incr(meterKey(entitlementId, 'm', minuteBucket), { ttlMs: (minuteBucket + 1) * MINUTE_MS - t });
        if (!Number.isSafeInteger(minuteCount) || minuteCount < 1) return { allowed: false, status: 503, reason: 'metering storage unavailable' };
        if (minuteCount > limits.reqPerMinute) return { allowed: false, status: 429, reason: 'rate too high' };

        return { allowed: true, remainingDay: Math.max(0, limits.reqPerDay - dayCount) };
      } catch {
        return { allowed: false, status: 503, reason: 'metering storage unavailable' };
      }
    },
  };
}
