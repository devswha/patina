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
hourly probe failures, alert window `1h` (the probe cadence, not a log window: the count is
how many consecutive hourly probes failed); p95 `>120s` and tail ratio `>5%` only with
`n >= 10`; and monitor blindness when there is no aggregate in the complete 30m bucket set,
logs are unavailable, or `monitorDrop >= 3`.

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
PATINA_SYNTHETIC_PRO_LICENSE
PATINA_SYNTHETIC_OBSERVER_SECRET
PATINA_VERCEL_LOG_QUERY_URL
PATINA_VERCEL_LOG_QUERY_TOKEN
PATINA_ALERT_DISCORD_WEBHOOK
VERCEL_GIT_COMMIT_SHA
```

The observability URL/token identify a dedicated strict Upstash store for
telemetry and monitor state, never the quota/admission KV. The external
aggregate-only log-query service and synthetic base URL are mandatory public
HTTPS URLs (no port, query, credentials, or local host). The aggregate
service emits only exact closed counts `numberSafety`, `entitlementNonOk`,
`entitlementTotal`, and `monitorDrop` for the requested channel/tier/window—
never raw Vercel logs. Missing or unavailable required aggregate/log input
means monitor `503`.

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
configuration, source control, logs, dashboard annotations, or Discord
payloads.

The probe is budgeted to **one run per hour** by the
`synthetic-probe-budget` lease, and is skipped entirely while the cheap
adapters are blind. Synthetic failures increment a per-channel, `tier=pro`
streak; success resets it; a run that did not probe leaves it unchanged. At
three failures, alert `synthetic_failure` with window `1h`. The streak key
carries a **3-hour TTL**: it is written only by a run that actually probed, so
its TTL has to outlive the worst-case gap between two probes (budget interval
plus one cron tick plus the whole-run deadline, ~76 minutes) or the streak can
never reach three. Three hours also keeps it across one skipped probe while
still expiring after roughly two missed probes, so a stale streak cannot
contribute to a later alert. A synthetic request is an operational probe, never
customer traffic and never a substitute for entitlement or aggregate
denominators.

The probe is a real paid request and is admitted like one: license validation,
the pro concurrency lease and the daily cap all apply unchanged. Only its
**monthly** dimensions — monthly requests, monthly characters and the monthly
processing-attempt budget — are charged to a separate observer namespace rather
than the licensed seat, because ~24 probes a day would otherwise exhaust the
seat's monthly allowance within days and every later probe would report its own
`429` as a Pro outage. The exemption requires **both** the
`x-patina-synthetic-observer` value and a license the validator accepts; the
header alone (the free canary), a wrong value, or a request body field never
obtains it, and the exemption is never logged or echoed.


## Discord alerts and recovery

For each trigger, the monitor sends an aggregate-only Discord payload. It
retries up to three times with real 1-second then 2-second backoff, bounded by
the one <=55-second whole-monitor deadline. Delivery is successful only on a
2xx response carrying a safe Discord message ID; timeout, non-2xx,
malformed/missing message ID, deadline expiry, or raw error is failed delivery.

A delivered alert is added atomically to the active list while its dedup
lease is still held. The active list lasts 2 hours; the
per-channel/tier/trigger dedup lease lasts 1 hour. Failed delivery releases its
dedup lease so the next tick retries. An unacknowledged blindness condition,
including unavailable required aggregate/log input, makes the endpoint return
`503`.

After the trigger set is healthy, the monitor sends one `monitor_recovered`
message for the active list, guarded by a 1-hour recovery lease. Only once
Discord acknowledges it are the active list and recovery lease cleared,
atomically. The monitor writes no durable evidence records.


## Rotation, rollback, and drill evidence

Rotate `CRON_SECRET`, `PATINA_SYNTHETIC_PRO_LICENSE`,
`PATINA_SYNTHETIC_OBSERVER_SECRET`, `PATINA_OBSERVABILITY_REST_API_TOKEN`,
`PATINA_VERCEL_LOG_QUERY_TOKEN`, and `PATINA_ALERT_DISCORD_WEBHOOK` in the
secret manager using overlap where the external service supports it: add the
replacement, deploy, run an authorized monitor check, verify
synthetic/log/alert/recovery delivery without exposing values, then revoke the
old value and verify again. Treat `PATINA_OBSERVABILITY_REST_API_URL`,
`PATINA_VERCEL_LOG_QUERY_URL`, and
`PATINA_PUBLIC_BASE_URL` as reviewed server-only configuration, never browser
values. `VERCEL_GIT_COMMIT_SHA` is Vercel-provided deployment metadata: verify
its exact 40-lowercase-hex value for the deployed artifact; do not rotate or
override it. For suspected compromise, close sales first and follow the
incident process; consider service kill separately.

To roll back monitor configuration, restore the previously approved secret/config version,
run the authorized monitor check, and record its result. Do not roll back by disabling
customer entitlement or by copying secrets into evidence.

Never use directly seeded KV counters, mocked log results, hand-written
dashboard values, simulated Discord acknowledgements, or injected test results
as launch/drill evidence. They may validate code only; they cannot support Gate
D, Gate B, or recovery claims.
