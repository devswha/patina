# Gate B readiness — status as of 2026-07-23

> Working ledger for the GATE_B blocker ("completed production source-binding
> integration commit or artifact, hosted identity, usage, dedicated runtime,
> content-valid PAY-B-COST evidence, and real-path OBS evidence"). Non-secret
> facts only; timestamps UTC.

## Complete

| Requirement | Evidence |
|---|---|
| Production source-binding integration | patina main `f16e414` (PR #655): binding tuple + sealed `pay-b-binding-20260723.json` (factsSha256), hold ledgers revised, CI-validated on every commit |
| Owner PAY-B approval | `PAY-B-20260723-1236551-1932893`, owner repo commit `487b51c` |
| First live payment | Live checkout accepted a real $9.99 subscription (owner card, 2026-07-23). License meta from the public validate endpoint: store 425473, product 1236551, variant 1932893 — exact binding identity match |
| Hosted identity / dedicated runtime | Pro path pinned to provider `claude`, model claude-sonnet-5, dedicated `PATINA_PRO_API_KEY` (separate from free); production requires explicit PRO env (503 fail-closed otherwise, verified live) |
| Live pro runtime proof | 2026-07-23: `tier=pro` + purchased license -> HTTP 200 `done`; claims preserved ("1,200만 원", "3만 명" byte-exact), fidelity 83.3 / MPS 100; catalog patterns #35/#36/#37 applied on the paid path |
| Entitlement fail-closed proofs | Dummy license -> 403 `license not entitled`; stale product/variant env (17-day-old staging IDs) also 403 until corrected to live IDs — the filter never passed a mismatch |
| Synthetic monitoring inputs | `PATINA_SYNTHETIC_PRO_LICENSE` (the purchased license) registered in Production; CRON_SECRET rotated from an 11-char placeholder to a 64-hex random |

## Outstanding for Gate B

1. **Real-path OBS evidence** — `/api/pro-monitor` returns 503
   `monitor_unavailable` on CLI-redeployed builds because `VERCEL_GIT_COMMIT_SHA`
   is absent (identity check fails closed, correctly). Operational rule
   recorded below; recovers on the next git-based production deployment, after
   which a cron-authorized run must be captured green.
2. **Content-valid PAY-B-COST evidence** — requires the G002 staging probe
   collector, which was removed with the `ops/*` harness. Rebuild design:
   [`g002-collector-redesign.md`](g002-collector-redesign.md). The receipt
   issuer/validator (`scripts/pay-b-cost-receipt.mjs`, spec
   [`pay-b-cost-v1.md`](pay-b-cost-v1.md)) is present and tested.
3. **Owner + maintainer sign-off** naming the above once 1–2 land.

## Operational rule (learned 2026-07-23)

`vercel redeploy` produces deployments without `VERCEL_GIT_COMMIT_SHA`; the
pro-monitor fails closed (503) on them. **Production must be deployed via git
(dev -> main merge)**; CLI redeploys are for emergency env propagation only and
must be followed by a git deploy to restore monitor identity.
