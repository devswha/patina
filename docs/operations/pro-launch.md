# Pro launch runbook

This is the v6.4 launch order for the browser checkout and the hosted Pro service.
It deliberately separates opening **new sales** from serving customers who have
already paid. Do not put payment-provider, monitor, webhook, provider, KV, or
HMAC secrets in this file, source control, the generated browser config, logs,
or support tickets.

## Launch configuration

Generate the browser configuration during deployment with exactly these four
non-secret inputs:
Run `npm run launch-config:generate` in the deployment environment after setting
the inputs; deploy the resulting `playground/launch-config.js` with that release.

| Input | Disabled/default behavior | Enabled requirement |
|---|---|---|
| `PATINA_PRO_CHECKOUT_ENABLED` | Missing or `false` generates disabled checkout. | Must be exactly `true`. |
| `PATINA_DEPLOYMENT_CHANNEL` | Not used while checkout is disabled. | Exactly `staging` or `production`. |
| `PATINA_PRO_CHECKOUT_URL` | Not used while checkout is disabled. | Absolute HTTPS URL with no userinfo, port, query, or fragment. |
| `PATINA_PRO_GATE_EVIDENCE_ID` | Not used while checkout is disabled. | Staging: `PAY-STG-` plus one or more ASCII letters, digits, `_`, or `-`; production: `PAY-B-` plus the same suffix. |

The generated public shape is `{schemaVersion:1, channel, enabled,
checkoutOrigin, checkoutPath, evidence}`. It contains the checkout origin and
path only, never a secret, payment-provider credential, or license key. Invalid
enabled configuration must fail the deployment/config generation rather than
publish a partly enabled checkout. An explicit `false` wins over all other
inputs.

Keep payment-provider dashboard/API credentials and alerting/monitor webhook
credentials only in the deployment secret manager. This runbook neither assumes
nor claims that Lemon credentials or customer receipts exist. The application
accepts a customer's license only in the `Authorization: Bearer <license_key>`
header; raw licenses are not a browser-config, log, or durable-memory value.
## Production monitor readiness

Before the checkout-disabled production deployment, provision the private
monitor in the production secret manager. It requires dedicated strict Upstash
observability `PATINA_OBSERVABILITY_REST_API_URL` and
`PATINA_OBSERVABILITY_REST_API_TOKEN`—never quota/admission `KV_REST_*`—plus
`CRON_SECRET`, `PATINA_DEPLOYMENT_CHANNEL=production`,
`PATINA_PUBLIC_BASE_URL`, `PATINA_PUBLIC_BASE_URL_SHA256`,
`PATINA_SYNTHETIC_PRO_LICENSE`, `PATINA_SYNTHETIC_OBSERVER_SECRET`,
`PATINA_VERCEL_LOG_QUERY_URL`, `PATINA_VERCEL_LOG_QUERY_URL_SHA256`,
`PATINA_VERCEL_LOG_QUERY_TOKEN`, `PATINA_ALERT_DISCORD_WEBHOOK`, and
Vercel-provided `VERCEL_GIT_COMMIT_SHA`.

The external aggregate-only log-query service and the exact public base URL are
mandatory and SHA-256 pinned. The service emits only exact `numberSafety`,
`entitlementNonOk`, `entitlementTotal`, and `monitorDrop` counts for the
requested channel/tier/window, never raw Vercel logs. Missing, unpinned,
malformed, or unavailable required aggregate/log input makes the monitor return
`503`; leave checkout disabled.

`vercel.json` invokes the private `/api/pro-monitor` route every 15 minutes.
The cron request is a bodyless `GET` with one exact `Authorization: Bearer
<CRON_SECRET>` value. The synthetic rewrite adds exactly one
`x-patina-synthetic-observer` header whose value is
`PATINA_SYNTHETIC_OBSERVER_SECRET`; the trusted boundary strips that header
before the rewrite runner. Neither the header nor its value is telemetry.

Aggregate keys have their documented 2-hour TTL in the dedicated observability
store. Monitor control keys are channel/tier scoped under
`patina:monctl:v1:{channel}:{tier}:...`. The whole monitor has one <=55-second
deadline, including every network read, incrementally read response body capped
at 64 KiB, synthetic work, Discord attempts, and actual 1-second then 2-second
backoff.

