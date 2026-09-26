// @ts-check

// Polar license-key entitlement evaluation for the patina Pro tier.
//
// Scope of this module: the PROVIDER-SPECIFIC half of the entitlement gate —
// building the validate request and judging the response. The
// provider-independent half (HMAC subjects, positive/negative caching,
// single-flight locking, RPM admission, redaction, fail-closed defaults) lives
// in src/entitlement.js and is reused rather than duplicated;
// createPolarLicenseValidator wires the two together.
//
// Provider notes that shaped this file (Polar docs, retrieved 2026-07-29):
//   - The validate endpoint is on the customer portal and takes no server
//     secret: POST /v1/customer-portal/license-keys/validate with
//     { key, organization_id }. `organization_id` is required precisely so a
//     key issued by one Polar organization cannot validate against another.
//   - Polar states explicitly that an organization may issue several kinds of
//     license key, and that callers offering more than one MUST additionally
//     scope on `benefit_id`. Patina sells exactly one paid benefit, so
//     benefit_id is checked as a hard gate, not an optional refinement.
//   - Activation instances are only required when the benefit sets an
//     activation limit. Patina leaves that unset, so no activation_id is sent
//     and the response's `activation` field is ignored.
//   - Polar carries its own cumulative `limit_usage`/`usage` quota. It is NOT
//     used for metering here: patina's allowance resets on the UTC month
//     boundary (PATINA_PRO_REQ_PER_MONTH) and Polar's counter never resets, so
//     mixing them would silently shorten a paying month.
//
// The fail-closed posture returns every failed check as a
// generic 403 LICENSE_INVALID to the caller, and the specific reason is
// carried only in `detail` for server-side logging. `detail` never contains
// the license key.

import { createLicenseValidator } from './entitlement.js';
import { QUOTA_REASONS } from './web-rewrite-contract.js';

/** Polar's customer-portal validate endpoint (no server credential required). */
export const POLAR_LICENSE_VALIDATE_URL = 'https://api.polar.sh/v1/customer-portal/license-keys/validate';
/** Sandbox counterpart, used for pre-approval integration testing. */
export const POLAR_SANDBOX_LICENSE_VALIDATE_URL = 'https://sandbox-api.polar.sh/v1/customer-portal/license-keys/validate';

/**
 * `license_key.status` values that entitle. Polar grants a key on purchase and
 * revokes it when the subscription ends, so `granted` is the only entitled
 * state; anything else (revoked/disabled) is a denial.
 */
const ENTITLED_STATUSES = new Set(['granted']);

/**
 * Resolve the validate endpoint for the configured environment.
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {string}
 */
export function polarValidateUrl(env = {}) {
  return env.POLAR_SERVER === 'sandbox' ? POLAR_SANDBOX_LICENSE_VALIDATE_URL : POLAR_LICENSE_VALIDATE_URL;
}

/**
 * Build the validate request body. The organization ID is server configuration,
 * never caller-supplied, so a request can never be pointed at another org. The
 * entitlement core only calls this with a non-empty license after
 * POLAR_PROVIDER.configured has confirmed the organization ID.
 *
 * @param {string} license Raw license key from the Authorization header.
 * @param {Record<string, string|undefined>} [env]
 * @returns {{key: string, organization_id: string|undefined}}
 */
export function buildPolarValidateRequest(license, env = {}) {
  return { key: license, organization_id: env.POLAR_ORGANIZATION_ID };
}

/**
 * Pure allow/deny evaluation of a Polar validate response against the
 * configured organization and benefit. It reads named fields only: the same
 * response carries the purchaser's `user` and `customer` objects (email, name,
 * avatar URL and IDs), which must never reach a log, KV value or result.
 *
 * Like the shared entitlement core, on any failed check
 * the PUBLIC result is a generic 403 LICENSE_INVALID, and the failing check is
 * exposed only through the non-authoritative `detail` field for server-side
 * logging — never returned to the client and never containing the license.
 *
 * @param {any} data Parsed Polar validate response body.
 * @param {Record<string, string|undefined>} [env]
 * @param {number} [now] Epoch ms used to evaluate expiry.
 * @returns {{ok: true, status: string, expiresAt: number|null}|{ok: false, status: 403, reason: string, detail: string}}
 */
