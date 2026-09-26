# docs/operations — maintainer records

Runbooks and decision records for the hosted playground and the Pro service:
payment, serving engines, cost and margin, secrets, rollback and monitoring.
They are for maintainers. Nothing here is needed to run patina, and the
directory is excluded from the npm tarball (`package.json` `files`:
`!docs/operations/**`).

## Runbooks and live records

| file | role |
|---|---|
| `pro-launch.md` | sale-close, service-kill and key-rotation runbook |
| `rollback-drills.md` | measured sale-close drill and the offline recovery fixture |
| `dashboards/pro-launch-v1.md`, `queries/pro-launch-v1.md` | private monitor operating procedure and queries (`services/log-query/`) |
| `pro-margin-decision-20260729.md` | Pro cap = 100 rewrites/month; cited from `src/web-rewrite-contract.js` |
| `serving-engine-cost-20260725.md`, `serving-engine-deepseek-0731-correction-20260803.md` | serving-engine cost and quality measurements cited from `src/` and `.env.example` |
| `serving-engine-gemini-3.7-flash-20260813.md` | latest engine decision: 3.7-flash allowlisted opt-in, Pro pin unchanged |
| `backend-compat-kimi-gemini-agy-20260913.json` | current compatibility record for all five local CLI backends. Quota behavior, other operating systems and gemini-cli API-key mode are not covered |
| `pay-b-binding-polar-20260729.json`, `pay-live-runtime-polar-20260729.json` | Polar checkout evidence read by `scripts/checkout-evidence-bindings.mjs` |

## Monitor calculation

The low-tier monitor is computed in
`src/pro-monitor.js#evaluateFreeTierHealth`; events come from the closed
aggregate observer in `src/web-observability.js`. Free/BYOK successes are
`sampled_1_of_20` and failures are full-census events, so a rate uses the
sampled-success estimate (observed successes × 20) plus full-census failures,
never the raw success counter as a census denominator. Unknown outcomes make
that rate unavailable rather than silently treating missing data as zero. The
paid monitor likewise excludes unknown outcomes from its known production
denominator and raises monitor blindness when they are the only aggregate
evidence. `monitor_drop` is never an aggregate counter: the observer only logs
it, and the paid monitor reads it from the log-query service.

Windows are 15 and 30 minutes. Latency uses coarse buckets and a
no-interpolation p95, aggregates expire after 7,200 seconds, and only
aggregates are kept. An `unknown` latency bucket is aggregate-ineligible,
never a zero-valued latency observation.

## Rollback and deployment

The offline recovery fixture and its no-publication boundary are documented in
[`rollback-drills.md`](rollback-drills.md). It is code evidence only: no
production incident, deployment, provider, Discord, or registry event is
claimed. npm partial-registry recovery is a separate
lane owned by
[`scripts/release-artifacts.mjs`](../../scripts/release-artifacts.mjs) and
[`tests/unit/release-artifacts.test.js`](../../tests/unit/release-artifacts.test.js),
with the procedure in [`docs/integrations/release.md`](../integrations/release.md).

Production deployment follows one contract: approved `main` SHA → same-SHA
preview → application smoke → maintainer-approved promotion, keeping the prior
deployment ID as the rollback target. Build from `main` through the Vercel Git
integration or run `vercel --prod` from a clean `main` checkout; never upload
from `dev`.

## Standing decisions

- Trusted server-side rewrite failures now restore Pro request/character
  allowance once (8.1.3). This is usage allowance restoration, not a payment
  refund. Client cancellations after admission remain charged.
- The free tier serves on gemini (owner-confirmed 2026-09-02). The deployment
  env value `PATINA_FREE_MODEL` is the source of truth for the live engine.
- Records name secrets, never values. Production `PATINA_FREE_API_KEY` and
  `PATINA_PRO_API_KEY` (Vercel Production, Sensitive) are product-only Gemini
  keys, rotated 2026-09-04. Research jobs use a separate local key.
- The repository maintainer owns recurring maintenance. Repeated alerts for one
  repository/channel/tier/deployment/trigger/window are deduplicated into one
  incident record with a next-review date; retries are bounded and do not
  create unlimited Issues. Credentials, tokens, raw logs, request text, and
  provider responses are never collected in these records.

### OBS-ALERT receipt dropped (2026-09-14)

Owner decision: the first eligible `OBS-ALERT-v1` alert/recovery receipt is
`not_planned`, and none will be queued. Cron 200 stands as “monitor is
running.” Do not open Sensitive observability credentials or synthesize an
incident for this item. The 8.1.3 Discord envelope and the log-query repair
stay (`pro-monitor-endpoint-repair-20260904.md`, private).

The monitor issues no receipts and no longer reads
`PATINA_PUBLIC_BASE_URL_SHA256` or `PATINA_VERCEL_LOG_QUERY_URL_SHA256`; both
Vercel env vars can be deleted. It keeps the Discord alert, the dedup lease,
the active list and the recovery message.

### Polar checkout already live; sales-count dropped (2026-09-14)

Polar Pro checkout opened on production on 2026-08-04
(`live-open-20260804.md`, private). That is the payment system. A later “first paid
sale / order count” check is `not_planned`. Do not query Polar or treat
empty webhook logs as unfinished checkout work. The `/api/polar-webhook`
purchase counter is gone (the endpoint returns 404), so its registration in
the Polar dashboard can be deleted.

## Private records

Records marked (private) carried processor correspondence, operator
identities, an internal deployment URL or raw cost figures, or they closed an
evidence chain (Polar onboarding and approval, Gate-B readiness, serving-engine
retractions) or a dated plan or audit. They live in the gitignored
`docs/internal/` on the maintainer's disk, not in this repository.
