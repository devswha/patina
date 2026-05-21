# Benchmark Report

This is the latest checked-in report for patina's deterministic suspect-zone benchmark.

> Scope: this benchmark measures whether patina's stylometry layer flags fixture paragraphs as AI-like editing hotspots. It does **not** prove whether a real document was written by a human or by AI.

## Current result

- Status: **passing**
- Generated at: 2026-05-21T10:10:46.525Z
- Node: v22.17.1
- Fixture schema: v1
- Fixtures: 38
- Languages: 4 (en, ja, ko, zh)
- Overall accuracy: **100.0%** [90.8%–100.0%] (n=38, Wilson score interval, 95%)
- Source fixtures: `tests/fixtures/suspect-zones/**`
- Regression ranges: `tests/fixtures/suspect-zones/expected-ranges.json` (refresh with `npm run benchmark:ranges`)
- Reproduce: `npm run benchmark:report`
- Raw JSON: [latest.json](latest.json)
- Detector comparison harness: [detector-comparison.md](detector-comparison.md)
- 2025+ re-baseline plan: [docs/research/2025-rebaseline-plan.md](../research/2025-rebaseline-plan.md)

## Language breakdown

| lang | fixtures | accuracy | 95% CI | precision | recall | f1 | TP | FP | FN | TN |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| en | 11 | 100.0% | 74.1%–100.0% | 100.0% | 100.0% | 1 | 6 | 0 | 0 | 5 |
| ja | 8 | 100.0% | 67.6%–100.0% | 100.0% | 100.0% | 1 | 4 | 0 | 0 | 4 |
| ko | 11 | 100.0% | 74.1%–100.0% | 100.0% | 100.0% | 1 | 6 | 0 | 0 | 5 |
| zh | 8 | 100.0% | 67.6%–100.0% | 100.0% | 100.0% | 1 | 4 | 0 | 0 | 4 |

## Detector breakdown

| lang | detector | fixtures | accuracy | 95% CI | precision | recall | f1 | TP | FP | FN | TN |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| en | burstiness | 11 | 100.0% | 74.1%–100.0% | 100.0% | 100.0% | 1 | 6 | 0 | 0 | 5 |
| en | lexicon | 11 | 45.5% | 21.3%–72.0% | 0.0% | 0.0% | 0 | 0 | 0 | 6 | 5 |
| en | mattr | 11 | 45.5% | 21.3%–72.0% | 0.0% | 0.0% | 0 | 0 | 0 | 6 | 5 |
| ja | burstiness | 8 | 87.5% | 52.9%–97.8% | 100.0% | 75.0% | 0.86 | 3 | 0 | 1 | 4 |
| ja | lexicon | 8 | 62.5% | 30.6%–86.3% | 100.0% | 25.0% | 0.4 | 1 | 0 | 3 | 4 |
| ja | mattr | 8 | 50.0% | 21.5%–78.5% | 0.0% | 0.0% | 0 | 0 | 0 | 4 | 4 |
| ko | burstiness | 11 | 100.0% | 74.1%–100.0% | 100.0% | 100.0% | 1 | 6 | 0 | 0 | 5 |
| ko | lexicon | 11 | 81.8% | 52.3%–94.9% | 100.0% | 66.7% | 0.8 | 4 | 0 | 2 | 5 |
| ko | mattr | 11 | 45.5% | 21.3%–72.0% | 0.0% | 0.0% | 0 | 0 | 0 | 6 | 5 |
| zh | burstiness | 8 | 87.5% | 52.9%–97.8% | 100.0% | 75.0% | 0.86 | 3 | 0 | 1 | 4 |
| zh | lexicon | 8 | 62.5% | 30.6%–86.3% | 100.0% | 25.0% | 0.4 | 1 | 0 | 3 | 4 |
| zh | mattr | 8 | 50.0% | 21.5%–78.5% | 0.0% | 0.0% | 0 | 0 | 0 | 4 | 4 |

