# Owner actions to open Pro sales (two items, ~15 minutes)

> Companion to [`production-go-live-checklist.md`](production-go-live-checklist.md).
> Step 1 (LS tax review) was observed CLEARED on 2026-07-23 — the live checkout
> renders at 200. These are the only two human actions between here and the
> agent-run binding/deploy steps. **No secret values in this file — names only.**

## Action 1 — provision live secrets in Vercel (Production env)

Vercel → patina project → Settings → Environment Variables → scope **Production**.

### Identity (non-secret, copy verbatim)

| Name | Value |
|---|---|
| `LS_STORE_ID` | `425473` |
| `LS_PRO_PRODUCT_ID` | `1236551` |
| `LS_PRO_VARIANT_ID` | `1932893` |
| `PATINA_PRO_PROVIDER` | `claude` |
| `PATINA_PRO_MODEL` | `claude-sonnet-5` |
| `PATINA_DEPLOYMENT_CHANNEL` | `production` |
| `PATINA_PRO_CHECKOUT_ENABLED` | `false` (stays false until the Live-open step) |
| `PATINA_PRO_CHECKOUT_URL` | `https://vibetip.lemonsqueezy.com/checkout/buy/8ab3a49b-cc55-49e8-bd94-9cbdff5e6a7d` |
| `PATINA_PUBLIC_BASE_URL` | `https://patina.vibetip.help` |

### Secrets (owner sources)

| Name | Where to get it |
|---|---|
| `PATINA_PRO_API_KEY` | Anthropic console — create a dedicated production key (do NOT reuse the free-tier key) |
| `PATINA_FREE_API_KEY` / `PATINA_FREE_PROVIDER` / `PATINA_FREE_MODEL` | already live — verify they exist in Production scope |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Upstash console → the quota/admission KV database → REST API tab |
| `PATINA_LICENSE_HMAC_SECRET` | generate: `openssl rand -hex 32` |
| `PATINA_QUOTA_HMAC_SECRET` | already live — verify it exists |
| `PATINA_OBSERVABILITY_REST_API_URL` / `_TOKEN` | Upstash — the **dedicated monitor** KV (NOT the quota KV) |
| `CRON_SECRET` | generate: `openssl rand -hex 32` |
| `PATINA_ALERT_DISCORD_WEBHOOK` | Discord → server settings → integrations → webhook URL |
| `PATINA_SYNTHETIC_PRO_LICENSE` / `PATINA_SYNTHETIC_OBSERVER_SECRET` | issue one synthetic license in LS (test customer) / `openssl rand -hex 32` |
| `PATINA_PUBLIC_BASE_URL_SHA256` | `printf %s 'https://patina.vibetip.help/' \| sha256sum` — note the **trailing slash**: the monitor hashes the URL-normalized form (`new URL(base).toString()`), which always ends in `/` |

Leave **unset**: `PATINA_PRO_ALLOW_FREE_KEY` (its absence keeps the fail-closed 503).
Optional caps (`PATINA_PRO_MAX_CHARS`, `PATINA_PRO_REQ_PER_DAY`, `PATINA_PRO_MAX_CONCURRENT`,
`PATINA_PRO_CHARS_PER_MONTH`) — defaults are fine, skip them.

When done: tell the agent "secrets provisioned" — no values, just the fact.

## Action 2 — PAY-B production binding approval (one immutable record)

Copy the block below, fill the date, and post it somewhere immutable that you
control (a dated commit in your private ops repo, or a signed dated note). Then
give the agent the evidence ID.

```
PAY-B-<YYYYMMDD>-1236551-1932893
I approve the production checkout source binding for patina Pro.
Store: 425473 (vibetip) · Product: 1236551 · Variant: 1932893 ($9.99/mo, license keys, activation 3)
Production checkout URL (exact):
https://vibetip.lemonsqueezy.com/checkout/buy/8ab3a49b-cc55-49e8-bd94-9cbdff5e6a7d
Reviewed against staging evidence PAY-STG-20260716-1199625-1875389.
Approved by: <name>, <date, UTC>
```

## What happens next (agent-run, in order)

1. Agent commits the production `{channel, evidence, origin, path}` tuple to
   `scripts/checkout-evidence-bindings.mjs` (deferred action
   `SOURCE_BINDING_PRODUCTION_INTEGRATION`).
2. Owner Gate B sign-off → deploy with checkout **disabled**, verify fail-closed
   paths + monitor cron.
3. Owner Gate D + rollback drills sign-off → Live open
   (`PATINA_PRO_CHECKOUT_ENABLED=true`), CTA flips from "coming soon" to the
   real checkout.
4. First bounded real payment/refund/revoke evidence (PAY_LIVE) → v6.4 tag +
   npm publish (REL_PUBLISH) once the Release Authority approves.

## Monitor env self-check (run locally, values never leave your shell)

The pro-monitor returns 503 `monitor_unavailable` while any of its adapter
env values fails its shape rule. Sensitive values cannot be read back from
Vercel, so validate the value you are ABOUT to paste, locally:

```bash
node -e '
const v = process.env.V; const { createHash } = require("crypto");
const h = (x) => createHash("sha256").update(x).digest("hex");
const u = new URL(v);
console.log("normalized:", u.toString());
console.log("obs-kv ok:", u.protocol === "https:" && u.hostname.endsWith(".upstash.io"));
console.log("logq/base shape ok:", u.protocol === "https:" && !u.port && !u.search && !u.hash);
console.log("discord ok:", ["discord.com","discordapp.com"].includes(u.hostname) && /^\/api\/webhooks\/\d+\/[A-Za-z0-9._-]+$/.test(u.pathname));
console.log("sha256 of normalized:", h(u.toString()));
' 2>/dev/null || echo "not a valid URL"
```

Run it as `V='<value>' node -e ...` per candidate. Rules that bite:

- `PATINA_OBSERVABILITY_REST_API_URL`: https and the hostname must end in
  `.upstash.io` (paste the Upstash REST URL untouched).
- `PATINA_VERCEL_LOG_QUERY_URL_SHA256` and `PATINA_PUBLIC_BASE_URL_SHA256`:
  always hash the **normalized** form the command prints (bare origins gain a
  trailing slash).
- `PATINA_ALERT_DISCORD_WEBHOOK`: exact `/api/webhooks/<id>/<token>` path on a
  Discord host; no query string.

After re-entering values, env changes only apply to NEW deployments: merge any
dev commit to main (git deploy) rather than `vercel redeploy` so the monitor
keeps its deployment identity.
