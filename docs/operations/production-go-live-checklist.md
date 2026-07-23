# Production go-live checklist (Pro / v6.4)

> Planning aid, not an authorization. The authoritative gates are
> [`pro-launch.md`](pro-launch.md) and
> [`v6.4-preflight-hold.json`](v6.4-preflight-hold.json). This file records the
> verified live Lemon Squeezy identity and the secret-name → source map so the
> flip from HOLD → live is mechanical once approvals land. **No secret values
> live here or anywhere in the repo** — only names and non-secret identifiers.

## Current state (2026-07-23, evening)

- **First live payment landed.** The owner's real $9.99 subscription was
  accepted on the live checkout; the issued license validates against store
  425473 / product 1236551 / variant 1932893 — the exact PAY-B binding
  identity. The tax-review question is settled functionally: the store takes
  live payments (dashboard status lagged behind).
- **Live pro path proven end-to-end**: license -> entitlement -> claude-sonnet-5
  rewrite -> floors passed (fidelity 83.3 / MPS 100) with numeric claims
  byte-preserved. Two env defects found and fixed the same day: 17-day-old
  staging product/variant IDs in `LS_PRO_PRODUCT_ID`/`LS_PRO_VARIANT_ID`
  (fail-closed 403 until corrected) and an 11-char placeholder `CRON_SECRET`
  (rotated to 64-hex).
- Production source binding integrated and sealed (main `f16e414`); Gate B
  ledger: [`gate-b-readiness-20260723.md`](gate-b-readiness-20260723.md).
  Outstanding: green cron-authorized monitor run on a git deployment, and
  PAY-B-COST evidence via the G002 collector rebuild
  ([`g002-collector-redesign.md`](g002-collector-redesign.md)). Rollback drill
  procedures with measured latencies: [`rollback-drills.md`](rollback-drills.md).

- Engine/quality: clean. Since 07-21, `dev`→`main` also shipped the playground
  fixes (locale default, FP-report link, dead-UI contract artifact, version
  badge), numeric-safety v2/v2.1, the 184-pattern catalog, the free-quota
  raise (20/day, 10/hour), and the BYOK model refresh (+Gemini provider).
- Payment: **step 1 (LS tax review) is still PENDING** — the dashboard shows
  `Settings → Payouts → Tax information: Submitted` (owner-checked
  2026-07-23). Progress signal, not clearance: the live checkout URL now
  resolves `302 → 200` at "Patina Pro - Checkout" with the $9.99 price
  rendered (it returned 404 through 07-22), which likely reflects the variant
  publishing — LS can render checkout pages before the store is cleared to
  take payments. **The dashboard status is authoritative**; a rendering
  checkout page must never be recorded as review clearance again.
  Owner steps that do NOT depend on the review (Vercel secret provisioning,
  the PAY-B binding approval record) can proceed now; only Live-open waits.
- Still not sellable by design: the deployed launch config remains the
  fail-closed disabled artifact and the site CTA stays "Pro — coming soon"
  until steps 2–8 below complete. Nothing opens payment automatically.

## Verified live Lemon Squeezy identity (non-secret)

Read-only from the LS API on 2026-07-21. Use these **live** values in the
production secret manager — not the staging/test IDs shipped as examples in
`.env.example`.

| Field | Value | Notes |
|---|---|---|
| Store (`LS_STORE_ID`) | `425473` | `vibetip`, USD, approved storefront |
| Live product (`LS_PRO_PRODUCT_ID`) | `1236551` | "Patina Pro", `Published` |
| Live variant (`LS_PRO_VARIANT_ID`) | `1932893` | `$9.99/mo`, license keys, activation 3; currently `pending` |
| Checkout origin | `https://vibetip.lemonsqueezy.com` | for the production binding |
| Checkout path | `/checkout/buy/8ab3a49b-cc55-49e8-bd94-9cbdff5e6a7d` | live variant checkout |
| `PATINA_PRO_CHECKOUT_URL` | `https://vibetip.lemonsqueezy.com/checkout/buy/8ab3a49b-cc55-49e8-bd94-9cbdff5e6a7d` | exact, no trailing slash/query |

Staging (test) identity for contrast — already bound in
`scripts/checkout-evidence-bindings.mjs`: store `425473`, product `1199625`,
variant `1875389`, path `/checkout/buy/9e53eb90-c8a8-4cef-b06d-3ca0b429e514`,
evidence `PAY-STG-20260716-1199625-1875389`.

## Secret / env map (set in the deployment secret manager, never in the repo)

Owner provisions these under the `SECRET_MANAGER` blocker. Only names appear here.

### Pro identity (non-secret IDs — the values above)
- `LS_STORE_ID` = `425473`
- `LS_PRO_VARIANT_ID` = `1932893` (live)
- `LS_PRO_PRODUCT_ID` = `1236551` (live)

### Pro provider + entitlement (secrets)
- `PATINA_PRO_API_KEY` — Pro provider key (required in production; fail-closed 503 if absent)
- `PATINA_PRO_PROVIDER` = `claude`
- `PATINA_PRO_MODEL` = `claude-sonnet-5`
- `PATINA_LICENSE_HMAC_SECRET` — long random; meters per-license by HMAC subject
- `PATINA_PRO_ALLOW_FREE_KEY` — **leave unset** in production (keeps the fail-closed 503)
- Optional caps (defaults fine): `PATINA_PRO_MAX_CHARS`, `PATINA_PRO_REQ_PER_DAY`, `PATINA_PRO_MAX_CONCURRENT`, `PATINA_PRO_CHARS_PER_MONTH`