## Ranking diagnostics

Signal-score ranking shows whether the diagnostic `signal_score` separates hot
fixtures from natural fixtures before any threshold is chosen. It is computed
only on the checked-in fixture corpus and is not a broader model-era claim.

| scope | fixtures | positives | negatives | ROC-AUC | PR-AUC | best threshold | precision | recall | best F1 | accuracy |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| overall | 38 | 20 | 18 | 1 | 1 | 6.772 | 100.0% | 100.0% | 1 | 100.0% |
| en | 11 | 6 | 5 | 1 | 1 | 68.994 | 100.0% | 100.0% | 1 | 100.0% |
| ja | 8 | 4 | 4 | 1 | 1 | 23.167 | 100.0% | 100.0% | 1 | 100.0% |
| ko | 11 | 6 | 5 | 1 | 1 | 67.314 | 100.0% | 100.0% | 1 | 100.0% |
| zh | 8 | 4 | 4 | 1 | 1 | 6.772 | 100.0% | 100.0% | 1 | 100.0% |

## Sample sizes

| lang | class | fixtures |
|---|---|---:|
| en | ai | 6 |
| en | natural | 5 |
| ja | ai | 4 |
| ja | natural | 4 |
| ko | ai | 6 |
| ko | natural | 5 |
| zh | ai | 4 |
| zh | natural | 4 |

## Misclassifications

All fixtures classified correctly.

## Fixture log

