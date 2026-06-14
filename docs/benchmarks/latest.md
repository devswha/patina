# Benchmark Report

This is the latest checked-in report for patina's deterministic suspect-zone benchmark.

> Scope: this benchmark measures whether patina's stylometry layer flags fixture paragraphs as AI-like editing hotspots. It does **not** prove whether a real document was written by a human or by AI.

## Current result

- Status: **passing**
- Generated at: 2026-06-14T09:51:18.214Z
- Node: v22.17.1
- Fixture schema: v1
- Fixtures: 49
- Languages: 4 (en, ja, ko, zh)
- Overall accuracy: **100.0%** [92.7%–100.0%] (n=49, Wilson score interval, 95%)
- Source fixtures: `tests/fixtures/suspect-zones/**`
- Regression ranges: `tests/fixtures/suspect-zones/expected-ranges.json` (refresh with `npm run benchmark:ranges`)
- Reproduce: `npm run benchmark:report`
- Raw JSON: [latest.json](latest.json)
- Detector comparison protocol: [detector-comparison.md](detector-comparison.md)
- 2025+ re-baseline plan: [docs/research/2025-rebaseline-plan.md](../research/2025-rebaseline-plan.md)

## Language breakdown

| lang | fixtures | accuracy | 95% CI | precision | recall | f1 | TP | FP | FN | TN |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| en | 13 | 100.0% | 77.2%–100.0% | 100.0% | 100.0% | 1 | 7 | 0 | 0 | 6 |
| ja | 12 | 100.0% | 75.8%–100.0% | 100.0% | 100.0% | 1 | 6 | 0 | 0 | 6 |
| ko | 12 | 100.0% | 75.8%–100.0% | 100.0% | 100.0% | 1 | 7 | 0 | 0 | 5 |
| zh | 12 | 100.0% | 75.8%–100.0% | 100.0% | 100.0% | 1 | 6 | 0 | 0 | 6 |

## Detector breakdown

| lang | detector | fixtures | accuracy | 95% CI | precision | recall | f1 | TP | FP | FN | TN |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| en | burstiness | 13 | 92.3% | 66.7%–98.6% | 100.0% | 85.7% | 0.92 | 6 | 0 | 1 | 6 |
| en | koDiagnostics | 13 | 46.2% | 23.2%–70.9% | 0.0% | 0.0% | 0 | 0 | 0 | 7 | 6 |
| en | lexicon | 13 | 46.2% | 23.2%–70.9% | 0.0% | 0.0% | 0 | 0 | 0 | 7 | 6 |
| en | mattr | 13 | 46.2% | 23.2%–70.9% | 0.0% | 0.0% | 0 | 0 | 0 | 7 | 6 |
| ja | burstiness | 12 | 91.7% | 64.6%–98.5% | 100.0% | 83.3% | 0.91 | 5 | 0 | 1 | 6 |
| ja | koDiagnostics | 12 | 50.0% | 25.4%–74.6% | 0.0% | 0.0% | 0 | 0 | 0 | 6 | 6 |
| ja | lexicon | 12 | 75.0% | 46.8%–91.1% | 100.0% | 50.0% | 0.67 | 3 | 0 | 3 | 6 |
| ja | mattr | 12 | 50.0% | 25.4%–74.6% | 0.0% | 0.0% | 0 | 0 | 0 | 6 | 6 |
| ko | burstiness | 12 | 91.7% | 64.6%–98.5% | 100.0% | 85.7% | 0.92 | 6 | 0 | 1 | 5 |
| ko | koDiagnostics | 12 | 58.3% | 32.0%–80.7% | 100.0% | 28.6% | 0.44 | 2 | 0 | 5 | 5 |
| ko | lexicon | 12 | 41.7% | 19.3%–68.0% | 0.0% | 0.0% | 0 | 0 | 0 | 7 | 5 |
| ko | mattr | 12 | 41.7% | 19.3%–68.0% | 0.0% | 0.0% | 0 | 0 | 0 | 7 | 5 |
| zh | burstiness | 12 | 75.0% | 46.8%–91.1% | 100.0% | 50.0% | 0.67 | 3 | 0 | 3 | 6 |
| zh | koDiagnostics | 12 | 50.0% | 25.4%–74.6% | 0.0% | 0.0% | 0 | 0 | 0 | 6 | 6 |
| zh | lexicon | 12 | 75.0% | 46.8%–91.1% | 100.0% | 50.0% | 0.67 | 3 | 0 | 3 | 6 |
| zh | mattr | 12 | 50.0% | 25.4%–74.6% | 0.0% | 0.0% | 0 | 0 | 0 | 6 | 6 |

## Ranking diagnostics

