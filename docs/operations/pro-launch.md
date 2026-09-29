# Pro launch runbook

This runbook describes browser checkout configuration and the hosted Pro service.
Opening new sales and serving existing customers use separate controls.

## Launch configuration

Generate the browser configuration during deployment with exactly these four
non-secret inputs. Enabled values must exactly match a source-controlled checkout
evidence binding keyed by `{channel, evidence, origin, path}`.
Run `npm run launch-config:generate` in the deployment environment after setting
the inputs; deploy the resulting `playground/launch-config.js` with that release.

| Input | Disabled/default behavior | Enabled requirement |
|---|---|---|
| `PATINA_PRO_CHECKOUT_ENABLED` | Missing or `false` generates disabled checkout. | Must be exactly `true`. |
| `PATINA_DEPLOYMENT_CHANNEL` | Not used while checkout is disabled. | Matches the binding channel; the current table has only `production`. The parser also recognizes `staging`. |
| `PATINA_PRO_CHECKOUT_URL` | Not used while checkout is disabled. | Exact bound provider HTTPS checkout URL (production: `https://buy.polar.sh/polar_cl_*`): no userinfo, port, query, fragment, alternate host/subdomain, encoded path, or trailing slash. |
| `PATINA_PRO_GATE_EVIDENCE_ID` | Not used while checkout is disabled. | Staging: `PAY-STG-`; production: `PAY-B-`; exact bound evidence ID in either case. |

`scripts/checkout-evidence-bindings.mjs` is the only authorization table. Its
bindings are deeply frozen; environment values alone can never enable checkout.
Each binding records the provider checkout URL and its `PAY-STG`/`PAY-B`
evidence identifier. Invalid enabled configuration fails generation rather than publishing a partly enabled
checkout, and explicit `false` wins over every other input.

The generated public shape is `{schemaVersion:1, channel, enabled,
checkoutOrigin, checkoutPath, evidence}`. It contains the checkout origin and
path only, never a secret, payment-provider credential, or license key.

Keep payment-provider dashboard/API credentials and alerting/monitor webhook
credentials only in the deployment secret manager. This runbook neither assumes
nor claims that provider credentials or customer receipts exist. The application
accepts a customer's license only in the `Authorization: Bearer <license_key>`
header; raw licenses are not a browser-config, log, or durable-memory value.
## Production monitor readiness

Before the checkout-disabled production deployment, provision the private
monitor in the production secret manager. It requires dedicated strict Upstash
observability `PATINA_OBSERVABILITY_REST_API_URL` and
`PATINA_OBSERVABILITY_REST_API_TOKEN`—never quota/admission `KV_REST_*`—plus
`CRON_SECRET`, `PATINA_DEPLOYMENT_CHANNEL=production`,
`PATINA_PUBLIC_BASE_URL`, `PATINA_SYNTHETIC_PRO_LICENSE`,
`PATINA_SYNTHETIC_OBSERVER_SECRET`, `PATINA_VERCEL_LOG_QUERY_URL`,
`PATINA_VERCEL_LOG_QUERY_TOKEN`, `PATINA_ALERT_DISCORD_WEBHOOK`, and
Vercel-provided `VERCEL_GIT_COMMIT_SHA`.

The external aggregate-only log-query service and the public base URL are
mandatory. The service emits only exact `numberSafety`, `entitlementNonOk`,
`entitlementTotal`, and `monitorDrop` counts for the requested
channel/tier/window, never raw Vercel logs. Missing, malformed, or unavailable
required aggregate/log input makes the monitor return `503`; leave checkout
disabled.

`vercel.json` invokes the private `/api/pro-monitor` route every 15 minutes.
The cron request is a bodyless `GET` with one exact `Authorization: Bearer
<CRON_SECRET>` value. The synthetic rewrite adds exactly one
`x-patina-synthetic-observer` header whose value is
`PATINA_SYNTHETIC_OBSERVER_SECRET`; the trusted boundary compares it in
constant time and strips that header before the rewrite runner. Neither the
header nor its value is telemetry. Together with a license the validator
accepts, that header also exempts the probe from **monthly** metering only
(requests, characters, processing attempts, charged to a separate observer
namespace); the daily cap, the concurrency lease and license validation stay in
force, so the hourly probe can no longer exhaust the monitoring seat and report
its own `429` as a Pro failure.

