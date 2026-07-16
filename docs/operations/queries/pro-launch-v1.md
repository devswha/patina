# Pro launch monitor queries v1

Use these read-only, aggregate-only recipes for the private Pro monitor. They describe the
implemented `patina.web.v1` contract; they do not create dashboards, alerts, or external
resources.

## Event and counter contract

Accepted event fields are exactly `schemaVersion`, `schema`, `channel`, `evidenceClass`,
`tier`, `outcome`, `latencyBucket`, `statusClass`, and `sampling`. Required constants are
`schemaVersion: "v1"`, `schema: "patina.web.v1"`, and
`evidenceClass: "aggregate_only"`.

- Channels: `production`, `staging` (invalid input is emitted as `unknown`, but never
  aggregated).
- Tiers: `free`, `byok`, `pro`, `unknown`.
- Outcomes: `completed`, `terminal_failed`, `number_safety_failed`,
  `entitlement_denied`, `entitlement_unavailable`, `quota_denied`,
  `service_disabled`, `monitor_drop`, `unknown`.
- Latency buckets: `<=30s`, `30-60s`, `60-120s`, `>120s`, or `unknown`; only the first
  four are aggregate keys. `statusClass` is `1xx` through `5xx` or `unknown`.
  `sampling` is `full` or `sampled_1_of_20`.

Never query or record request text, prompts, outputs, raw licenses, Authorization headers,
payment data, customer identifiers, user-data checkout URLs, provider/KV/HMAC credentials,
or cron, log-query, synthetic-license, or Discord webhook secrets.

The only aggregate counter shape is:

```text
patina:mon:v1:{channel}:{tier}:{YYYYMMDDTHHmmZ}:{outcome}:{latencyBucket}
```

`YYYYMMDDTHHmmZ` is the UTC start of a real 15-minute quarter. In the dedicated
strict observability Upstash store only, increment an integer atomically with
TTL `7200` seconds (2 hours). Do not use quota/admission KV, write floats,
sets, payloads, or a different TTL. Keep channel and tier in every key: never
combine staging with production or one tier with another. Monitor state uses
only the separate control-key shape
`patina:monctl:v1:{channel}:{tier}:{suffix}` for synthetic streak,
pending-alert outbox, active linkage, deduplication, and recovery leases; it is
likewise never channel- or tier-shared.


## Query window and denominator rules

At evaluation time `now`, read the current quarter plus every real UTC quarter
whose **bucket end** is strictly after `now - 30 minutes`; do not select
quarters by start time alone. For example, at `12:00Z`, read `11:30Z`,
`11:45Z`, and `12:00Z`. Sum each requested dimension across that complete
overlapping set. A zero total over the complete set is
`no_production_aggregate` and therefore `monitor_blind`; do not silently
replace it with a partial or stale window.


For log-derived signals, call the required external aggregate-only query
service with the monitor channel and `tier=pro`. Its exact HTTPS URL is pinned
by `PATINA_VERCEL_LOG_QUERY_URL_SHA256`; the synthetic target's exact HTTPS
base URL is separately pinned by `PATINA_PUBLIC_BASE_URL_SHA256`. Neither may
expose raw Vercel logs. The safety/entitlement query window is 15 minutes; the
monitor-drop query window is 30 minutes. Each successful response is an object
(or its `data` object) containing only these exact non-negative integer keys,
including zeroes:

```text
numberSafety
entitlementNonOk
entitlementTotal
monitorDrop
```

Do not query or record raw logs, request IDs, IP addresses, text, prompts,
outputs, headers, licenses, UTM data, raw errors, or any identifier. A
missing/unpinned service, transport failure, non-2xx response, invalid JSON,
non-closed object, or wrongly scoped result is `log_unavailable` and therefore
`monitor_blind`; the monitor returns `503` and checkout stays disabled, never
treating it as zero.


## Signal recipes

| Signal | Read / calculation | Trigger |
|---|---|---|
| Number safety | `numberSafety` over 15m | `numberSafety >= 1` |
| Entitlement | `entitlementNonOk` and `entitlementTotal` over 15m | both `entitlementTotal >= 20` and `entitlementNonOk >= 5` |
| Latency histogram | Sum `completed` counters for each of `<=30s`, `30-60s`, `60-120s`, `>120s` across the 30m overlapping-quarter window | See below; record all four counts and `n` |
| Monitor delivery | `monitorDrop` from the 30m log aggregate | `monitorDrop >= 3` means `monitor_blind` |

For latency, `n` is the sum of all four buckets. Compute the conservative p95 rank as
`ceil(0.95 * n)` and select the first bucket whose cumulative count reaches that rank. Its
reported bound is `30s`, `60s`, `120s`, or `>120s`—never interpolate inside a bucket.
When `n >= 10`, trigger `p95_latency` when the selected bucket is `>120s`. Also trigger
`latency_tail` when `>120s / n > 0.05`. No p95 or tail conclusion is valid when `n < 10`.

## Vercel log query

Configure `PATINA_VERCEL_LOG_QUERY_URL`,
`PATINA_VERCEL_LOG_QUERY_URL_SHA256`, and `PATINA_VERCEL_LOG_QUERY_TOKEN` only
in the server-side production secret manager. The SHA-256 is lowercase
hexadecimal over the exact configured URL. The monitor performs a read-only GET
with bearer authentication to this external service, never directly to raw
Vercel logs. The service derives channel, tier, and requested window from the
monitor request and returns no data other than the four exact aggregate counts
above. It separately aggregates `numberSafety`, `entitlementNonOk`, and
`entitlementTotal` over 15 minutes, and `monitorDrop` over 30 minutes, always
scoped to one channel and tier. `monitorDrop` counts only
`outcome="monitor_drop"`.

Absent, mismatched, malformed, or unavailable pinned service is monitor
unavailable (`503`) and keeps checkout disabled. A successful, correctly scoped
result with `monitorDrop >= 3` is `monitor_blind`, with reason `monitor_drop`.

See [dashboard and receipt procedure](../dashboards/pro-launch-v1.md).
