# patina Open Core vs Pro

patina is **open core**. The baseline is fully open (MIT) and works on its own;
a hosted **Pro** tier adds a server-side enhanced Korean engine. This page
documents the boundary, how Pro is accessed (no account required), and the
billing/cancellation/refund policy.

> Status: the Pro tier ships **disabled by default** (`PATINA_PRO_ENABLED` is
> off). Checkout is not open until the enhanced engine meets its quality bar.
> Everything below describes the gated infrastructure, not a live paywall.

## What is open (MIT) vs what is Pro

| | Open baseline (this repo, `patina-cli`) | Hosted Pro |
|---|---|---|
| Deterministic detector (`src/features/*`), patterns, lexicon, profiles | ✅ open | — |
| CLI, free web rewrite proxy, BYOK (your own LLM key) | ✅ open | — |
| Enhanced Korean rewrite engine (private corpus/lexicon/pipeline) | ❌ never shipped | ✅ server-only |
| Higher limits, batch, history convenience | — | ✅ |

The open baseline keeps working forever without Pro. The **only** thing behind
Pro is the server-side enhanced engine and higher limits — and that engine is
never distributed in npm/git (a leak gate, `scripts/check-no-private-assets.mjs`,
enforces zero private assets in the published package).

## How Pro is accessed — no account, just a license key

There is **no account, login, or password**. After buying a Pro subscription
you receive a Lemon Squeezy **license key**. The flow:

1. You paste the license key **once** into the app (`exchangeProLicense`).
2. The server verifies it and returns an **opaque, short-lived Pro session
   token** (30-minute sliding window, 2-hour absolute cap). The raw license key
   is never stored or re-sent; only a hash is kept server-side.
3. Rewrite requests send that opaque token (`tier: "pro"`, `proSessionToken`) —
   never the raw key, and never a caller-chosen provider/model/key.
4. If the entitlement is cancelled/refunded/expired, the next request fails
   closed (the server re-checks the entitlement every request).

Tokens are held in-memory/session by default; persistent storage is opt-in with
a clear warning and a delete control.

## Billing, cancellation & refunds (Korean)

Payment is handled by **Lemon Squeezy as the Merchant of Record** (it handles
tax/VAT, receipts, and refunds). The cancellation/refund policy below is shown
**identically** at checkout, in the receipt/email, and in the license guide —
its single source of truth is `src/pro-legal-copy.js` (`PRO_LEGAL_COPY_BLOCK_KO`):

- 구독은 언제든 해지할 수 있으며, 해지하면 다음 결제부터 청구되지 않습니다.
- 결제 후 7일 이내에는 고객지원을 통해 환불을 요청할 수 있습니다.
- 다만 디지털 서비스 특성상 Pro 기능을 상당히 사용한 경우, 전자상거래법상 청약철회가 제한될 수 있습니다.
- 결제·영수증·환불은 판매대행사(Merchant of Record)인 Lemon Squeezy가 처리합니다.
- 환불·결제 문의는 고객지원으로, 구독 해지·결제수단 변경은 Lemon Squeezy 고객 포털에서 할 수 있습니다.

## License & trademark

The code is **MIT** and stays MIT — fork, modify, and redistribute freely. The
code license does **not** grant rights to the **"patina"** name or brand
("patina" is a trademark of devswha; a Korean KIPO filing is in progress). Do
not market a competing hosted service as "patina"; rebrand forks under your own
name. See `NOTICE` and `LICENSE` for the authoritative terms.

## Deployment (Vercel)

The web surface (free playground + `/api/*`) deploys to Vercel from `vercel.json`.
There are two safe deploy levels; paid checkout (level C) stays closed until the
`docs/RELEASE-CHECKLIST.md` gates pass.

### Prerequisites

- A Vercel project linked to this repo (`vercel link`).
- A KV store (Upstash Redis / Vercel KV) for rate-limit + Pro state. In a
  production posture the handler **fails closed without KV**.
- Secrets are set via the Vercel dashboard or `vercel env add` — **never** in a
  tracked file (`.env.*` is gitignored). Generate HMAC secrets with
  `openssl rand -hex 32`.

### Level A — free tier only (Pro disabled)

Leave `PATINA_PRO_ENABLED` unset. Required env:

| env | purpose | required |
|---|---|---|
| `PATINA_FREE_API_KEY` | server LLM key for the free tier (503 without it) | yes (for free) |
| `PATINA_FREE_PROVIDER` | free provider preset (default `openai`) | optional |
| `PATINA_FREE_MODEL` | free model (default = preset's first model) | optional |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` | KV REST endpoint (rate limit) | yes in production |
| `PATINA_QUOTA_HMAC_SECRET` | rate-limit token HMAC | yes in production |

```bash
vercel link                                  # once
vercel env add PATINA_FREE_API_KEY production
# ...add KV + PATINA_QUOTA_HMAC_SECRET...
vercel --prod
```

BYOK needs no server key (the user supplies their own).

### Level B — Pro infrastructure (checkout hidden, stub engine)

Adds the Pro plumbing without opening payment. The default engine is the
deterministic **stub** (no quality gain), so checkout must stay hidden.
Additional env on top of level A:

| env | purpose |
|---|---|
| `PATINA_PRO_ENABLED=true` | turns on the Pro tier route |
| `PATINA_PRO_HMAC_SECRET` | shared secret: hashes license keys + session tokens + webhook license ids (`openssl rand -hex 32`) |
| `PATINA_PRO_PROVIDER` | Pro provider preset (must be in `PROVIDER_PRESETS`, e.g. `openai`) |
| `PATINA_PRO_MODEL` | Pro model — must be set explicitly AND allowlisted in that preset (no fallback) |
| `PATINA_LEMON_WEBHOOK_SECRET` | Lemon Squeezy webhook signing secret |

Serverless functions deploy automatically from `api/`: `/api/rewrite`,
`/api/pro-session`, `/api/lemon-webhook`.

Lemon Squeezy setup:

1. Create a store + a $9.99/mo subscription product with license keys enabled.
2. Add a webhook targeting `https://<your-domain>/api/lemon-webhook`.
3. Set its signing secret equal to `PATINA_LEMON_WEBHOOK_SECRET`.

Verify the Pro path locally with no money and no real key — the
`tests/unit/rewrite-pro-path.test.js` flow seeds an `active` entitlement + a
session in a mock KV, POSTs `{tier:"pro", proSessionToken}`, and expects a
streamed `start/delta/done`. A bogus token returns 401; gate-off returns 403.

### Level C — open paid checkout

Only after **all** `docs/RELEASE-CHECKLIST.md` gates pass (1–11 in CI here, plus
the private CROSS-TRACK gate 12: the real enhanced ko engine passes the same
`EnhancedRewriteEngine` contract and wins a paired ko benchmark with no
false-positive regression). Then swap `createStubEnhancedEngine()` for the
private engine and enable checkout. File/confirm the KIPO 'patina' trademark
first.
