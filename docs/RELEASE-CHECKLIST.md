# patina Pro — payment-open release checklist

The hosted Pro tier ships **disabled by default** (`PATINA_PRO_ENABLED` off) and
the public checkout flag stays **off** until every gate below passes. This
prevents the order-inversion failure: never sell Pro before the enhanced engine
is real and demonstrably better than free.

> Rule: **`PAYMENT_OPEN` (public checkout) is enabled ONLY after all gates pass.**
> A deployment that cannot show the CROSS-TRACK quality artifact must fail its
> payment-open readiness check and keep checkout hidden.

## THIS-PLAN gates (public repo — verifiable here)

1. **Gate-off no-regression** — `PATINA_PRO_ENABLED=false`: free/BYOK validation, rate limiter, provider resolution, and the deterministic `src/features/*` are unchanged. (`npm test`)
2. **Shared KV store contract** — memory KV and REST KV pass the same get/set/incr/TTL contract; production fails closed without KV; no raw secret in a URL/value. (`kv-store-contract*`)
3. **Entitlement state machine** — transitions, idempotency, out-of-order/stale rejection, terminal-resurrection prevention, malformed-expiry fail-closed. (`pro-entitlements*`)
4. **Opaque Pro session token** — license key exchanged once → opaque token; sliding + absolute expiry; revoke cuts access; raw key/token never stored/logged. (`pro-session*`)
5. **Lemon webhook mirror** — timing-safe signature, idempotency, mirror-before-marker ordering, correct refund/cancel subscription scoping. (`lemon-webhook*`)
6. **EnhancedRewriteEngine contract + stub** — the public stub and the private engine pass the SAME contract; the stub makes no quality claim (floor scores). (`enhanced-rewrite-engine*`)
7. **Pro metering** — per-entitlement day/hour/minute caps; malformed counter/outage fail-closed. (`pro-metering*`)
8. **Pro rewrite path** — session → entitlement → metering → engine; every failure is explicit (401/402/429/503); never falls back to free/BYOK. (`rewrite-pro-path*`)
9. **Client + legal copy** — pro requests carry only the opaque token; the raw key is never retained; ko refund/cancel copy is a single source (7-day + digital limit + Lemon MoR). (`rewrite-client-pro*`)
10. **Leak gate** — `npm run check:no-private-assets` is clean; planted private/enhanced/reinforced/corpus/server fixtures are caught. No raw key/email/secret in the package or logs.
11. **Full regression + lint** — `npm test` green and `npm run lint` (syntax/eslint/typecheck/spellcheck) clean.

## CROSS-TRACK gate (private — NOT verifiable in this repo)

12. **Enhanced ko engine quality** — the private engine passes the SAME `EnhancedRewriteEngine` contract AND a paired ko benchmark shows a statistically significant win over the free baseline with no FP regression. Until this artifact exists, payment-open readiness fails.

## Open only after 1–12

Only when gates 1–11 pass in CI AND the CROSS-TRACK quality artifact (gate 12)
is attached may the public checkout flag be enabled. Trademark: file/confirm the
KIPO 'patina' mark and keep the NOTICE brand policy current before public sale.