Signal-score ranking shows whether the diagnostic `signal_score` separates hot
fixtures from natural fixtures before any threshold is chosen. It is computed
only on the checked-in fixture corpus and is not a broader model-era claim.

| scope | fixtures | positives | negatives | ROC-AUC | PR-AUC | best threshold | precision | recall | best F1 | accuracy |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| overall | 49 | 26 | 23 | 1 | 1 | 3.846 | 100.0% | 100.0% | 1 | 100.0% |
| en | 13 | 7 | 6 | 1 | 1 | 50 | 100.0% | 100.0% | 1 | 100.0% |
| ja | 12 | 6 | 6 | 1 | 1 | 23.167 | 100.0% | 100.0% | 1 | 100.0% |
| ko | 12 | 7 | 5 | 1 | 1 | 3.846 | 100.0% | 100.0% | 1 | 100.0% |
| zh | 12 | 6 | 6 | 1 | 1 | 6.772 | 100.0% | 100.0% | 1 | 100.0% |

## Low-FPR operating points

TPR at a fixed false-positive budget. Aggregate AUROC/accuracy can hide
deployment failure, so these report the strict operating point on the checked-in
fixture corpus. `n/a` marks a slice without enough negatives (or positives) to
support the target; `max FP` of 0 is a strict zero-false-positive point.

| scope | target FPR | negatives | max FP | actual FPR | TPR |
|---|---:|---:|---:|---:|---:|
| overall | 1.0% | 23 | 0 | 0.0% | 100.0% |
| overall | 5.0% | 23 | 1 | 0.0% | 100.0% |
| en | 1.0% | 6 | 0 | 0.0% | 100.0% |
| en | 5.0% | 6 | 0 | 0.0% | 100.0% |
| ja | 1.0% | 6 | 0 | 0.0% | 100.0% |
| ja | 5.0% | 6 | 0 | 0.0% | 100.0% |
| ko | 1.0% | 5 | 0 | 0.0% | 100.0% |
| ko | 5.0% | 5 | 0 | 0.0% | 100.0% |
| zh | 1.0% | 6 | 0 | 0.0% | 100.0% |
| zh | 5.0% | 6 | 0 | 0.0% | 100.0% |

## Slice metrics

Report-only confusion metrics grouped by metadata dimension. `language`,
`class`, and `lengthBucket` are derived from current fixtures; `generator` and
`edited` are resolved through the model_family/edit_depth mapper (human controls
become `generator: human`, un-edited rows become `edited: none`); `domain` and
`register` default to `unspecified` until the corpus carries that metadata.
Slices below the per-dimension minimum count are reported as `insufficient data`
(counts only). No detector thresholds change.

### language (min 5)

| value | n | accuracy | precision | recall | f1 | state |
|---|---:|---:|---:|---:|---:|---|
| en | 13 | 100.0% | 100.0% | 100.0% | 1 | ok |
| ja | 12 | 100.0% | 100.0% | 100.0% | 1 | ok |
| ko | 12 | 100.0% | 100.0% | 100.0% | 1 | ok |
| zh | 12 | 100.0% | 100.0% | 100.0% | 1 | ok |

### class (min 5)

| value | n | accuracy | precision | recall | f1 | state |
|---|---:|---:|---:|---:|---:|---|
| ai | 26 | 100.0% | 100.0% | 100.0% | 1 | ok |
| natural | 23 | 100.0% | — | — | — | ok |

### lengthBucket (min 5)

| value | n | accuracy | precision | recall | f1 | state |
|---|---:|---:|---:|---:|---:|---|
| medium | 12 | 100.0% | 100.0% | 100.0% | 1 | ok |
| short | 37 | 100.0% | 100.0% | 100.0% | 1 | ok |

### domain (min 5)

| value | n | accuracy | precision | recall | f1 | state |
|---|---:|---:|---:|---:|---:|---|
| unspecified | 49 | 100.0% | 100.0% | 100.0% | 1 | ok |

### register (min 5)

| value | n | accuracy | precision | recall | f1 | state |
|---|---:|---:|---:|---:|---:|---|
| unspecified | 48 | 100.0% | 100.0% | 100.0% | 1 | ok |
| workplace-summary | 1 | — | — | — | — | insufficient_data |

### generator (min 5)

| value | n | accuracy | precision | recall | f1 | state |
|---|---:|---:|---:|---:|---:|---|
| human | 23 | 100.0% | — | — | — | ok |
| local-fixture | 1 | — | — | — | — | insufficient_data |
| unspecified | 25 | 100.0% | 100.0% | 100.0% | 1 | ok |

### edited (min 5)

| value | n | accuracy | precision | recall | f1 | state |
|---|---:|---:|---:|---:|---:|---|
| none | 49 | 100.0% | 100.0% | 100.0% | 1 | ok |

