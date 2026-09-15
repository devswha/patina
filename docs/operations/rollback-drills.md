# Rollback drills — procedures and measured latencies

> Covers the ROLLBACK_DRILLS blocker. Sale-close carries the 10-minute bound.
> Service-kill and fallback only need correctness evidence, not a time claim.
> The latencies below come from real operations on 2026-07-23, not estimates.

## Drill 1 — sale-close (target: ≤ 10 minutes end-to-end)

Closes the checkout without touching the service. Sequence:

```bash
# 1. Flip the enablement flag (values are not secrets)
npx vercel env rm PATINA_PRO_CHECKOUT_ENABLED production --yes
printf %s false | npx vercel env add PATINA_PRO_CHECKOUT_ENABLED production
# 2. Propagate (CLI redeploy is acceptable here; follow with a git deploy)
npx vercel redeploy patina.vibetip.help
# 3. Verify: launch config back to the six-field disabled shape
curl -s https://patina.vibetip.help/launch-config.js   # expect "channel": "disabled"
```

Measured on 2026-07-23: env mutation ~1s per var; `vercel redeploy` build+alias
**25s** (observed twice: 25s, 25s); propagation to edge < 60s. Worst observed
end-to-end well under 2 minutes against the 10-minute bound. The generator
fails closed: with the flag false (or unset, or any invalid value) the emitted
artifact is the disabled shape regardless of every other input — pinned by
`tests/unit/web-deploy-invariants.test.js`.

## Drill 2 — service-kill (correctness, no time claim)

Kills the paid path entirely while free/BYOK stay up:

```bash
npx vercel env rm PATINA_PRO_API_KEY production --yes && npx vercel redeploy patina.vibetip.help
```

Expected behavior (contract-pinned): production pro requests fail closed with
503 (`resolveProviderModel in production requires explicit PATINA_PRO_*`, no
free-key fallback because `PATINA_PRO_ALLOW_FREE_KEY` is absent/false —
verified `"false"` in Production on 2026-07-23). Free tier is unaffected
(separate key). Restore = re-add the key + redeploy.

## Drill 3 — fallback (correctness, no time claim)

Full deployment rollback to the previous production build:

```bash
npx vercel rollback patina.vibetip.help   # aliases the previous deployment
```

Bindings are source-controlled, so a rolled-back build can never carry a
different checkout destination; the worst case is an older disabled artifact.
Note: rolled-back builds retain their original env snapshot — re-verify
`/launch-config.js` after rollback.

## Standing cautions

- A CLI redeploy has no `VERCEL_GIT_COMMIT_SHA`, so the pro-monitor stays in
  its fail-closed 503 until the next git deploy. Any drill that used
  `redeploy` therefore ends with a dev -> main merge.
- The monitor cron fires every 15 minutes and alerts Discord when synthetic
  checks fail. Watch one full cycle after a drill before calling it recovered.

## Drill 4 — offline monitor recovery fixture (P21b; no deployment)

This is the locally verifiable recovery exercise. It uses the existing
aggregate-only monitor calculator and in-memory control store; it does not call
Vercel, a provider, Discord, a registry, or any production endpoint.

```bash
node --test tests/unit/pro-monitor.test.js \
  --test-name-pattern="offline recovery drill exposes an injected failure and then restored health"
```

The first fixture run injects `numberSafety=1` into the 15-minute aggregate
adapter and asserts a visible `number_safety` trigger plus an acknowledged
alert. The second run returns zero safety/drop counts and asserts no active
trigger, a `monitor_recovered` receipt, and consumption of the linked alert
state. A pass is code evidence only; it is not a production incident,
deployment, Discord, or `OBS-ALERT-v1` receipt.

The source authority is
`src/pro-monitor.js#evaluateProMonitor`; the deployed route, when separately
approved, is `api/pro-monitor.js`. The owner authority is the repository
maintainer, who alone approves a production promotion or rollback and records
the exact source SHA, deployment ID, smoke result, and prior rollback ID.
Do not collect credentials, request text, provider responses, or raw logs for
this fixture.

## P13a — web deployment binding (human-gated)

The required sequence is **approved main SHA → preview/deployment built from
that same SHA → application smoke → owner-approved promotion → retained prior
deployment ID for rollback**. No step below authorizes a promotion or rollback.

Read-only evidence captured from the existing Vercel account (no secret
plaintext/decrypt/log access) is limited to:

- `/v9/projects/patina` reports `link.productionBranch=main` and
  `gitForkProtection=true`.
- `/v13/deployments` reports ready deployment
  `dpl_9mLY4716GsCKWrGiomn8hKxZLEzN`, `sourceSha=b9fff3e44037ea05818311b894b57ca89d0ce595`,
  `sourceRef=dev`, created `2026-09-09T19:15:06.183+09:00`.
- The prior ready production deployment is
  `dpl_H56Atjg5KJ7YdNPUjCPSs16exshy`, source
  `d7a4741ed9f767bd22a39255e10acf159351fb7a`.
- `b9fff3e...` is an ancestor of `origin/main`; the deployed `b9fff3e...`
  tree and the `d7a4741...` release-merge tree are both
  `7cd7f924d1b2228a9692b64842b69918beaf2a21`. The source-ref/SHA discrepancy
  is therefore not a content mismatch or proven malfunction; the maintainer
  must reconcile the `sourceRef=dev` exception before promotion.
- `https://patina.vibetip.help` returned a basic read smoke rendering the
  `8.6.0` title. This is not application acceptance evidence.
- Environment metadata exposed target counts `production=34` and `preview=31`
  with `decrypt=false`; no values were read or printed. Required-check and
  remaining account-setting fields were not exposed and remain **unknown**;
  account confirmation is human-blocked.

The earlier GitHub production deployment record `6347382527` (source
`d7a4741ed9f767bd22a39255e10acf159351fb7a`) reported success, but did not
prove an application smoke or Vercel account configuration. Real promotion and
rollback remain unexecuted, unapproved, and human-blocked, so the retained
prior ID above is an inventory fact, not a completed rollback drill.

The separate npm artifact recovery lane owns its mock partial-registry
exercise: [`scripts/release-artifacts.mjs`](../../scripts/release-artifacts.mjs),
[`tests/unit/release-artifacts.test.js`](../../tests/unit/release-artifacts.test.js),
and [`docs/integrations/release.md`](../integrations/release.md). Do not
report that lane or this web drill as passed until the parent verification
records its result. Native Codex automation settings (P09) and any unexposed
web account configuration remain unknown.
