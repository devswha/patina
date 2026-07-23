# G002 probe collector — rebuild design (tracked)

> The original G002 collector left with the `ops/*` harness when the repo went
> public. Per AGENTS.md, automation restarts only from a tracked design — this
> is that design. Target: produce a content-valid PAY-B-COST-v1 receipt
> (spec: [`pay-b-cost-v1.md`](pay-b-cost-v1.md), issuer:
> `scripts/pay-b-cost-receipt.mjs`) for the GATE_B blocker.

## What the receipt needs

- `sourceBundle.channel = 'staging'`: probes MUST run against a staging
  (preview) deployment, never production.
- Exactly **3 unique probes**, each with `inputChars` and per-stage
  (`rewrite`, `mps`, `fidelity`) one-based attempt arrays carrying outcome,
  retryReason, requested/effective model, and **raw provider usage** per
  billed attempt.
- Per-attempt `providerBillingFacts` (`provider_usage` source, raw usage
  hashed) fed to `collectPayBCostSourceBundle`; the issuer derives costs,
  bootstrap-95% unit COGS, sensitivity cases, and enforces gross margin
  ≥ 60% against $9.99 net of fees and refund reserve.

## Where the data already exists

- `callLLM` / `callLLMStream` capture per-attempt response metadata including
  provider usage (`prompt_tokens`/`input_tokens` shapes G002 accepts) and
  one-based retry records — pinned by the api tests ("records every paid retry
  exactly once with response-derived metadata").
- `runWebRewriteStream` privately aggregates exact one-based attempts for
  every paid stage (rewrite/mps/fidelity) with validity marking.

Missing piece: an EXPORT path for those aggregates on a staging deployment.

## Design (minimal, staging-only)

1. **Attempt export, staging-only**: in the rewrite handler, when
   `PATINA_DEPLOYMENT_CHANNEL === 'staging'` AND a server-configured internal
   probe marker header matches (the existing internal-marker mechanism in
   `rewrite-handler.js`), log one structured line per request:
   `{"g002":{probeId, stages:{rewrite:[...], mps:[...], fidelity:[...]}}}`
   with raw usage per attempt. Production never logs this (channel gate), and
   the marker never reaches providers/frames (already guaranteed).
2. **Collector script** (`scripts/g002-collect.mjs`): drives 3 probes with
   distinct realistic customer texts against the preview deployment using the
   staging-allowlisted model, then pulls the structured lines via the Vercel
   log query credentials (`PATINA_VERCEL_LOG_QUERY_*`), assembles `rawG002` +
   `providerBillingFacts`, and pipes into `issuePayBCostReceipt`.
3. **Pricing facts**: `pricing.sourceChars` = pasted provider pricing-page
   text (hashed); rates in integer USD micros for input/output/cache
   read/creation + minimum charge.
4. **Financial inputs**: `feeUsdMicros` from the observed live order
   (Lemon Squeezy fee on the 2026-07-23 $9.99 order), refund reserve as an
   owner-set integer, bootstrap seed = the PAY-B evidence ID.

## Effort and order

Step 1 is a small, test-covered handler change (staging-gated logging);
step 2 is a standalone script with no runtime footprint. Run order: deploy
preview -> run collector (3 probes ≈ 9–18 paid calls on the staging model) ->
issue receipt -> attach to Gate B. Estimated one focused session.