An acknowledged Discord alert atomically creates a pending-alert outbox record,
2-hour active linkage, and 1-hour dedup lease. Pending records and blind-alert
ACKs are operationally durable for deduplication and recovery, but are not
Gate-B OBS receipts. If blindness is unacknowledged, including a required
aggregate/log input failure, the endpoint returns `503` and checkout remains
disabled. Final `OBS-ALERT-v1` evidence is issued only after an ACKed healthy
recovery atomically consumes linked pending alerts and active linkage, and only
when the recovered evidence has `realPath: true`; its recovery lease is 1 hour.
Missing/malformed deployment binding, malformed/incomplete evidence, deadline
expiry, or append conflict returns `503` with no final receipt. Gate D requires
only final real-path receipts matching the dashboard contract.


## Evidence

Create an immutable launch record outside this repository containing: deploy
commit and immutable artifact, UTC operator/time, environment, generated config
(with secrets omitted), owner approvals, health result, and rollback result.

Evidence identifiers are release controls, not free-form labels:

- Staging checkout evidence must match `PAY-STG-[A-Za-z0-9][A-Za-z0-9_-]*`.
- Production checkout evidence must match `PAY-B-[A-Za-z0-9][A-Za-z0-9_-]*`.

Do not reuse an identifier for a different environment or release. A Gate D
approval is recorded in the launch record; it does not change the production
config prefix from `PAY-B-`.

## Staging

1. Keep production checkout disabled.
2. Set `PATINA_PRO_CHECKOUT_ENABLED=true`, `PATINA_DEPLOYMENT_CHANNEL=staging`,
   a vetted staging HTTPS checkout URL, and a fresh `PAY-STG-...` evidence ID in
   the staging secret/deployment environment.
3. Generate and inspect the public config: it must have `schemaVersion: 1`,
   `channel: 'staging'`, `enabled: true`, the expected origin/path, and only the
   evidence ID. Confirm it has no query string, credential, or secret.
4. Exercise the browser CTA, cancel/back path, unavailable checkout path, and
   the post-purchase license entry flow using approved staging access. Verify
   that an absent or invalid Authorization header is denied and no raw license
   appears in client storage, logs, or KV keys.
5. Record results in the evidence record. On any uncertainty, set checkout back
   to disabled and regenerate before proceeding.

## Gate B

Gate B authorizes a production checkout candidate, not an unreviewed payment
integration. Require the staging evidence, reviewed production checkout URL,
server health/admission checks, rollback owner, support/cancel path, telemetry
and PII review, and an approved `PAY-B-...` evidence ID.

After Gate B, deploy **production with checkout still disabled first**:
`PATINA_PRO_CHECKOUT_ENABLED=false`. Generate and inspect the config and verify
that it is exactly disabled (`channel: 'disabled'`, `enabled: false`, and null
checkout origin, path, and evidence). Verify existing Pro authorization paths
remain fail-closed when upstream validation, production KV, HMAC, or Pro
provider configuration is unavailable. This production-first deployment proves
the service release before it can accept a new sale. Monitor readiness is part
of it: verify the scheduled cron route and server-only configuration, then
record a real-path OBS receipt before Gate D. A monitor configuration failure
leaves checkout disabled; it is not waived by a browser-only health check.

## Gate D

Gate D is the final live-open decision after the checkout-disabled production
release is healthy. Reconfirm the deployed artifact, production health and
alerts, browser disabled state, sales-close operator, support/cancel/refund
coverage, and the 10-minute sale-close drill result. Record named approvers and
the UTC decision in the launch evidence record.

A failed or missing Gate D check means leave checkout disabled. Do not substitute
a dashboard observation, an assumed Lemon credential, or a presumed receipt for
recorded evidence.

## Live open

1. Starting from the approved checkout-disabled production artifact, set
   `PATINA_PRO_CHECKOUT_ENABLED=true`, `PATINA_DEPLOYMENT_CHANNEL=production`,
   the approved HTTPS checkout URL, and the approved `PAY-B-...` evidence ID.
2. Generate and deploy the browser config atomically with the approved release.
3. Inspect the deployed config and CTA. It must be production, enabled, and
   limited to the approved origin/path; it must not expose secrets or a full URL
   with query data.
4. Monitor CTA errors, checkout handoff failures, authorization denial classes,
   validation latency/errors, Pro admission failures, and incident alerts. Do
   not log license keys or customer-entered payment data.
5. Record live-open UTC time, artifact identity, and operator in the evidence
   record.

## Sale close

Sale close stops **new checkout starts only**. It does not disable existing paid
service.

