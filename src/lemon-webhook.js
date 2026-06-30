// @ts-check
// Lemon Squeezy webhook -> entitlement mirror (server-side only).
//
// Verifies the webhook signature (timing-safe), maps the provider event to an
// entitlement status, and folds it into the durable entitlement mirror through
// the G003 state machine (idempotent, ordered, fail-closed). The mirror is
// keyed by the SAME opaque id the session exchange (G004) uses —
// hashLicenseKey(rawLicenseKey) — so a webhook update is immediately visible to
// the next session verify (no separate session index needed: a Pro request
// re-derives the entitlement by id every time, so a revoke/cancel takes effect
// on the next request).
//
// PURE where possible; the processor takes an injected KV + hashKey + clock.
// Raw license key/email never enter a store key, URL, log, or returned object.

import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  applyEntitlementEvent,
  deriveEntitlementState,
  shouldInvalidateSessions,
  ENTITLEMENT_STATES,
} from './pro-entitlements.js';
import { entitlementKey } from './pro-session.js';

/** Idempotency marker TTL: a re-delivered event id is ignored for 30 days. */
export const WEBHOOK_IDEMPOTENCY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Entitlement mirror TTL: long-lived; refreshed on every applied event. */
export const ENTITLEMENT_MIRROR_TTL_MS = 400 * 24 * 60 * 60 * 1000;

/** @param {string} eventId */
export function idempotencyKey(eventId) {
  return `whevt:${eventId}`;
}

/**
 * Subscription "object" events whose `data.id` is the subscription id. Every
 * other subscription_* event (payment_success/failed/recovered/refunded) is a
 * Subscription INVOICE object whose `data.id` is the invoice id, so the
 * subscription must be read from `attributes.subscription_id` instead.
 * @type {ReadonlySet<string>}
 */
const SUBSCRIPTION_OBJECT_EVENTS = new Set([
  'subscription_created', 'subscription_updated', 'subscription_cancelled',
  'subscription_resumed', 'subscription_expired', 'subscription_paused', 'subscription_unpaused',
]);

/**
 * Timing-safe verification of a Lemon Squeezy webhook signature. Lemon signs
 * the raw request body with HMAC-SHA256 (hex) using the store webhook secret
 * and sends it in the `X-Signature` header.
 *
 * @param {string|Buffer} rawBody exact bytes received (NOT re-serialized JSON)
 * @param {string|undefined} signatureHex value of the X-Signature header
 * @param {string} secret webhook signing secret
 * @returns {boolean}
 */
