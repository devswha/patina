# Observability computation-contract review — 2026-09-16

Read-only review of the existing aggregate observation code against the
maintenance plan's §12.1 computation-contract rules. No code, schema,
retention, or SDK change; findings only. Reviewed tree: `origin/dev`
`75bcf7f37147fa4d54ab7b0fb62d46eb4e065c89`, linux x64, by static read — no
production endpoint was probed and no credentials were used.

Scope: the observation surfaces that compute or carry rate-like evidence:
`api/pro-monitor.js` (cron monitor + OBS-ALERT-v1 receipts),
`src/pro-monitor.js` (trigger evaluation, via its api caller),
`src/web-observability.js` (event schema v2 + metric builders),
`api/funnel.js` (aggregate-only funnel counters),
`playground/analytics.js` (client event allowlist). Out of scope: dashboards
outside this repository, Vercel's own analytics, and the incident-response
procedure itself (§12.3, owner-operated).

## Findings table (§12.1 rules)

| # | Rule (plan §12.1) | Verdict | Evidence |
|---|---|---|---|
| 1 | Do not divide raw event counts into a failure rate when successes are sampled and failures fully collected | **OK** | The only computed ratio is `over120Ratio = counts['>120s'] / n` where `n` is the same histogram's own total, recomputed and cross-checked in `validFact` (`api/pro-monitor.js:96-99`). Entitlement alerting uses count floors on one collection path (`entitlementTotal >= 20 && entitlementNonOk >= 5`, `api/pro-monitor.js:94`), not a cross-collection rate. `freeSummary` reports raw `total`/`failed` counts, never a rate (`api/pro-monitor.js:108`). |
| 2 | State numerator, denominator, sampling, window, and gaps for each metric | **OK** | Every receipt carries an explicit `denominators` object (`productionAggregate`, `entitlementTotal`, `entitlementNonOk`, `histogram`, `numberSafety`, `monitorDrop` — `api/pro-monitor.js:18`) plus `logWindows.{safetyEntitlement,monitorDrop}` each recording `window`, `available`, and `denominator` (`validFact`, `api/pro-monitor.js:96-99`). Alert windows are pinned per trigger (`15m`/`30m`, `api/pro-monitor.js:95`). The web event schema v2 carries a `sampling` field on each event (`src/web-observability.js:19`). |
| 3 | When required inputs are missing, say a valid rate cannot be produced (never fabricate) | **OK** | Missing adapters or a zero production aggregate raise the dedicated `monitor_blind` trigger (`api/pro-monitor.js:94`) and the endpoint fails closed with 503 `monitor_unavailable` at the `configuration`/`inputs`/`evaluation` stages (`unavailable`, `api/pro-monitor.js:112`; gates at 119-125 and 149-155); an unacknowledged blind alert also forces 503 (`blindUnacked`, `api/pro-monitor.js:149-150`). |
| 4 | Coarse latency buckets must be presented as bands/approximations, never exact p95 claims | **OK** | Latency is bucketed (`<=30s`, `30-60s`, `60-120s`, `>120s`); the monitor selects `selectedBucket`/`upperBound` at the p95 rank and publishes `p95Rank` + bucket counts, never an exact p95 milliseconds figure (`validFact` recomputation, `api/pro-monitor.js:96-99`; receipt `latency` payload, `api/pro-monitor.js:104`). |
| 5 | Distinguish user cancel, auth/quota, provider outage, product error, below-floor | **OK** | Server schema v2 closed outcome set: `completed`, `terminal_failed`, `number_safety_failed`, `entitlement_denied`, `entitlement_unavailable`, `quota_denied`, `service_disabled`, `monitor_drop`, `unknown` (`src/web-observability.js:26-28`); legacy stream outcomes keep `ok`/`stream_failed`/`scoring_failed`/`floor_failed` distinct (`src/web-observability.js:12`). Client allowlist separates `cancelled`, `quota`, `auth`, `floor`, `scoring`, `stream`, `service`, `concurrency`, `input` (`playground/analytics.js:13`). Unknowns collapse to `unknown`/`n/a`, never to success (`src/web-observability.js:94,169`). |
| 6 | Do not loosen accepted criteria or hide errors for diagnostics | **OK** | The synthetic pro probe and free canary carry an observer header that keeps the probe out of the aggregate it watches without exempting quota (`api/pro-monitor.js:79-83` comment + implementation); a free-canary problem is reported but never masks the pro evidence run (`freeSummary`, `api/pro-monitor.js:108`, reported in the 200 response and never fatal to the cron). |
| 7 | Mark metric-definition changes in the series | **OK (mechanism)** | Receipts pin `ruleVersion` (`pro-monitor.histogram.v1`), `eventSchemaVersion`/`eventSchemaHash`, and `configHash` (`api/pro-monitor.js:12,93,102-104`), so a definition change is visible in the receipt series by construction. |

## Cautions (not violations, no change made)

- **Cross-event rates downstream.** `Rewrite Failed` and `Rewrite Completed`
  are separate client events (`playground/analytics.js:20-23`) and the
  client's in-page success counter saturates at two by design
  (`playground/analytics.js:29-31`). Any downstream consumer dividing one
  event stream by another must honor the per-event `sampling` field
  (`src/web-observability.js:19`); nothing in this repository does such a
  division today.
- **`api/funnel.js` is aggregate-only by construction** (increment-only
  Upstash adapter that cannot read values back, key-shape validated,
  daily-limit fail-closed — `api/funnel.js:104-149`). It emits no rates; the
  §12.1 exposure would only arise in an external reader.

## Recommended follow-ups (bullets only, none implemented here)

- When any dashboard starts consuming `patina.web.v2` events, add its
  numerator/denominator definitions to this contract before first publication.
- The known standing 503 (`monitor_unavailable` while the synthetic POST
  returns 200, recorded 2026-09-04 in
  [pro-monitor-endpoint-repair-20260904.md](pro-monitor-endpoint-repair-20260904.md))
  is an adapter-availability incident, not a computation-contract defect; its
  repair stays tracked in that receipt, not here.

## Non-goals honored

No SDK added, no retention or event field changed, no identifier introduced,
no production credentials used, no existing docs/operations receipt edited.
Rollback of this review is reverting this single document.
