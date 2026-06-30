// @ts-check
// Pro entitlement state machine (server-side only).
//
// Single source of truth for "is this entitlement allowed to use Pro right
// now, and how does a newly observed Lemon Squeezy event change the stored
// record?". PURE: no network/fs/KV/LLM — deterministic functions over plain
// records and events, plus an HMAC helper for hashing raw license keys into
// opaque store ids. The webhook layer (G005) maps provider event types onto
// `status` and verifies authenticity; this module owns ordering, idempotency,
// out-of-order/stale rejection, terminal-state resurrection prevention,
// per-subscription scoping, cache TTLs, and session invalidation.
//
// Fail-closed everywhere: an unknown/missing/malformed record or event never
// grants Pro. Only `active` and (policy-allowed) `trialing` are Pro-allowed.
// Authority ordering is effectiveAt-primary (the provider event time), with an
// optional explicit numeric `version` used ONLY as a same-time tiebreaker —
// timestamps are never used as versions and an explicit `version: 0` is a
// legitimate low tiebreaker, not "missing".

import { createHmac } from 'node:crypto';

/** The closed set of entitlement states. */
export const ENTITLEMENT_STATES = Object.freeze({
  NONE: 'none',
  TRIALING: 'trialing',
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  CANCELLED: 'cancelled',
  REVOKED: 'revoked',
  EXPIRED: 'expired',
});

/** Pro-granting states (frozen, immutable). `trialing` is allowed by policy. */
export const PRO_ALLOWED_STATES = Object.freeze([ENTITLEMENT_STATES.ACTIVE, ENTITLEMENT_STATES.TRIALING]);
/** Terminal states: a record here only leaves via an explicit newer reissue (frozen). */
export const TERMINAL_STATES = Object.freeze([ENTITLEMENT_STATES.CANCELLED, ENTITLEMENT_STATES.REVOKED, ENTITLEMENT_STATES.EXPIRED]);

/** Positive cache TTL (Pro-allowed states); mirrors the plan's 10-minute floor. */
export const POSITIVE_ENTITLEMENT_TTL_MS = 10 * 60 * 1000;
/** Negative cache TTL (not Pro-allowed); short so a new purchase propagates fast. */
export const NEGATIVE_ENTITLEMENT_TTL_MS = 60 * 1000;

// Private membership sets. Exported constants are frozen arrays so the
// access policy can never be mutated process-wide (Object.freeze does NOT make
// a Set's add/delete inert, so we never export the Sets themselves).
/** @type {ReadonlySet<string>} */
const STATE_VALUES = new Set(Object.values(ENTITLEMENT_STATES));
/** @type {ReadonlySet<string>} */
const PRO_ALLOWED = new Set(PRO_ALLOWED_STATES);
/** @type {ReadonlySet<string>} */
const TERMINAL = new Set(TERMINAL_STATES);

/**
 * Hash a raw license key into an opaque, log-safe store id. The raw key never
 * becomes a KV key or appears in a URL/log; only this HMAC digest does.
 *
 * @param {string} secret server-side HMAC secret
 * @param {string} rawLicenseKey
 * @returns {string} hex digest
 */
export function hashLicenseKey(secret, rawLicenseKey) {
  if (typeof secret !== 'string' || secret.length === 0) throw new Error('entitlement hash secret unavailable');
  if (typeof rawLicenseKey !== 'string' || rawLicenseKey.length === 0) throw new Error('license key required');
  return createHmac('sha256', secret).update(rawLicenseKey).digest('hex');
}

/**
 * @typedef {Object} EntitlementRecord
 * @property {string} status one of ENTITLEMENT_STATES
 * @property {number} effectiveAt provider event effective time (ms epoch)
 * @property {number} version same-time tiebreaker (0 when none was supplied)
 * @property {string} [lastEventId] last applied provider event id (idempotency)
 * @property {string} [subscriptionId] provider subscription/license identity
 * @property {number} [expiresAt] hard expiry (ms epoch); missing/non-finite/past = not allowed
 */