Aggregate keys have their documented 2-hour TTL in the dedicated observability
store. Monitor control keys are channel/tier scoped under
`patina:monctl:v1:{channel}:{tier}:...`. The whole monitor has one <=55-second
deadline, including every network read, incrementally read response body capped
at 64 KiB, synthetic work, Discord attempts, and actual 1-second then 2-second
backoff.

An acknowledged Discord alert joins the 2-hour active list and holds a 1-hour
dedup lease. If blindness is unacknowledged, including a required
aggregate/log input failure, the endpoint returns `503` and checkout remains
disabled. Once the triggers clear, one acknowledged `monitor_recovered` message
atomically clears the active list; its recovery lease is 1 hour. A
missing/malformed deployment binding or deadline expiry returns `503`.


## Checkout evidence

The generator accepts `PAY-STG-[A-Za-z0-9][A-Za-z0-9_-]*` for staging and
`PAY-B-[A-Za-z0-9][A-Za-z0-9_-]*` for production. It matches the evidence ID,
channel, origin, and path against `scripts/checkout-evidence-bindings.mjs`.
The Polar production binding is documented by
`pay-b-binding-polar-20260729.json` and `pay-live-runtime-polar-20260729.json`.
Bindings are source-controlled configuration. Environment variables supply
the evidence ID and checkout URL at build time; the generator matches them
against that table. The generated public configuration is read at runtime.

## Staging and live configuration

The current source table contains only the production Polar binding, so enabled
staging checkout is unsupported. Tests inject a staging binding into their
fixture; environment variables cannot add one to a deployment.

Production uses `PATINA_DEPLOYMENT_CHANNEL=production`, the bound `PAY-B-...`
evidence ID and checkout URL, and Vercel's `VERCEL_ENV=production`. Setting
`PATINA_PRO_CHECKOUT_ENABLED=true` and running `npm run launch-config:generate`
produces the enabled config when those inputs match the source table.

The public config contains `schemaVersion: 1`, channel, enabled state,
checkout origin/path, and evidence ID. Useful browser checks include the CTA,
checkout handoff, cancel/back navigation, unavailable checkout, and license
entry. API checks cover missing/invalid authorization and upstream failures.
Deployment history and source SHAs make a change and its rollback reproducible.

## Sale close

Setting `PATINA_PRO_CHECKOUT_ENABLED=false` and regenerating/deploying the
public config stops new checkout starts. The disabled config has
`channel: 'disabled'`, `enabled: false`, and null checkout fields. Existing
paid API access and subscriptions continue independently.

The historical sale-close exercise targeted ten minutes. Observed timings are
in [rollback-drills.md](rollback-drills.md).

## Service interruption and recovery

Stopping the hosted Pro service also affects existing customers. Hosting
controls and deployment rollback manage that service independently of the
checkout flag. Recovery checks can exercise application health, license
validation, and monitoring on the restored deployment.

## Fallback and customer copy

When new checkout is unavailable:

> Pro checkout is temporarily unavailable. Existing Pro access is unchanged.

When the paid service is unavailable:

> Pro service is temporarily unavailable. We are investigating; do not share
> your license key in support messages.

## Cancel, refund, and revoke

Cancellations and refunds are payment-provider operations. Service entitlement
is checked separately by license validation and can have a cache/propagation
delay. Provider results and the application's next validation response describe
which steps have completed. Support records can use a case reference without
raw license or payment credentials.

## Telemetry and diagnostics

Launch and monitor telemetry uses aggregate status/error classes, latency,
authorization outcomes, and alert state. Browser telemetry has no raw license
subjects or HMAC-derived per-license identifiers. The
[query recipes](queries/pro-launch-v1.md) and
[dashboard/drill reference](dashboards/pro-launch-v1.md) describe the implemented
G003 data shapes.

Useful diagnostics include disabled/default configuration, invalid binding
rejection, staging/production separation, sale-close propagation, license
validation, and monitor recovery. Local injected fixtures exercise code; live
observations describe the deployment where they ran.

## Secret rotation

Secrets live in the deployment secret manager. Where a provider supports
credential overlap, rotation can add the replacement, deploy and check it,
then revoke the previous value. HMAC rotation can invalidate entitlement or
rate-limit identifiers, so its migration behavior depends on the incident and
service requirements.
