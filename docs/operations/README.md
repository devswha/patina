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
| `multilingual-funnel-20260907.md` | funnel measurement runbook |
| `backend-compat-kimi-gemini-agy-20260913.json` | current compatibility record for all five local CLI backends. Quota behavior, other operating systems and gemini-cli API-key mode are not covered |
| `pay-b-binding-polar-20260729.json`, `pay-live-runtime-polar-20260729.json` | Polar checkout evidence read by `scripts/checkout-evidence-bindings.mjs` |

## Monitor calculation

The low-tier monitor is computed in
`src/pro-monitor.js#evaluateFreeTierHealth`; events come from the closed
aggregate observer in `src/web-observability.js`. Free/BYOK successes are
`sampled_1_of_20` and failures are full-census events, so a rate uses the
sampled-success estimate (observed successes × 20) plus full-census failures,
never the raw success counter as a census denominator. Unknown outcomes or
monitor-drop counts make that rate unavailable rather than silently treating
missing data as zero. The paid monitor likewise excludes those
classifications from its known production denominator and raises monitor
blindness when they are the only aggregate evidence.

Windows are 15 and 30 minutes. Latency uses coarse buckets and a
no-interpolation p95, aggregates expire after 7,200 seconds, and only
aggregates are kept. An `unknown` latency bucket is aggregate-ineligible,
never a zero-valued latency observation.

## Rollback and deployment

The offline recovery fixture and its no-publication boundary are documented in
[`rollback-drills.md`](rollback-drills.md). It is code evidence only: no
production incident, deployment, provider, Discord, registry, or
`OBS-ALERT-v1` receipt is claimed. npm partial-registry recovery is a separate
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

- First healthy `OBS-ALERT-v1` receipt after live-open: **not required.**
  Owner decision 2026-09-14 (`not_planned`). No record was found, and none
  will be queued. Ordinary cron 200 is enough to treat the monitor as
  running; do not fetch Sensitive observability tokens or manufacture an
  alert/recovery cycle for this receipt. The 8.1.3 Discord envelope and
  log-query repair stay. See `pro-monitor-endpoint-repair-20260904.md` (private).
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
`not_planned`. Cron 200 stands as “monitor is running.” Do not open
Sensitive observability credentials or synthesize an incident for this
item.

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