1. Set `PATINA_PRO_CHECKOUT_ENABLED=false` in production and regenerate/deploy
   the public config.
2. Verify the deployed config is the disabled shape and the browser no longer
   offers a usable checkout CTA.
3. Keep the hosted Pro API, license validation, existing subscriptions/licenses,
   and paid-service monitoring running unless a separate service-kill decision
   is made.
4. Record the close time, artifact, reason, and verification.

### 10-minute sale-close drill

Before live open and at each release rehearsal, time a drill from the sale-close
instruction to verified disabled checkout. The target is **10 minutes or less**:
set the flag false, regenerate/deploy, confirm the disabled config and browser
CTA, and record start/end UTC timestamps. A drill failure blocks Gate D until
remediated and repeated.

## Service kill

Service kill is a separate incident action: it disables the hosted paid-service
path for existing customers as well as new sales. First close sales using the
sale-close procedure. Then use the approved hosting incident control to stop
Pro traffic or take the service offline, while preserving only the minimum
incident evidence without raw licenses or payment data. Notify support, record
the scope and time, and restore only after an owner approves recovery.

Do not describe a sale close as a service kill, and do not service-kill merely
to stop new purchases.

## Fallback and customer copy

When checkout is disabled or unavailable, show a neutral, non-deceptive message:

> Pro checkout is temporarily unavailable. Existing Pro access is unchanged.

When the paid service is unavailable after purchase:

> Pro service is temporarily unavailable. We are investigating; do not share
your license key in support messages.

Do not promise purchase status, refunds, receipt delivery, or provider behavior
that has not been verified. Support must collect a minimal non-secret reference
through the approved private channel and never ask customers to paste license
keys into public or ticket text.

## Cancel, refund, and revoke

Use the payment-provider dashboard only after an authorized operator verifies
the request through the approved support identity process. Record an internal
case reference, operator, UTC time, action, and customer-facing outcome without
storing a raw license or payment credential in application logs.

Cancellation and refund are provider-side commercial actions; they are not proof
that an entitlement is already revoked. Revoke/disable service access through
the approved provider/entitlement process, then verify the application's next
license validation denies access within its configured cache/propagation bound.
Document the result. Do not assert that a receipt or provider credential exists
unless it has been independently verified for that case.

## Telemetry and PII

Collect operational aggregates needed for launch safety: deploy/config version,
checkout CTA/handoff result, status/error class, latency, authorization outcome,
and alert state. Launch and monitor telemetry is aggregate-only. For the approved
v6.4 monitor, G001 browser telemetry must never store raw license subjects or
HMAC-derived per-license identifiers. Exclude raw license keys, Authorization
headers, payment data, checkout URLs containing user data, provider credentials,
and monitor secrets.
Use the versioned [monitor query recipes](queries/pro-launch-v1.md) and
[dashboard/drill procedure](dashboards/pro-launch-v1.md) for G003 telemetry; they are
aggregate-only and do not provision external dashboards.

## Drills

Run and record these drills before Gate D:

- Disabled-default drill: remove/false the checkout flag and verify the exact
  disabled public config.
- Invalid-config drill: use an invalid channel, URL, or evidence prefix and
  verify generation fails rather than opens checkout.
- Staging drill: prove a `PAY-STG-...` release cannot be represented as a
  production checkout.
- Sale-close drill: complete the timed 10-minute procedure above while keeping
  existing paid service available.
- Service-kill drill: rehearse the separate escalation and restoration path in
  a non-production-safe environment.
- License safety drill: verify missing/invalid Authorization is denied and test
  evidence/log output contains no raw key.
- G003 monitor drill: use the versioned
  [dashboard/drill procedure](dashboards/pro-launch-v1.md) with the
  [query recipes](queries/pro-launch-v1.md); record a real-path OBS receipt,
  not seeded counters, mocked delivery, or injected test results. Injected
  tests validate code only and are not live evidence.

## Secret rotation

Rotate payment-provider, monitor/webhook, provider, KV, and HMAC secrets in the
secret manager—not in browser configuration or this repository. Use a two-party
or staged rotation where the provider supports overlap: add the replacement,
deploy it, verify health and alert delivery without logging values, revoke the
old secret, and verify again. For a suspected compromise, immediately close new
sales, rotate the affected secret, assess whether a service kill is required,
and record the incident. Rotate HMAC material only with a migration plan that
preserves the intended entitlement/rate-limit behavior or deliberately invalidates
it under an approved incident decision.
