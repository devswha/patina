// @ts-check
// Pro session token exchange (server-side only).
//
// A raw Lemon Squeezy license key is presented ONCE, at the exchange endpoint,
// over a POST body. It is hashed (HMAC) into an opaque entitlement id, checked
// against the durable entitlement mirror (written by the G005 webhook) — or a
// provider verify fallback — and, only if the entitlement is Pro-allowed
// (G003), exchanged for an opaque, short-lived Pro session token. The rewrite
// path (G006) then sends that token, never the raw key, on every request
// (G001 contract). Only the token's HMAC hash is stored; the raw token, raw
// license key, and email never enter a store key, URL, log, or returned object.
//
// Fail-closed: any missing/expired/revoked/not-allowed condition denies a
// session and never downgrades to free/BYOK silently.

import { createHmac, randomBytes } from 'node:crypto';
import { isProAllowed, deriveEntitlementState } from './pro-entitlements.js';

/** Sliding session lifetime: a token is good for 30 minutes since (re)issue. */
export const PRO_SESSION_TTL_MS = 30 * 60 * 1000;
/** Absolute cap: a token can never live beyond 2 hours from first issue. */
export const PRO_SESSION_ABSOLUTE_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * Max accepted raw license key length (chars). A real Lemon license key is
 * short; a longer value is rejected at the security boundary so an oversized
 * key (from any body shape, incl. a pre-parsed object that bypassed a transport
 * byte cap) can never reach HMAC/KV/provider verification.
 */
export const MAX_LICENSE_KEY_CHARS = 512;

/** KV key namespaces (opaque hashes only — never raw key/email/token). */
export const ENTITLEMENT_KEY_PREFIX = 'ent:';
export const SESSION_KEY_PREFIX = 'sess:';

/** @param {string} entitlementId opaque HMAC id */
export function entitlementKey(entitlementId) {
  return `${ENTITLEMENT_KEY_PREFIX}${entitlementId}`;
}
/** @param {string} tokenHash opaque HMAC of the session token */
export function sessionKey(tokenHash) {
  return `${SESSION_KEY_PREFIX}${tokenHash}`;
}

/**
 * Generate an opaque 256-bit Pro session token (hex). Returned to the client
 * exactly once; only its hash is persisted.
 *
 * @param {(n:number)=>Buffer} [randomImpl]
 * @returns {string}
 */
export function generateProSessionToken(randomImpl = randomBytes) {
  return randomImpl(32).toString('hex');
}

/**
 * HMAC-hash a session token for storage/lookup. The raw token is never stored.
 *
 * @param {string} secret
 * @param {string} token
 * @returns {string} hex digest
 */
export function hashSessionToken(secret, token) {
  if (typeof secret !== 'string' || secret.length === 0) throw new Error('session hmac secret unavailable');
  if (typeof token !== 'string' || token.length === 0) throw new Error('session token required');
  return createHmac('sha256', secret).update(token).digest('hex');
}

/**
 * @typedef {Object} ProSessionRecord
 * @property {string} entitlementId opaque HMAC id this session is bound to
 * @property {number} issuedAt ms epoch
 * @property {number} expiresAt sliding expiry (ms epoch)
 * @property {number} absoluteExpiresAt hard cap (ms epoch)
 */

/**
 * Build a session record for an allowed entitlement. Fail-closed: a non-allowed
 * entitlement yields no session.
 *
 * @param {{entitlement:object|null, entitlementId:string, now?:number}} input
 * @returns {{ok:true, record:ProSessionRecord}|{ok:false, reason:string}}
 */
export function issueProSession({ entitlement, entitlementId, now = Date.now() }) {
  if (typeof entitlementId !== 'string' || entitlementId.length === 0) return { ok: false, reason: 'no_entitlement_id' };
  if (!isProAllowed(entitlement, now)) return { ok: false, reason: 'not_allowed' };
  return {
    ok: true,
    record: {
      entitlementId,
      issuedAt: now,
      expiresAt: now + PRO_SESSION_TTL_MS,
      absoluteExpiresAt: now + PRO_SESSION_ABSOLUTE_TTL_MS,
    },
  };
}

/**
 * Verify a stored session record against the current entitlement. Fail-closed
 * on a missing/malformed record, a passed sliding or absolute expiry, or an
 * entitlement that is no longer Pro-allowed (cancelled/revoked/expired).
 *
 * @param {{sessionRecord:ProSessionRecord|null|undefined, entitlement:object|null, now?:number}} input
 * @returns {{ok:boolean, reason?:string}}
 */
