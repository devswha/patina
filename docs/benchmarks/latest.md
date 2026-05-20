# Benchmark Report

This is the latest checked-in report for patina's deterministic suspect-zone benchmark.

> Scope: this benchmark measures whether patina's stylometry layer flags fixture paragraphs as AI-like editing hotspots. It does **not** prove whether a real document was written by a human or by AI.

## Current result

- Status: **passing**
- Generated at: 2026-05-20T02:23:17.955Z
- Fixtures: 22
- Languages: 2
- Overall accuracy: **100.0%**
- Source fixtures: `tests/fixtures/suspect-zones/**`
- Reproduce: `npm run benchmark:report`
- Raw JSON: [latest.json](latest.json)

## Language breakdown

| lang | fixtures | accuracy | precision | recall | f1 | TP | FP | FN | TN |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| en | 11 | 100.0% | 100.0% | 100.0% | 1 | 6 | 0 | 0 | 5 |
| ko | 11 | 100.0% | 100.0% | 100.0% | 1 | 6 | 0 | 0 | 5 |

## Sample sizes

| lang | class | fixtures |
|---|---|---:|
| en | ai | 6 |
| en | natural | 5 |
| ko | ai | 6 |
| ko | natural | 5 |

## Misclassifications

All fixtures classified correctly.

## Fixture log

| fixture | lang | class | expected | predicted | ok | CV band | MATTR band | lexicon/1k | sample lexicon hits |
|---|---|---|---|---|---:|---:|---:|---:|---|
| en-ai-01 | en | ai | hot | hot | ✓ | 0.058 low | 0.928 high | 0 | — |
| en-ai-02 | en | ai | hot | hot | ✓ | 0.09 low | 0.841 high | 0 | — |
| en-ai-03 | en | ai | hot | hot | ✓ | 0.065 low | 0.828 high | 0 | — |
| en-ai-04 | en | ai | hot | hot | ✓ | 0.07 low | 0.84 high | 0 | — |
| en-ai-05 | en | ai | hot | hot | ✓ | 0.093 low | 0.879 high | 0 | — |
| en-ai-06-chat-register | en | ai | hot | hot | ✓ | 0.034 low | 0.814 high | 0 | — |
| en-nat-01 | en | natural | cold | cold | ✓ | 0.881 high | 0.898 high | 0 | — |
| en-nat-02 | en | natural | cold | cold | ✓ | 0.886 high | 0.884 high | 0 | — |
| en-nat-03 | en | natural | cold | cold | ✓ | 0.914 high | 0.882 high | 0 | — |
| en-nat-04 | en | natural | cold | cold | ✓ | 0.494 mid | 0.854 high | 0 | — |
| en-nat-05 | en | natural | cold | cold | ✓ | 0.853 high | 0.875 high | 0 | — |
| ko-ai-01 | ko | ai | hot | hot | ✓ | 0.093 low | 0.977 high | 23.256 | 추세 |
| ko-ai-02 | ko | ai | hot | hot | ✓ | 0.073 low | 0.82 high | 19.608 | 환경 |
| ko-ai-03 | ko | ai | hot | hot | ✓ | 0.073 low | 0.79 high | 19.608 | 추세 |
| ko-ai-04 | ko | ai | hot | hot | ✓ | 0.098 low | 0.853 high | 0 | — |
| ko-ai-05 | ko | ai | hot | hot | ✓ | 0.098 low | 0.853 high | 0 | — |
| ko-ai-06-chat-register | ko | ai | hot | hot | ✓ | 0.081 low | 1 high | 21.739 | 흐름 |
| ko-nat-01 | ko | natural | cold | cold | ✓ | 0.717 high | 1 high | 0 | — |
| ko-nat-02 | ko | natural | cold | cold | ✓ | 0.552 high | 1 high | 0 | — |
| ko-nat-03 | ko | natural | cold | cold | ✓ | 0.68 high | 1 high | 0 | — |
| ko-nat-04 | ko | natural | cold | cold | ✓ | 0.771 high | 0.975 high | 0 | — |
| ko-nat-05 | ko | natural | cold | cold | ✓ | 0.996 high | 0.998 high | 0 | — |

## How to read this

- **Hot** means at least one deterministic signal crossed the benchmark threshold: low burstiness CV, low MATTR, or AI-lexicon density.
- **Cold** means the fixture did not cross those thresholds.
- The report is meant for regression tracking and contributor discussion, not for authorship accusation.
- This deterministic corpus is intentionally small (22 fixtures) and currently covers only checked-in ko/en suspect-zone fixtures; do not treat 100% fixture accuracy as generalization to new models, genres, or edited AI text.
- Confidence intervals, threshold sweeps, and 2025+ model rebaselines are tracked as benchmark follow-ups, not claimed by this report yet.
- Broader methodology notes live in [AI/Human Metrics Research](../research/ai-human-metrics.md) and [Quality Checks](../../tests/quality/README.md).
