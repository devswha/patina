# Rollback drills — procedures and measured latencies

> Supports the ROLLBACK_DRILLS blocker: sale-close within 10 minutes, plus
> correctness evidence for service-kill and fallback (no 10-minute claim).
> Latencies below were measured on 2026-07-23 during real operations.

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

- Every CLI redeploy drops `VERCEL_GIT_COMMIT_SHA` and takes the pro-monitor
  to fail-closed 503 until the next git deploy. Drills that use `redeploy`
  must end with a dev -> main merge.
- The monitor cron (15 min) alerts to Discord on synthetic failures; after any
  drill, watch one full cron cycle before declaring recovery.