/**
 * @typedef {Object} EntitlementEvent
 * @property {string} id provider event id (idempotency key)
 * @property {string} status mapped target status (one of ENTITLEMENT_STATES)
 * @property {number} effectiveAt provider effective time (ms epoch)
 * @property {number} [version] same-time tiebreaker; finite number when present
 * @property {string} [subscriptionId] subscription/license identity (non-empty string)
 * @property {number} [expiresAt] hard expiry to store (finite number when present)
 */

/** A finite-number guard used for every numeric field that affects access. */
function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Derive the effective state of a stored record at time `now`. A Pro-allowed
 * record whose `expiresAt` is present but NOT a finite future timestamp
 * (NaN/Infinity/string/past) is reported `expired` — malformed expiry denies
 * Pro fail-closed. Missing record → `none`.
 *
 * @param {EntitlementRecord|null|undefined} record
 * @param {number} [now]
 * @returns {string} one of ENTITLEMENT_STATES
 */
export function deriveEntitlementState(record, now = Date.now()) {
  if (!record || typeof record !== 'object') return ENTITLEMENT_STATES.NONE;
  const status = STATE_VALUES.has(record.status) ? record.status : ENTITLEMENT_STATES.NONE;
  if (PRO_ALLOWED.has(status) && record.expiresAt != null) {
    // A present expiry MUST be a finite future timestamp; anything else denies Pro.
    if (!isFiniteNumber(record.expiresAt) || record.expiresAt <= now) return ENTITLEMENT_STATES.EXPIRED;
  }
  return status;
}

/**
 * Whether a record grants Pro right now. Fail-closed: only `active`/`trialing`
 * (and not past/at a hard expiry, and not malformed) qualify.
 *
 * @param {EntitlementRecord|null|undefined} record
 * @param {number} [now]
 * @returns {boolean}
 */
export function isProAllowed(record, now = Date.now()) {
  return PRO_ALLOWED.has(deriveEntitlementState(record, now));
}

/**
 * Cache TTL for a derived state: Pro-allowed → 10m positive; else → 60s negative.
 *
 * @param {string} state
 * @returns {number} ttl in ms
 */
export function cacheTtlForState(state) {
  return PRO_ALLOWED.has(state) ? POSITIVE_ENTITLEMENT_TTL_MS : NEGATIVE_ENTITLEMENT_TTL_MS;
}

/**
 * Whether a transition must invalidate cached positive entitlement and active
 * Pro session tokens. Leaving a Pro-allowed state, or entering any terminal
 * state, invalidates (defensive: revoke after cancel still invalidates).
 *
 * @param {string} prevState
 * @param {string} nextState
 * @returns {boolean}
 */
export function shouldInvalidateSessions(prevState, nextState) {
  const wasAllowed = PRO_ALLOWED.has(prevState);
  const isAllowed = PRO_ALLOWED.has(nextState);
  return (wasAllowed && !isAllowed) || (!isAllowed && TERMINAL.has(nextState) && prevState !== nextState);
}

/** Effective tiebreaker version for ordering: explicit finite number, else 0. */
function versionOf(obj) {
  return isFiniteNumber(obj.version) ? obj.version : 0;
}

/**
 * Strict "event is newer than the stored record" by (effectiveAt, version).
 * effectiveAt is primary; version is only a same-time tiebreaker. Timestamps
 * are never treated as versions.
 */
function isStrictlyNewer(event, record) {
  if (event.effectiveAt !== record.effectiveAt) return event.effectiveAt > record.effectiveAt;
  return versionOf(event) > versionOf(record);
}

function ignored(reason) {
  return { changed: /** @type {const} */ (false), ignored: /** @type {const} */ (true), reason };
}

/**
 * Apply a provider event to the current entitlement record, enforcing field
 * validation, idempotency, ordering, per-subscription scoping, revoke
 * stickiness, and terminal-resurrection prevention. Pure: returns a new record,
 * never mutates inputs. `now` is used only for time-aware terminal detection
 * (a time-expired Pro record is treated as terminal for resurrection rules).
 *
 * @param {EntitlementRecord|null|undefined} current
 * @param {EntitlementEvent} event
 * @param {number} [now]
 * @returns {{changed:true, record:EntitlementRecord, prevState:string, nextState:string}|{changed:false, ignored:true, reason:string}}
 */