### Free tier + quota KV (secrets)
- `KV_REST_API_URL`, `KV_REST_API_TOKEN` — Upstash quota/admission KV (prod: missing ⇒ metered requests 503)
- `PATINA_FREE_API_KEY`, `PATINA_FREE_PROVIDER`, `PATINA_FREE_MODEL`
- `PATINA_QUOTA_HMAC_SECRET`

### Browser checkout launch config (build/deploy inputs; non-secret)
- `PATINA_PRO_CHECKOUT_ENABLED` — `false` first (Gate B), `true` only at Live open
- `PATINA_DEPLOYMENT_CHANNEL` — `staging` | `production`
- `PATINA_PRO_CHECKOUT_URL` — the exact live URL above
- `PATINA_PRO_GATE_EVIDENCE_ID` — `PAY-B-…` (production) once the PAY-B record exists

### Private monitor (production; secrets)
- `PATINA_OBSERVABILITY_REST_API_URL`, `PATINA_OBSERVABILITY_REST_API_TOKEN` (dedicated, NOT the quota KV)
- `CRON_SECRET`
- `PATINA_PUBLIC_BASE_URL` (= `https://patina.vibetip.help`), `PATINA_PUBLIC_BASE_URL_SHA256`
- `PATINA_SYNTHETIC_PRO_LICENSE`, `PATINA_SYNTHETIC_OBSERVER_SECRET`
- `PATINA_VERCEL_LOG_QUERY_URL`, `PATINA_VERCEL_LOG_QUERY_URL_SHA256`, `PATINA_VERCEL_LOG_QUERY_TOKEN`
- `PATINA_ALERT_DISCORD_WEBHOOK`
- `VERCEL_GIT_COMMIT_SHA` (Vercel-provided; 40 lowercase hex)

### Pro pack delivery (optional)
- `PATINA_PACKS_GITHUB_TOKEN`, `PATINA_PACKS_REPO`, `PATINA_PACKS_REF`

## Ordered go-live sequence

Owner = human action; Agent = repo action I run once its blocker clears.

1. **[Owner] LS tax review clears** → store activates → live variant `pending → published` → checkout 404 → 200. (Blocker `LS_APPROVAL`.) *Verify:* ask me to re-check the checkout / variant status.
2. **[Owner] Secret manager** — provision every name above with live values. (Blocker `SECRET_MANAGER`.)
3. **[Owner] PAY-B binding approval** — immutable production source-binding approval naming the reviewed evidence ID + exact production LS URL. (Blocker `PAY_B_BINDING_APPROVAL`.)
4. **[Agent] Production source binding** — add the reviewed `{channel: 'production', evidence: 'PAY-B-…', origin, path}` tuple to `scripts/checkout-evidence-bindings.mjs`. (Deferred action `SOURCE_BINDING_PRODUCTION_INTEGRATION`; **do not pre-add a sample binding**.)
5. **[Owner] Gate B** — authorize the production checkout candidate (staging evidence + reviewed PAY-B + health/admission + rollback owner + telemetry/PII review).
6. **[Owner+Agent] Deploy production, checkout DISABLED first** — `PATINA_PRO_CHECKOUT_ENABLED=false`; generate + inspect the disabled config; verify Pro paths stay fail-closed; provision + verify the monitor cron; record a real-path OBS receipt. (Blocker `DEP_PROD_DISABLED`.)
7. **[Owner] Gate D** — final live-open decision after the disabled release is healthy; run drills incl. the 10-minute sale-close drill. (Blocker `GATE_D`, `ROLLBACK_DRILLS`.)
8. **[Owner+Agent] Live open** — from the approved disabled artifact, set `PATINA_PRO_CHECKOUT_ENABLED=true`, `PATINA_DEPLOYMENT_CHANNEL=production`, the live URL + `PAY-B-…` evidence; `npm run launch-config:generate`; deploy atomically; inspect the deployed CTA. (Blocker `PAY_OPEN`.)
9. **[Owner] PAY_LIVE** — bounded real payment / refund / revoke / denial-recovery evidence within the propagation bound.
10. **[Owner+Agent] REL_PUBLISH** — v6.4 tag + npm publish (`FINAL_TAG_PUBLISH_COMMAND`, blocked by `PAY_LIVE` + `REL_PUBLISH`). Tag/publish are currently prohibited by the hold.

## Agent vs owner split

- **Owner-only** (identity/money/legal/LS): tax review, secret provisioning, all approval gates (PAY-B, Gate B/D, PAY_OPEN, PAY_LIVE, REL_PUBLISH), rollback drills sign-off.
- **Agent** (once unblocked): the production binding edit (step 4), config generation/inspection, entitlement + checkout smoke, monitor readiness verification, the tag/publish command on final approval.

## What I can do now (freeze-safe)

Nothing further blocks on code — all repo actions are gated by owner approvals
above. This checklist is the standing prep. When step 1 clears, ping me and I
run the re-check → then execute the agent steps in order.
