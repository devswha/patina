# Pro launch monitor dashboard and drill v1

This is an operator procedure for the implemented private monitor. It does not provision,
auto-provision, or assume any external dashboard.

Read the aggregate definitions and calculations in
[Pro launch monitor queries v1](../queries/pro-launch-v1.md) before using a dashboard.

## Manual dashboard view

Use a read-only view scoped to exactly one `channel` and `tier=pro`. Show the
current evaluation UTC time, the 15-minute safety/entitlement log window, the
30-minute monitor-drop log window, the current-plus-overlapping-quarter
30-minute counter window (using bucket-end bounds), and these values without
merging channels or tiers:

- `numberSafety`, `entitlementNonOk`, `entitlementTotal`, and `monitorDrop`;
- all four completed-latency counts (`<=30s`, `30-60s`, `60-120s`, `>120s`), `n`, the
  conservative p95 rank, its bucket/bound, and `>120s / n`;
- synthetic success/failure and consecutive failure streak;
- aggregate availability and log-query availability;
- active signal names, Discord delivery result, deduplication result, and recovery result.


The monitor signals are: number safety at one or more 15m events; entitlement only when
non-ok is at least 5 **and** total is at least 20; synthetic failure after three consecutive
failures; p95 `>120s` and tail ratio `>5%` only with `n >= 10`; and monitor blindness when
there is no aggregate in the complete 30m bucket set, logs are unavailable, or
`monitorDrop >= 3`.

## Cron and synthetic operation

`vercel.json` schedules the private `/api/pro-monitor` route every 15 minutes.
The endpoint accepts only a bodyless `GET` with exactly one Authorization value
equal to `Bearer <CRON_SECRET>`. Repeated, comma-joined, absent, or incorrect
Authorization values are unauthorized. Keep `CRON_SECRET` only in the
deployment secret manager.

The monitor sends a synthetic Pro rewrite using fixed health-check text and
tier `pro`. It has one whole-run deadline of **55 seconds or less**, covering
network operations, incrementally read response bodies capped at 64 KiB,
synthetic execution, Discord attempts, and retry delays. Its required
production secret-manager environment names are:

```text
PATINA_OBSERVABILITY_REST_API_URL
PATINA_OBSERVABILITY_REST_API_TOKEN
CRON_SECRET
PATINA_DEPLOYMENT_CHANNEL=production
PATINA_PUBLIC_BASE_URL
PATINA_PUBLIC_BASE_URL_SHA256
PATINA_SYNTHETIC_PRO_LICENSE
PATINA_SYNTHETIC_OBSERVER_SECRET
PATINA_VERCEL_LOG_QUERY_URL
PATINA_VERCEL_LOG_QUERY_URL_SHA256
PATINA_VERCEL_LOG_QUERY_TOKEN
PATINA_ALERT_DISCORD_WEBHOOK
VERCEL_GIT_COMMIT_SHA
```

The observability URL/token identify a dedicated strict Upstash store for
telemetry and monitor state, never the quota/admission KV. The external
aggregate-only log-query service and synthetic base URL are mandatory: their
exact HTTPS URLs must match their lowercase-hex SHA-256 pins. The aggregate
service emits only exact closed counts `numberSafety`, `entitlementNonOk`,
`entitlementTotal`, and `monitorDrop` for the requested channel/tier/window—
never raw Vercel logs. Missing, unpinned, or unavailable required
aggregate/log input means monitor `503` and checkout remains disabled.

`PATINA_DEPLOYMENT_CHANNEL` must be exactly `production` or `staging`; it
selects the matching isolated monitor scope. Any other or missing value makes
the monitor unavailable. `VERCEL_GIT_COMMIT_SHA` is Vercel-provided deployment
binding, not a secret, and must be exactly 40 lowercase hexadecimal
characters. A missing or malformed value makes the monitor unavailable. The
synthetic request has exactly one
`x-patina-synthetic-observer` header equal to
`PATINA_SYNTHETIC_OBSERVER_SECRET`. The trusted rewrite boundary verifies it
and strips it before the runner. Do not place any value above, the header
value, a raw synthetic response, or raw error details in browser
configuration, source control, logs, dashboard annotations, Discord payloads,
or OBS receipts.

Synthetic failures increment a per-channel, `tier=pro` streak; success resets
it. At three failures, alert `synthetic_failure`. A synthetic request is an
operational probe, never customer traffic and never a substitute for
entitlement or aggregate denominators.


## Discord alerts, outbox, and recovery

For each trigger, the monitor sends an aggregate-only Discord payload. It
retries up to three times with real 1-second then 2-second backoff, bounded by
the one <=55-second whole-monitor deadline. Delivery is successful only on a
2xx response with a safe receipt ID; timeout, non-2xx, malformed/missing
receipt, deadline expiry, or raw error is failed delivery.

On a successful alert acknowledgement, atomically write its pending-alert
outbox record, active linkage, and deduplication state. Active linkage lasts
2 hours; the per-channel/tier/trigger dedup lease lasts 1 hour. Failed delivery
releases its dedup lease and creates neither a Gate-B OBS receipt nor a final
receipt. Pending alert records and blind-alert ACKs are operationally durable
outbox/dedup/recovery state, not Gate-B evidence. An unacknowledged blindness
condition, including unavailable required aggregate/log input, makes the
endpoint return `503` and keeps checkout disabled.