export function applyEntitlementEvent(current, event, now = Date.now()) {
  // --- event field validation (malformed → ignored fail-closed) ---
  if (!event || typeof event !== 'object') return ignored('invalid_event');
  if (typeof event.id !== 'string' || event.id.length === 0) return ignored('invalid_event');
  if (!STATE_VALUES.has(event.status)) return ignored('invalid_event');
  if (!isFiniteNumber(event.effectiveAt)) return ignored('invalid_event');
  if (event.version != null && !isFiniteNumber(event.version)) return ignored('invalid_event');
  if (event.expiresAt != null && !isFiniteNumber(event.expiresAt)) return ignored('invalid_event');
  if (event.subscriptionId != null && (typeof event.subscriptionId !== 'string' || event.subscriptionId.length === 0)) return ignored('invalid_event');

  const cur = current && typeof current === 'object' ? current : null;
  const prevStored = cur && STATE_VALUES.has(cur.status) ? cur.status : ENTITLEMENT_STATES.NONE;

  // Idempotency: a re-delivered event id is a no-op.
  if (cur && cur.lastEventId && cur.lastEventId === event.id) return ignored('duplicate_event');

  // A `none` event never creates a record.
  if (event.status === ENTITLEMENT_STATES.NONE) return ignored('noop_none');

  if (cur) {
    const newer = isStrictlyNewer(event, cur);
    const curSub = typeof cur.subscriptionId === 'string' ? cur.subscriptionId : null;
    const evSub = typeof event.subscriptionId === 'string' ? event.subscriptionId : null;

    if (curSub != null && evSub != null && evSub !== curSub) {
      // The event concerns a DIFFERENT subscription than the stored one. Only a
      // strictly-newer Pro-allowed reissue replaces the record; anything else
      // (e.g. a stale/replayed revoke for an old subscription) is ignored, so
      // it can never revoke or disturb the current subscription's access.
      if (PRO_ALLOWED.has(event.status) && newer) {
        // reissue → fall through to build the new record
      } else {
        return ignored('other_subscription');
      }
    } else {
      // Same subscription (or one side unspecified).
      const revokeOverride = event.status === ENTITLEMENT_STATES.REVOKED && prevStored !== ENTITLEMENT_STATES.REVOKED;
      if (!newer && !revokeOverride) return ignored('stale_event');

      // Revoked is sticky: a same-subscription event can never un-revoke.
      if (prevStored === ENTITLEMENT_STATES.REVOKED) return ignored('revoked_sticky');

      // Resurrection prevention (time-aware): a terminal record — including a
      // time-expired Pro record — only returns to Pro via either a different
      // subscription reissue (handled above) or a genuine renewal that carries
      // a finite FUTURE expiry. A bare same-subscription "active" with no new
      // period cannot resurrect access.
      const prevDerived = deriveEntitlementState(cur, now);
      if (TERMINAL.has(prevDerived) && PRO_ALLOWED.has(event.status)) {
        const renewal = isFiniteNumber(event.expiresAt) && event.expiresAt > now && newer;
        if (!renewal) return ignored('no_resurrection');
      }
    }
  }

  /** @type {EntitlementRecord} */
  const record = {
    status: event.status,
    effectiveAt: event.effectiveAt,
    version: versionOf(event),
    lastEventId: event.id,
    ...(event.subscriptionId != null
      ? { subscriptionId: event.subscriptionId }
      : (cur && cur.subscriptionId != null ? { subscriptionId: cur.subscriptionId } : {})),
    // expiresAt is taken ONLY from the event (never inherited): the event is the
    // authority on the current period. Absent = no hard expiry stated.
    ...(isFiniteNumber(event.expiresAt) ? { expiresAt: event.expiresAt } : {}),
  };

  return { changed: true, record, prevState: prevStored, nextState: event.status };
}