| fixture | lang | class | expected | predicted | ok | signal | CV band | MATTR band | lexicon/1k | sample lexicon hits |
|---|---|---|---|---|---:|---:|---:|---:|---:|---|
| en-ai-01 | en | ai | hot | hot | ✓ | 80.512 | 0.058 low | 0.928 high | 0 | — |
| en-ai-02 | en | ai | hot | hot | ✓ | 69.883 | 0.09 low | 0.841 high | 0 | — |
| en-ai-03 | en | ai | hot | hot | ✓ | 78.495 | 0.065 low | 0.828 high | 0 | — |
| en-ai-04 | en | ai | hot | hot | ✓ | 76.717 | 0.07 low | 0.84 high | 0 | — |
| en-ai-05 | en | ai | hot | hot | ✓ | 68.994 | 0.093 low | 0.879 high | 0 | — |
| en-ai-06-chat-register | en | ai | hot | hot | ✓ | 88.701 | 0.034 low | 0.814 high | 0 | — |
| en-nat-01 | en | natural | cold | cold | ✓ | 0 | 0.881 high | 0.898 high | 0 | — |
| en-nat-02 | en | natural | cold | cold | ✓ | 0 | 0.886 high | 0.884 high | 0 | — |
| en-nat-03 | en | natural | cold | cold | ✓ | 0 | 0.914 high | 0.882 high | 0 | — |
| en-nat-04 | en | natural | cold | cold | ✓ | 0 | 0.494 mid | 0.854 high | 0 | — |
| en-nat-05 | en | natural | cold | cold | ✓ | 0 | 0.853 high | 0.875 high | 0 | — |
| ja-ai-01 | ja | ai | hot | hot | ✓ | 84.959 | 0.045 low | 0.833 high | 0 | — |
| ja-ai-02 | ja | ai | hot | hot | ✓ | 23.167 | 0.23 low | 0.785 high | 0 | — |
| ja-ai-03 | ja | ai | hot | hot | ✓ | 79.067 | 0.063 low | 0.795 high | 0 | — |
| ja-ai-04-lexicon | ja | ai | hot | hot | ✓ | 100 | 0.56 high | 0.803 high | 63.83 | まとめると, 結論として, 重要なのは, デジタル時代において |
| ja-nat-01 | ja | natural | cold | cold | ✓ | 0 | 0.487 mid | 0.719 high | 0 | — |
| ja-nat-02 | ja | natural | cold | cold | ✓ | 0 | 0.65 high | 0.796 high | 0 | — |
| ja-nat-03 | ja | natural | cold | cold | ✓ | 0 | 0.395 mid | 0.807 high | 0 | — |
| ja-nat-04-lexicon-cold | ja | natural | cold | cold | ✓ | 0 | 0.396 mid | 0.752 high | 0 | — |
| ko-ai-01 | ko | ai | hot | hot | ✓ | 100 | 0.093 low | 0.977 high | 23.256 | 추세 |
| ko-ai-02 | ko | ai | hot | hot | ✓ | 100 | 0.073 low | 0.82 high | 19.608 | 환경 |
| ko-ai-03 | ko | ai | hot | hot | ✓ | 100 | 0.073 low | 0.79 high | 19.608 | 추세 |
| ko-ai-04 | ko | ai | hot | hot | ✓ | 67.314 | 0.098 low | 0.853 high | 0 | — |
| ko-ai-05 | ko | ai | hot | hot | ✓ | 67.314 | 0.098 low | 0.853 high | 0 | — |
| ko-ai-06-chat-register | ko | ai | hot | hot | ✓ | 100 | 0.081 low | 1 high | 21.739 | 흐름 |
| ko-nat-01 | ko | natural | cold | cold | ✓ | 0 | 0.717 high | 1 high | 0 | — |
| ko-nat-02 | ko | natural | cold | cold | ✓ | 0 | 0.552 high | 1 high | 0 | — |
| ko-nat-03 | ko | natural | cold | cold | ✓ | 0 | 0.68 high | 1 high | 0 | — |
| ko-nat-04 | ko | natural | cold | cold | ✓ | 0 | 0.771 high | 0.975 high | 0 | — |
| ko-nat-05 | ko | natural | cold | cold | ✓ | 0 | 0.996 high | 0.998 high | 0 | — |
| zh-ai-01 | zh | ai | hot | hot | ✓ | 79.272 | 0.062 low | 0.902 high | 0 | — |
| zh-ai-02 | zh | ai | hot | hot | ✓ | 6.772 | 0.28 low | 0.734 high | 0 | — |
| zh-ai-03 | zh | ai | hot | hot | ✓ | 72.43 | 0.083 low | 0.933 high | 0 | — |
| zh-ai-04-lexicon | zh | ai | hot | hot | ✓ | 100 | 0.748 high | 0.894 high | 92.593 | 总而言之, 总的来说, 值得注意的是, 在数字时代 |
| zh-nat-01 | zh | natural | cold | cold | ✓ | 0 | 0.506 high | 0.875 high | 0 | — |
| zh-nat-02 | zh | natural | cold | cold | ✓ | 0 | 0.528 high | 0.936 high | 0 | — |
| zh-nat-03 | zh | natural | cold | cold | ✓ | 0 | 0.58 high | 0.907 high | 0 | — |
| zh-nat-04-lexicon-cold | zh | natural | cold | cold | ✓ | 0 | 0.387 mid | 0.931 high | 0 | — |

## How to read this

- **Hot** means at least one deterministic signal crossed the benchmark threshold: low burstiness CV, low MATTR, or AI-lexicon density.
- **Cold** means the fixture did not cross those thresholds.
- **Signal** is the 0–100 diagnostic strength of the strongest deterministic trigger. It supports ranking diagnostics but does not replace the binary hot/cold regression gate.
- The report is meant for regression tracking and contributor discussion, not for authorship accusation.
- This deterministic corpus is intentionally small (38 fixtures across en, ja, ko, zh); do not treat 100% fixture accuracy as generalization to new models, genres, or edited AI text.
- Confidence intervals use Wilson score intervals for the checked-in fixture set; external threshold sweeps and 2025+ model rebaselines are separate research follow-ups tracked in [2025+ Re-baseline Plan](../research/2025-rebaseline-plan.md).
- Broader methodology notes live in [AI/Human Metrics Research](../research/ai-human-metrics.md) and [Quality Checks](../../tests/quality/README.md).