export function verifyProSession({ sessionRecord, entitlement, now = Date.now() }) {
  if (!sessionRecord || typeof sessionRecord !== 'object') return { ok: false, reason: 'no_session' };
  const { expiresAt, absoluteExpiresAt } = sessionRecord;
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= now) return { ok: false, reason: 'expired' };
  if (typeof absoluteExpiresAt !== 'number' || !Number.isFinite(absoluteExpiresAt) || absoluteExpiresAt <= now) return { ok: false, reason: 'absolute_expired' };
  if (!isProAllowed(entitlement, now)) return { ok: false, reason: 'entitlement_revoked' };
  return { ok: true };
}

/**
 * Slide a session's expiry forward (bounded by the absolute cap) — only while
 * the session is still valid and the entitlement is still allowed.
 *
 * @param {{sessionRecord:ProSessionRecord, entitlement:object|null, now?:number}} input
 * @returns {{ok:true, record:ProSessionRecord}|{ok:false, reason?:string}}
 */
export function refreshProSession({ sessionRecord, entitlement, now = Date.now() }) {
  const v = verifyProSession({ sessionRecord, entitlement, now });
  if (!v.ok) return { ok: false, reason: v.reason };
  const expiresAt = Math.min(now + PRO_SESSION_TTL_MS, sessionRecord.absoluteExpiresAt);
  return { ok: true, record: { ...sessionRecord, expiresAt } };
}

/** Parse a JSON string store value into an object, or null on any failure. */
function parseRecord(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value; // memory KV may return the object
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Create the license -> opaque session token exchange. Dependencies are
 * injected so it is unit-testable with a mock KV and a mock provider verifier.
 *
 * @param {{
 *   kv: {get(key:string):Promise<unknown>, set(key:string, val:string, opts?:{ttlMs?:number}):Promise<void>},
 *   hmacSecret: string,
 *   verifyLicense?: (rawLicenseKey:string)=>Promise<object|null>,
 *   hashKey: (secret:string, raw:string)=>string,
 *   now?: ()=>number,
 *   randomImpl?: (n:number)=>Buffer,
 * }} deps
 */
export function createProSessionExchange({ kv, hmacSecret, verifyLicense, hashKey, now = () => Date.now(), randomImpl = randomBytes }) {
  return {
    /**
     * Exchange a raw license key for an opaque Pro session token.
     * Returns a masked result; never echoes the raw key/email/token in errors.
     *
     * @param {{licenseKey?:unknown}} body
     * @returns {Promise<{ok:true, proSessionToken:string, expiresAt:number, status:string}|{ok:false, status:number, reason:string}>}
     */
    async exchange(body) {
      if (!hmacSecret) return { ok: false, status: 503, reason: 'pro session secret unavailable' };
      // Read ONLY an own `licenseKey` property: an inherited/prototype-polluted
      // value (e.g. Object.create({ licenseKey })) must not smuggle a key.
      const rawLicenseKey = (body && typeof body === 'object' && Object.hasOwn(body, 'licenseKey'))
        ? /** @type {any} */ (body).licenseKey
        : undefined;
      if (typeof rawLicenseKey !== 'string' || rawLicenseKey.trim().length === 0) {
        return { ok: false, status: 400, reason: 'licenseKey required' };
      }
      if (rawLicenseKey.length > MAX_LICENSE_KEY_CHARS) {
        return { ok: false, status: 400, reason: 'licenseKey too long' };
      }

      const entitlementId = hashKey(hmacSecret, rawLicenseKey);
      const tNow = now();

      // Prefer the durable entitlement mirror; fall back to a provider verify.
      let entitlement = parseRecord(await kv.get(entitlementKey(entitlementId)));
      if (!entitlement && typeof verifyLicense === 'function') {
        entitlement = parseRecord(await verifyLicense(rawLicenseKey));
      }

      if (!isProAllowed(entitlement, tNow)) {
        // 402 Payment Required: the key is not (or no longer) a paying entitlement.
        return { ok: false, status: 402, reason: 'entitlement not active' };
      }

      const issued = issueProSession({ entitlement, entitlementId, now: tNow });
      if (!issued.ok) return { ok: false, status: 402, reason: 'entitlement not active' };

      const token = generateProSessionToken(randomImpl);
      const tokenHash = hashSessionToken(hmacSecret, token);
      await kv.set(sessionKey(tokenHash), JSON.stringify(issued.record), { ttlMs: PRO_SESSION_ABSOLUTE_TTL_MS });

      return {
        ok: true,
        proSessionToken: token, // returned to the client exactly once
        expiresAt: issued.record.expiresAt,
        status: deriveEntitlementState(entitlement, tNow),
      };
    },
  };
}
