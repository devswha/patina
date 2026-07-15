# PAY-B-COST-v1 staging cost receipt

`PAY-B-COST-v1` is a deterministic local validator for complete customer-probe staging evidence. It is not a Gate B approval, payment receipt, checkout binding, deployment action, production authorization, or provider call. Provider-billing authenticity remains private human Gate-B evidence; this collector independently closes its structure, joins, and hashes.

## Issue and validate

```sh
node scripts/pay-b-cost-receipt.mjs < staging-evidence.json > staging-cost-receipt.json
```

The stdin issuer adds only `issuer`, per-attempt `attemptCosts`, derived financial values, and `artifactSha256`. `validatePayBCostReceipt` independently validates an issued receipt.

## Deterministic G002 collector and immutable bundle

`collectPayBCostSourceBundle(rawG002, providerBillingFacts)` is the only supported way to turn exact raw G002 probe/stage attempt arrays into a bundle. It takes the raw metadata and three probe records plus a separate array of facts keyed by `probeId`, `stage`, and one-based `attemptIndex`. The collector rejects missing, extra, or duplicate facts; derives `billingDisposition` from the fact's `billed` value; canonicalizes the resulting bundle; and computes each evidence hash. Callers do not hand-edit runtime records.

The immutable `sourceBundle` has exact metadata pins: `channel`, `collectorVersion`, `sourceCommitSha`, `deploymentId`, `provider`, `requestedModel`, `effectiveModel`, and `usageAdapterVersion: "g002-provider-usage-v1"`. The receipt repeats those pins (except adapter version), and every repeated value must equal the bundle. Every billed attempt's requested and effective model must equal the exact bundle pins. An unbilled real G002 failure retains the exact bundle `requestedModel` (never null), while its `effectiveModel` and `usage` are null.

There are exactly three unique probes, each with positive `inputChars` and `rewrite`, `mps`, and `fidelity` attempt arrays. Indexes are one-based and contiguous; preterminal attempts are errors and terminal attempts succeed. First attempts are `initial`; a later `initial` is legal only after errored `score_schema_parse`.

Each bundled attempt embeds a closed billing fact, rather than only a reference hash:

```json
{
  "billingDisposition": "billed",
  "billingEvidence": {
    "version": "provider-billing-v1",
    "source": "provider_usage",
    "provider": "...",
    "externalReferenceSha256": "64 lowercase hex",
    "billed": true,
    "rawUsageSha256": "64 lowercase hex",
    "unbilledReason": null,
    "providerReportedAmountUsdMicros": 123
  },
  "billingEvidenceSha256": "SHA-256 canonical billingEvidence"
}
```

`source` is exactly `provider_usage` or `provider_invoice`; evidence provider must equal bundle provider. A billed fact hashes the exact raw usage and may contain an integer provider-reported amount. An unbilled fact has null raw-usage hash and a non-empty explicit unbilled reason. Unbilled runtime attempts are verified unbilled errors: their requested model is the exact bundle pin, their effective model and usage are null, `minimumChargeApplied` is false, and their derived charge is zero.

## Usage, pricing, and cost closure

The versioned adapter preserves full raw usage in the hashed bundle. It accepts G002/OpenAI `prompt_tokens`, `completion_tokens`, optional verified `total_tokens`, `cost_usd` (finite non-negative and not used for token pricing), and supported numeric prompt/completion detail counters. It also accepts Anthropic `input_tokens`, `output_tokens`, `cache_read_input_tokens`, and `cache_creation_input_tokens`; cache categories have explicit pricing. Unknown fields, mixed shapes, unsafe numeric values, inconsistent totals, and excessive cached prompt tokens fail.

Pricing carries source text/source hash plus explicit positive rates, granularities, and minimum charge for input, output, cache-read, and cache-creation. All money is integer USD micros. The validator recomputes every attempt cost from raw usage and pricing; provider-reported amount is evidence, not a pricing override.

## Financial derivation

Complete pipeline costs include billed failed retries and scale to one million input characters. A SHA-256-seeded xorshift bootstrap resamples the three values 10,000 times; sorted index 9499 is the 95% upper COGS. The six required sensitivity outputs are `retry_failure_10`, `retry_failure_20`, `token_char_p95`, `token_char_p95_20`, `price_20`, and `minimum_charge_worst_case`.

`minimum_charge_worst_case` is deliberately independent of reduced rates and bootstrap: `maximum observed pipeline attempt count × provider minimum charge × ceil(1,000,000 / minimum observed source chars)`. Selected COGS is the maximum of base and all six sensitivities.

`Rnet` is exactly `9990000 - feeUsdMicros - refundReserveUsdMicros`. GM is mathematical `floor((Rnet - selectedUpperCOGS) * 10000 / Rnet)`, including negative numerators, and must be at least 6000 bps. Validation recomputes all financial values before checking `artifactSha256`; the hash is SHA-256 canonical JSON of the complete receipt without itself.