## Sample sizes

| lang | class | fixtures |
|---|---|---:|
| en | ai | 7 |
| en | natural | 6 |
| ja | ai | 6 |
| ja | natural | 6 |
| ko | ai | 7 |
| ko | natural | 5 |
| zh | ai | 6 |
| zh | natural | 6 |

## Misclassifications

All fixtures classified correctly.

## Fixture log

| fixture | lang | class | expected | predicted | ok | signal | CV band | MATTR band | lexicon/1k | KO diagnostic | sample lexicon hits |
|---|---|---|---|---|---:|---:|---:|---:|---:|---|---|
| en-ai-01 | en | ai | hot | hot | ✓ | 80.512 | 0.058 low | 0.928 high | 0 | cold | — |
| en-ai-02 | en | ai | hot | hot | ✓ | 69.883 | 0.09 low | 0.841 high | 0 | cold | — |
| en-ai-03 | en | ai | hot | hot | ✓ | 78.495 | 0.065 low | 0.828 high | 0 | cold | — |
| en-ai-04 | en | ai | hot | hot | ✓ | 76.717 | 0.07 low | 0.84 high | 0 | cold | — |
| en-ai-05 | en | ai | hot | hot | ✓ | 68.994 | 0.093 low | 0.879 high | 0 | cold | — |
| en-ai-06-chat-register | en | ai | hot | hot | ✓ | 88.701 | 0.034 low | 0.814 high | 0 | cold | — |
| en-ai-07-discourse-candor | en | ai | hot | hot | ✓ | 50 | 0.358 mid | 0.872 high | 0 | cold | — |
| en-nat-01 | en | natural | cold | cold | ✓ | 0 | 0.881 high | 0.898 high | 0 | cold | — |
| en-nat-02 | en | natural | cold | cold | ✓ | 0 | 0.886 high | 0.884 high | 0 | cold | — |
| en-nat-03 | en | natural | cold | cold | ✓ | 0 | 0.914 high | 0.882 high | 0 | cold | — |
| en-nat-04 | en | natural | cold | cold | ✓ | 0 | 0.494 mid | 0.854 high | 0 | cold | — |
| en-nat-05 | en | natural | cold | cold | ✓ | 0 | 0.853 high | 0.875 high | 0 | cold | — |
| en-nat-06-single-opener | en | natural | cold | cold | ✓ | 0 | 0.552 high | 0.84 high | 0 | cold | — |
| ja-ai-01 | ja | ai | hot | hot | ✓ | 84.959 | 0.045 low | 0.833 high | 0 | cold | — |
| ja-ai-02 | ja | ai | hot | hot | ✓ | 23.167 | 0.23 low | 0.785 high | 0 | cold | — |
| ja-ai-03 | ja | ai | hot | hot | ✓ | 79.067 | 0.063 low | 0.795 high | 0 | cold | — |
| ja-ai-04-lexicon | ja | ai | hot | hot | ✓ | 100 | 0.56 high | 0.803 high | 63.83 | cold | まとめると, 結論として, 重要なのは, デジタル時代において |
| ja-ai-05-formulaic-summary | ja | ai | hot | hot | ✓ | 100 | 0.155 low | 0.77 high | 74.074 | cold | まとめると, 現代社会において, デジタル時代において, 長期的に見ると |
| ja-ai-06-broad-tech | ja | ai | hot | hot | ✓ | 100 | 0.243 low | 0.765 high | 73.77 | cold | 結論として, テクノロジーの進化により, 一方で~他方で, ~と言えるでしょう |
| ja-nat-01 | ja | natural | cold | cold | ✓ | 0 | 0.487 mid | 0.719 high | 0 | cold | — |
| ja-nat-02 | ja | natural | cold | cold | ✓ | 0 | 0.65 high | 0.796 high | 0 | cold | — |
| ja-nat-03 | ja | natural | cold | cold | ✓ | 0 | 0.395 mid | 0.807 high | 0 | cold | — |
| ja-nat-04-lexicon-cold | ja | natural | cold | cold | ✓ | 0 | 0.396 mid | 0.752 high | 0 | cold | — |
| ja-nat-05-station-note | ja | natural | cold | cold | ✓ | 0 | 0.564 high | 0.822 high | 0 | cold | — |
| ja-nat-06-maintenance-log | ja | natural | cold | cold | ✓ | 0 | 0.519 high | 0.88 high | 0 | cold | — |
| ko-ai-01 | ko | ai | hot | hot | ✓ | 68.992 | 0.093 low | 0.977 high | 23.256 | cold | 추세 |
| ko-ai-02 | ko | ai | hot | hot | ✓ | 75.545 | 0.073 low | 0.82 high | 0 | cold | — |
| ko-ai-03 | ko | ai | hot | hot | ✓ | 75.545 | 0.073 low | 0.79 high | 19.608 | cold | 추세 |
| ko-ai-04 | ko | ai | hot | hot | ✓ | 67.314 | 0.098 low | 0.853 high | 0 | cold | — |
| ko-ai-05 | ko | ai | hot | hot | ✓ | 67.314 | 0.098 low | 0.853 high | 0 | hot: regular-eojeol-length, low-comma-density, low-suffix-class-diversity | — |
| ko-ai-06-chat-register | ko | ai | hot | hot | ✓ | 72.887 | 0.081 low | 1 high | 0 | cold | — |
| ko-ai-07-ko-diagnostic | ko | ai | hot | hot | ✓ | 3.846 | 0.417 mid | 0.955 high | 0 | hot: regular-eojeol-length, low-comma-density, low-suffix-class-diversity | — |
| ko-nat-01 | ko | natural | cold | cold | ✓ | 0 | 0.717 high | 1 high | 0 | cold | — |
| ko-nat-02 | ko | natural | cold | cold | ✓ | 0 | 0.552 high | 1 high | 0 | cold | — |
| ko-nat-03 | ko | natural | cold | cold | ✓ | 0 | 0.68 high | 1 high | 0 | cold | — |
| ko-nat-04 | ko | natural | cold | cold | ✓ | 0 | 0.771 high | 0.975 high | 0 | cold | — |
| ko-nat-05 | ko | natural | cold | cold | ✓ | 0 | 0.996 high | 0.998 high | 0 | cold | — |
| zh-ai-01 | zh | ai | hot | hot | ✓ | 79.272 | 0.062 low | 0.902 high | 0 | cold | — |
| zh-ai-02 | zh | ai | hot | hot | ✓ | 6.772 | 0.28 low | 0.734 high | 0 | cold | — |
| zh-ai-03 | zh | ai | hot | hot | ✓ | 72.43 | 0.083 low | 0.933 high | 0 | cold | — |
| zh-ai-04-lexicon | zh | ai | hot | hot | ✓ | 100 | 0.748 high | 0.894 high | 92.593 | cold | 总而言之, 总的来说, 值得注意的是, 在数字时代 |
| zh-ai-05-formulaic-summary | zh | ai | hot | hot | ✓ | 100 | 0.41 mid | 0.931 high | 105.263 | cold | 综上所述, 值得注意的是, 在数字时代, 从长远来看 |
| zh-ai-06-broad-tech | zh | ai | hot | hot | ✓ | 100 | 0.443 mid | 0.912 high | 90.09 | cold | 总而言之, 需要指出的是, 随着科技的发展, 带来了新的机遇 |
| zh-nat-01 | zh | natural | cold | cold | ✓ | 0 | 0.506 high | 0.875 high | 0 | cold | — |
| zh-nat-02 | zh | natural | cold | cold | ✓ | 0 | 0.528 high | 0.936 high | 0 | cold | — |
| zh-nat-03 | zh | natural | cold | cold | ✓ | 0 | 0.58 high | 0.907 high | 0 | cold | — |
| zh-nat-04-lexicon-cold | zh | natural | cold | cold | ✓ | 0 | 0.387 mid | 0.931 high | 0 | cold | — |
| zh-nat-05-market-note | zh | natural | cold | cold | ✓ | 0 | 0.598 high | 0.891 high | 0 | cold | — |
| zh-nat-06-maintenance-log | zh | natural | cold | cold | ✓ | 0 | 0.549 high | 0.952 high | 0 | cold | — |

## How to read this

- **Hot** means at least one deterministic signal crossed the benchmark threshold: low burstiness CV, low MATTR, AI-lexicon density, or the conservative Korean diagnostic composite.
- **Cold** means the fixture did not cross those thresholds.
- **Signal** is the 0–100 diagnostic strength of the strongest deterministic trigger. It supports ranking diagnostics but does not replace the binary hot/cold regression gate.
- The report is meant for regression tracking and contributor discussion, not for authorship accusation.
- This deterministic corpus is intentionally small (49 fixtures across en, ja, ko, zh); do not treat 100% fixture accuracy as generalization to new models, genres, or edited AI text.
- Confidence intervals use Wilson score intervals for the checked-in fixture set; external threshold sweeps and 2025+ model rebaselines are separate research follow-ups tracked in [2025+ Re-baseline Plan](../research/2025-rebaseline-plan.md).
- Broader methodology notes live in [AI/Human Metrics Research](../research/ai-human-metrics.md) and [Quality Checks](../../tests/quality/README.md).
