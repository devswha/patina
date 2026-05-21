# Detector Comparison Harness

This report is generated offline from the checked-in suspect-zone fixtures. It is a comparison harness, not a vendor ranking claim.

## Current run

- Generated at: 2026-05-21T10:10:46.820Z
- Fixture source: `tests/fixtures/suspect-zones/**`
- Fixture count: 38
- Manual third-party input: none
- Reproduce built-in comparison: `npm run benchmark:compare`
- Merge manual scores: `node scripts/detector-comparison.mjs --input tests/quality/detectors.manual.example.json`

## Summary

| detector | name | kind | covered | coverage | accuracy | precision | recall | TP | FP | FN | TN |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| patina-deterministic | Patina deterministic suspect-zone analyzer | in-tree | 38/38 | 100.0% | 100.0% | 100.0% | 100.0% | 20 | 0 | 0 | 18 |

## Fixture-level rows

| fixture | lang | class | detector | expected | predicted | ok | score | source |
|---|---|---|---|---|---|---:|---:|---|
| en-ai-01 | en | ai | patina-deterministic | hot | hot | ✓ | 1 | tests/quality/benchmark.mjs |
| en-ai-02 | en | ai | patina-deterministic | hot | hot | ✓ | 1 | tests/quality/benchmark.mjs |
| en-ai-03 | en | ai | patina-deterministic | hot | hot | ✓ | 1 | tests/quality/benchmark.mjs |
| en-ai-04 | en | ai | patina-deterministic | hot | hot | ✓ | 1 | tests/quality/benchmark.mjs |
| en-ai-05 | en | ai | patina-deterministic | hot | hot | ✓ | 1 | tests/quality/benchmark.mjs |
| en-ai-06-chat-register | en | ai | patina-deterministic | hot | hot | ✓ | 1 | tests/quality/benchmark.mjs |
| en-nat-01 | en | natural | patina-deterministic | cold | cold | ✓ | 0 | tests/quality/benchmark.mjs |
| en-nat-02 | en | natural | patina-deterministic | cold | cold | ✓ | 0 | tests/quality/benchmark.mjs |
| en-nat-03 | en | natural | patina-deterministic | cold | cold | ✓ | 0 | tests/quality/benchmark.mjs |
| en-nat-04 | en | natural | patina-deterministic | cold | cold | ✓ | 0 | tests/quality/benchmark.mjs |
| en-nat-05 | en | natural | patina-deterministic | cold | cold | ✓ | 0 | tests/quality/benchmark.mjs |
| ja-ai-01 | ja | ai | patina-deterministic | hot | hot | ✓ | 1 | tests/quality/benchmark.mjs |
| ja-ai-02 | ja | ai | patina-deterministic | hot | hot | ✓ | 1 | tests/quality/benchmark.mjs |
| ja-ai-03 | ja | ai | patina-deterministic | hot | hot | ✓ | 1 | tests/quality/benchmark.mjs |
| ja-ai-04-lexicon | ja | ai | patina-deterministic | hot | hot | ✓ | 1 | tests/quality/benchmark.mjs |
| ja-nat-01 | ja | natural | patina-deterministic | cold | cold | ✓ | 0 | tests/quality/benchmark.mjs |
| ja-nat-02 | ja | natural | patina-deterministic | cold | cold | ✓ | 0 | tests/quality/benchmark.mjs |
| ja-nat-03 | ja | natural | patina-deterministic | cold | cold | ✓ | 0 | tests/quality/benchmark.mjs |
| ja-nat-04-lexicon-cold | ja | natural | patina-deterministic | cold | cold | ✓ | 0 | tests/quality/benchmark.mjs |
| ko-ai-01 | ko | ai | patina-deterministic | hot | hot | ✓ | 1 | tests/quality/benchmark.mjs |
| ko-ai-02 | ko | ai | patina-deterministic | hot | hot | ✓ | 1 | tests/quality/benchmark.mjs |
| ko-ai-03 | ko | ai | patina-deterministic | hot | hot | ✓ | 1 | tests/quality/benchmark.mjs |
| ko-ai-04 | ko | ai | patina-deterministic | hot | hot | ✓ | 1 | tests/quality/benchmark.mjs |
| ko-ai-05 | ko | ai | patina-deterministic | hot | hot | ✓ | 1 | tests/quality/benchmark.mjs |
| ko-ai-06-chat-register | ko | ai | patina-deterministic | hot | hot | ✓ | 1 | tests/quality/benchmark.mjs |
| ko-nat-01 | ko | natural | patina-deterministic | cold | cold | ✓ | 0 | tests/quality/benchmark.mjs |
| ko-nat-02 | ko | natural | patina-deterministic | cold | cold | ✓ | 0 | tests/quality/benchmark.mjs |
| ko-nat-03 | ko | natural | patina-deterministic | cold | cold | ✓ | 0 | tests/quality/benchmark.mjs |
| ko-nat-04 | ko | natural | patina-deterministic | cold | cold | ✓ | 0 | tests/quality/benchmark.mjs |
| ko-nat-05 | ko | natural | patina-deterministic | cold | cold | ✓ | 0 | tests/quality/benchmark.mjs |
| zh-ai-01 | zh | ai | patina-deterministic | hot | hot | ✓ | 1 | tests/quality/benchmark.mjs |
| zh-ai-02 | zh | ai | patina-deterministic | hot | hot | ✓ | 1 | tests/quality/benchmark.mjs |
| zh-ai-03 | zh | ai | patina-deterministic | hot | hot | ✓ | 1 | tests/quality/benchmark.mjs |
| zh-ai-04-lexicon | zh | ai | patina-deterministic | hot | hot | ✓ | 1 | tests/quality/benchmark.mjs |
| zh-nat-01 | zh | natural | patina-deterministic | cold | cold | ✓ | 0 | tests/quality/benchmark.mjs |
| zh-nat-02 | zh | natural | patina-deterministic | cold | cold | ✓ | 0 | tests/quality/benchmark.mjs |
| zh-nat-03 | zh | natural | patina-deterministic | cold | cold | ✓ | 0 | tests/quality/benchmark.mjs |
| zh-nat-04-lexicon-cold | zh | natural | patina-deterministic | cold | cold | ✓ | 0 | tests/quality/benchmark.mjs |

## Manual third-party protocol

1. Use only redistributable fixture text from `tests/fixtures/suspect-zones/**`.
2. Paste text into a third-party detector manually, respecting that service's terms.
3. Record only fixture id, detector id, date/version, score, and hot/cold label. Do not check private text into the repo.
4. Run this script with `--input <json>`. The script does not scrape sites or call external APIs.
5. Treat results as time-stamped evidence, not a universal claim about authorship detection.