export function verifyWebhookSignature(rawBody, signatureHex, secret) {
  if (typeof secret !== 'string' || secret.length === 0) return false;
  if (typeof signatureHex !== 'string' || !/^[0-9a-f]+$/i.test(signatureHex)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  let provided;
  try {
    provided = Buffer.from(signatureHex, 'hex');
  } catch {
    return false;
  }
  // Length must match for timingSafeEqual; a mismatch is a clean reject.
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

/**
 * Map a Lemon event name + subscription/order status to an entitlement status.
 * Unmappable events return null (ignored, not an error).
 *
 * @param {string} eventName e.g. "subscription_created", "subscription_updated"
 * @param {string} [providerStatus] e.g. "active", "on_trial", "past_due", "cancelled", "expired"
 * @returns {string|null}
 */
export function mapLemonEventToStatus(eventName, providerStatus) {
  const S = ENTITLEMENT_STATES;
  // Refund/chargeback/fraud → hard revoke (sticky terminal).
  if (eventName === 'subscription_payment_refunded' || eventName === 'order_refunded' || eventName === 'license_key_revoked') {
    return S.REVOKED;
  }
  // Subscription lifecycle: trust the carried provider status when present.
  if (eventName && eventName.startsWith('subscription_')) {
    switch (providerStatus) {
      case 'active': return S.ACTIVE;
      case 'on_trial': case 'trialing': return S.TRIALING;
      case 'past_due': return S.PAST_DUE;
      case 'cancelled': case 'canceled': return S.CANCELLED;
      case 'expired': return S.EXPIRED;
      case 'unpaid': return S.PAST_DUE;
      case 'paused': return S.PAST_DUE;
      default: break;
    }
    if (eventName === 'subscription_created' || eventName === 'subscription_resumed' || eventName === 'subscription_payment_success') return S.ACTIVE;
    if (eventName === 'subscription_cancelled') return S.CANCELLED;
    if (eventName === 'subscription_expired') return S.EXPIRED;
    if (eventName === 'subscription_payment_failed') return S.PAST_DUE;
    return null;
  }
  if (eventName === 'order_created' || eventName === 'license_key_created') return S.ACTIVE;
  if (eventName === 'license_key_updated') {
    switch (providerStatus) {
      case 'active': return S.ACTIVE;
      case 'disabled': case 'inactive': return S.REVOKED;
      case 'expired': return S.EXPIRED;
      default: return null;
    }
  }
  return null;
}

/** Parse a finite ms-epoch from an ISO string or number; null if unusable. */
function toEpochMs(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

/**
 * Build a G003 entitlement event from a verified, parsed Lemon payload.
 * Returns null when the payload is unmappable or missing required fields.
 *
 * Expected shape (Lemon): { meta: { event_name, custom_data? }, data: { id, attributes: {...} } }
 * The raw license key must be supplied to derive the mirror id; it is taken
 * from `meta.custom_data.license_key` or `data.attributes.key`.
 *
 * @param {any} payload parsed webhook JSON
 * @param {(secret:string, raw:string)=>string} hashKey
 * @param {string} licenseHmacSecret
 * @returns {{entitlementId:string, event:{id:string,status:string,effectiveAt:number,version?:number,subscriptionId?:string,expiresAt?:number}}|null}
 */
export function buildEntitlementEvent(payload, hashKey, licenseHmacSecret) {
  if (!payload || typeof payload !== 'object') return null;
  const meta = payload.meta && typeof payload.meta === 'object' ? payload.meta : {};
  const data = payload.data && typeof payload.data === 'object' ? payload.data : {};
  const attrs = data.attributes && typeof data.attributes === 'object' ? data.attributes : {};

  const eventName = typeof meta.event_name === 'string' ? meta.event_name : '';
  const status = mapLemonEventToStatus(eventName, attrs.status);
  if (!status) return null;

  // The raw license key (carried by license/order events) keys the mirror.
  const rawLicenseKey = (meta.custom_data && typeof meta.custom_data.license_key === 'string')
    ? meta.custom_data.license_key
    : (typeof attrs.key === 'string' ? attrs.key : null);
  if (!rawLicenseKey || !licenseHmacSecret) return null;

  const eventId = typeof meta.event_id === 'string' && meta.event_id
    ? meta.event_id
    : (data.id != null ? `${eventName}:${data.id}:${attrs.updated_at ?? attrs.created_at ?? ''}` : null);
  if (!eventId) return null;

  const effectiveAt = toEpochMs(attrs.updated_at) ?? toEpochMs(attrs.created_at);
  if (effectiveAt == null) return null;

  // subscriptionId scoping. Lemon has TWO payload families under subscription_*:
  //  - Subscription OBJECT events (created/updated/cancelled/resumed/expired/
  //    paused/unpaused): data.id IS the subscription id.
  //  - Subscription INVOICE events (payment_success/failed/recovered/refunded):
  //    data.id is the INVOICE id; the subscription is attributes.subscription_id.
  // Orders/licenses likewise put their own id in data.id, not the subscription.
  // So: prefer an explicit attributes.subscription_id; use data.id ONLY for the
  // subscription-object events; otherwise omit (the event then applies to the
  // current entitlement, so e.g. a refund revoke lands via the same-sub path).
  // Using data.id blindly would let an active subscription ignore a refund
  // (scoped to an invoice id) as "other_subscription".
  const subscriptionId = attrs.subscription_id != null
    ? String(attrs.subscription_id)
    : (SUBSCRIPTION_OBJECT_EVENTS.has(eventName) && data.id != null ? String(data.id) : undefined);
  const expiresAt = toEpochMs(attrs.renews_at) ?? toEpochMs(attrs.ends_at) ?? undefined;

  /** @type {{id:string,status:string,effectiveAt:number,version?:number,subscriptionId?:string,expiresAt?:number}} */
  const event = { id: eventId, status, effectiveAt };
  if (subscriptionId != null) event.subscriptionId = subscriptionId;
  if (typeof expiresAt === 'number') event.expiresAt = expiresAt;

  return { entitlementId: hashKey(licenseHmacSecret, rawLicenseKey), event };
}

function parseRecord(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Create the webhook processor. Verifies signature, enforces idempotency, maps
 * the event, and folds it into the entitlement mirror via the G003 state
 * machine. Fail-closed on a bad signature or storage error.
 *
 * @param {{
 *   kv: {get(key:string):Promise<unknown>, set(key:string, val:string, opts?:{ttlMs?:number}):Promise<void>},
 *   webhookSecret: string,
 *   licenseHmacSecret: string,
 *   hashKey: (secret:string, raw:string)=>string,
 *   now?: ()=>number,
 *   logger?: {info?:Function, warn?:Function},
 * }} deps
 */
export function createLemonWebhookProcessor({ kv, webhookSecret, licenseHmacSecret, hashKey, now = () => Date.now(), logger = console }) {
  return {
    /**
     * @param {{rawBody:string|Buffer, signature:string|undefined}} input
     * @returns {Promise<{ok:true, applied:boolean, reason?:string}|{ok:false, status:number, reason:string}>}
     */
    async process({ rawBody, signature }) {
      // Missing config is a fail-closed 503, never a silent unmapped/no-op that
      // would hide a misconfiguration and let mirrors go stale.
      if (!webhookSecret) return { ok: false, status: 503, reason: 'webhook secret unavailable' };
      if (!licenseHmacSecret) return { ok: false, status: 503, reason: 'entitlement secret unavailable' };
      if (!verifyWebhookSignature(rawBody, signature, webhookSecret)) {
        return { ok: false, status: 401, reason: 'invalid signature' };
      }
      let payload;
      try {
        payload = JSON.parse(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8'));
      } catch {
        return { ok: false, status: 400, reason: 'invalid payload' };
      }

      const built = buildEntitlementEvent(payload, hashKey, licenseHmacSecret);
      if (!built) return { ok: true, applied: false, reason: 'unmapped_event' };

      // Idempotency: a re-delivered event id is applied at most once.
      const idemKey = idempotencyKey(built.event.id);
      const seen = await kv.get(idemKey);
      if (seen != null) return { ok: true, applied: false, reason: 'duplicate_event' };

      const current = parseRecord(await kv.get(entitlementKey(built.entitlementId)));
      const tNow = now();
      const result = applyEntitlementEvent(current, built.event, tNow);

      // Apply the entitlement change FIRST, then write the idempotency marker
      // LAST. If the mirror write fails, the marker is not set, so a Lemon retry
      // re-applies the event (a revoke/cancel can never be permanently skipped
      // by a partial KV failure).
      if (result.changed) {
        await kv.set(entitlementKey(built.entitlementId), JSON.stringify(result.record), { ttlMs: ENTITLEMENT_MIRROR_TTL_MS });
      }
      await kv.set(idemKey, '1', { ttlMs: WEBHOOK_IDEMPOTENCY_TTL_MS });

      if (!result.changed) return { ok: true, applied: false, reason: 'reason' in result ? result.reason : 'ignored' };

      // Sanitized log: never the raw license key/email — only the opaque id and
      // the state transition. Session enforcement is automatic (the next Pro
      // request re-derives this entitlement and sees the new state).
      if (shouldInvalidateSessions(result.prevState, deriveEntitlementState(result.record, tNow))) {
        logger.info?.('lemon.webhook.invalidate', { entitlement: built.entitlementId.slice(0, 12), from: result.prevState, to: result.nextState });
      }
      return { ok: true, applied: true, reason: result.nextState };
    },
  };
}