export function evaluatePolarLicenseResponse(data, env = {}, now = Date.now()) {
  const deny = (/** @type {string} */ detail) => (
    /** @type {{ok: false, status: 403, reason: string, detail: string}} */ (
      { ok: false, status: 403, reason: QUOTA_REASONS.LICENSE_INVALID, detail }
    )
  );

  if (!data || typeof data !== 'object' || Array.isArray(data)) return deny('malformed-response');

  const status = data.status;
  if (typeof status !== 'string') return deny('status-missing');
  if (!ENTITLED_STATUSES.has(status)) return deny(`status-${status}`);

  // Organization scoping. The request already pins organization_id, but the
  // response is re-checked so a proxy or a future endpoint change cannot widen
  // the gate silently.
  const wantOrganization = env.POLAR_ORGANIZATION_ID;
  if (typeof wantOrganization !== 'string' || wantOrganization === '') return deny('organization-not-configured');
  if (String(data.organization_id) !== String(wantOrganization)) return deny('organization-mismatch');

  // Benefit scoping. Polar warns that one organization can issue several key
  // types; without this, a key from any other benefit in the same org would
  // entitle the paid tier.
  const wantBenefit = env.POLAR_PRO_BENEFIT_ID;
  if (typeof wantBenefit !== 'string' || wantBenefit === '') return deny('benefit-not-configured');
  if (String(data.benefit_id) !== String(wantBenefit)) return deny('benefit-mismatch');

  // Expiry: absent/null entitles (a live subscription has no end date); present
  // must parse to a strictly future instant.
  let expiresAt = /** @type {number|null} */ (null);
  const rawExpiry = data.expires_at;
  if (rawExpiry !== null && rawExpiry !== undefined) {
    const parsed = Date.parse(rawExpiry);
    if (!Number.isFinite(parsed) || !(parsed > now)) return deny('expired');
    expiresAt = parsed;
  }

  return { ok: true, status, expiresAt };
}
/**
 * Whether a non-2xx validate response is a DEFINITIVE license verdict rather
 * than a transient outage.
 *
 * This distinction is the difference between a correct 403 and a misleading
 * 503. Measured against the live endpoint on 2026-07-29: an unknown key
 * answers **HTTP 404 `{"error":"ResourceNotFound","detail":"Not found"}`** —
 * Treating that 404 as "unavailable" would report every invalid license as a service
 * outage, and would re-charge the admission bucket on every retry of a key
 * that will never validate.
 *
 * Deliberately narrow, because the cost of a false "definitive" is a cached
 * denial for a paying customer:
 *   - 429 is Polar's own rate limiting -> transient, never a verdict.
 *   - 5xx is an outage -> transient.
 *   - 422 means WE sent a malformed request (e.g. a bad organization ID
 *     shape) -> server misconfiguration, not an invalid customer key.
 *   - 401/403 concern the caller's own authorization, not the key's validity.
 * Only 404 ResourceNotFound is accepted as "this key does not exist here".
 *
 * @param {number} status HTTP status of the validate response.
 * @param {any} body Parsed response body, or null when unparseable.
 * @returns {boolean}
 */
export function isPolarDefinitiveDenial(status, body) {
  if (status !== 404) return false;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  return body.error === 'ResourceNotFound';
}

/**
 * Conservative default for the validate admission bucket, in requests per
 * minute.
 *
 * Measured, not assumed: five validate calls in a few seconds were enough to
 * draw `429` with `retry-after: 21` from the sandbox endpoint. Polar publishes
 * no explicit number for this endpoint, so the shipped default is deliberately
 * far below the observed breaking point — the positive cache means a Pro seat
 * validates roughly once per cache TTL rather than once per rewrite, so a low
 * ceiling costs nothing in practice and prevents a burst from turning every
 * paying customer's request into a 503.
 */
const POLAR_DEFAULT_VALIDATE_RPM = 10;

/**
 * Polar provider descriptor for the shared entitlement core.
 *
 * @type {import('./entitlement.js').LicenseProvider}
 */
export const POLAR_PROVIDER = {
  id: 'polar',
  url: (env) => polarValidateUrl(env),
  configured: (env) => Boolean(env.POLAR_ORGANIZATION_ID && env.POLAR_PRO_BENEFIT_ID),
  request: (license, env) => ({
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(buildPolarValidateRequest(license, env)),
  }),
  isDefinitiveDenial: isPolarDefinitiveDenial,
  evaluate: evaluatePolarLicenseResponse,
  defaultRpm: POLAR_DEFAULT_VALIDATE_RPM,
  // Polar's error field is a short machine code ("ResourceNotFound"), safe to
  // log. The rest of the body carries the purchaser's `user` and `customer`
  // objects (email, name, avatar URL and IDs) and is never passed anywhere.
  errorText: (data) => (data && typeof data.error === 'string' ? data.error : undefined),
};

/**
 * Build the Polar license validator. Shares the entire security machinery with
 * the shared entitlement core (HMAC subjects, two-layer cache, cross-instance
 * single-flight lock, RPM admission, redaction, fail-closed defaults).
 *
 * Cache and lock keys are namespaced by the provider id, so switching vendors
 * cannot serve a decision cached under the previous one.
 *
 * @param {Omit<Parameters<typeof createLicenseValidator>[0], 'provider'>} [options]
 * @returns {ReturnType<typeof createLicenseValidator>}
 */
export function createPolarLicenseValidator(options = {}) {
  return createLicenseValidator({ ...options, provider: POLAR_PROVIDER });
}