After the trigger set is healthy, a Discord recovery must itself be
acknowledged. Atomically consume the linked pending alerts, recovery lease, and
active linkage only then. The recovery lease lasts 1 hour. Issue final
append-only `OBS-ALERT-v1` evidence only after this acknowledged healthy
recovery and only for `realPath: true`; never issue it at alert time.


## Rotation, rollback, and drill evidence

Rotate `CRON_SECRET`, `PATINA_SYNTHETIC_PRO_LICENSE`,
`PATINA_SYNTHETIC_OBSERVER_SECRET`, `PATINA_OBSERVABILITY_REST_API_TOKEN`,
`PATINA_VERCEL_LOG_QUERY_TOKEN`, and `PATINA_ALERT_DISCORD_WEBHOOK` in the
secret manager using overlap where the external service supports it: add the
replacement, deploy, run an authorized monitor check, verify
synthetic/log/alert/recovery delivery without exposing values, then revoke the
old value and verify again. Treat `PATINA_OBSERVABILITY_REST_API_URL`,
`PATINA_VERCEL_LOG_QUERY_URL`, its SHA-256 pin, and
`PATINA_PUBLIC_BASE_URL` as reviewed server-only configuration, never browser
values. `VERCEL_GIT_COMMIT_SHA` is Vercel-provided deployment metadata: verify
its exact 40-lowercase-hex value for the deployed artifact; do not rotate or
override it. For suspected compromise, close sales first and follow the
incident process; consider service kill separately.

To roll back monitor configuration, restore the previously approved secret/config version,
run the authorized monitor check, and record its result. Do not roll back by disabling
customer entitlement or by copying secrets into evidence.

Final evidence is issued only after acknowledged healthy recovery. Each final
append-only `OBS-ALERT-v1` record is written without a TTL at
`patina:monctl:v1:{channel}:pro:obs:{receiptId}`; the matching durable recovery
record is `patina:monctl:v1:{channel}:pro:recovery:{recoveryId}`. Operational
deduplication, active, recovery, and pending-alert leases retain their bounded
TTLs, but final records are never overwritten or expired.

The final receipt is one closed top-level object with exactly:
`schemaVersion`, `receiptId`, `issuedAt`, `issuer`, `deploymentId`, `channel`,
`tier`, `realPath`, `namespace`, `eventSchema`, `eventSchemaVersion`,
`eventSchemaHash`, `configHash`, `ruleVersion`, `trigger`, `window`,
`countBand`, `denominators`, `latency`, `cronAuthorized`, `syntheticTerminal`,
`syntheticStreak`, `discord`, `dedupControlKey`, `pendingAlertKey`,
`recoveryId`, and `artifactHash`. It contains no `original` or `recovery`
blob. `issuedAt` is the real UTC ISO timestamp at healthy recovery.
`countBand` is exactly one of `1`, `2-4`, `5-9`, `10-19`, or `20+`.
`denominators` has exactly `productionAggregate`, `entitlementTotal`,
`entitlementNonOk`, `histogram`, `numberSafety`, and `monitorDrop`.
`latency` has exactly the four closed bucket counts, `n`, `p95Rank`,
`over120Ratio`, and `ruleVersion`; `discord` has exactly 2xx status and
attempt count. `pendingAlertKey` is the pending KV key and is distinct from
the Discord receipt ID.

`schemaVersion` is `OBS-ALERT-v1`; `issuer` is `patina.pro-monitor`;
`deploymentId` is the exact Vercel-provided 40-lowercase-hex commit SHA;
`tier` is `pro`; `realPath` is `true`; `namespace` is `patina:mon:v1`;
`eventSchema` is `patina.web.v1`; `eventSchemaVersion` is `v1`; and
receipt/histogram `ruleVersion` is `pro-monitor.histogram.v1`.

`eventSchemaHash` is SHA-256 over the canonical closed event schema;
`configHash` is SHA-256 over canonical schema/namespace/channel/tier,
rule version, and exact reviewed server-only observability, log-query, and
public-base configuration URLs; `artifactHash` is independently recomputed
as SHA-256 over the canonical final receipt payload before `artifactHash` is
added.

Receipt evidence must be complete and internally valid. Malformed/incomplete
evidence, absent/malformed pinned aggregate service or public base URL,
missing/malformed `VERCEL_GIT_COMMIT_SHA`, deadline expiry, append conflict, or
unacknowledged blindness makes the endpoint return `503` and issue no final
receipt. Existing final receipts are never overwritten.

OBS receipts must exclude text, prompt, output, secrets, IP addresses, request
IDs, raw/HMAC license material, UTM data, headers, raw Discord responses, and
raw errors.

Never use directly seeded KV counters, mocked log results, hand-written
dashboard values, simulated Discord acknowledgements, or injected test results
as launch/drill evidence. They may validate code only; they cannot support Gate
D, Gate B, or recovery claims.
