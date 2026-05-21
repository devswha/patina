# KatFish Korean Calibration

| field | value |
|---|---:|
| Generated at | 2026-05-21T16:25:42.849Z |
| KatFish input | `artifacts/rebaseline-2025/private/katfish` |
| Human-control input | `artifacts/rebaseline-2025/private/web-human-controls.generated.private.jsonl` |
| KatFish rows | 2094 |
| Public-web human-control rows | 250 |
| Raw text committed | 0 |

This report is aggregate-only. KatFish rows and public-web extracts stay in ignored private files because the external dataset and source pages have not been relicensed into this repository.

## Headline

| metric | value |
|---|---:|
| KatFish catch rate, Patina without KO diagnostics | 58.9% |
| KatFish catch rate, Patina current | 74.8% |
| Delta | +15.9 pp |
| Public-web human-control FP delta | +0.0 pp (0 rows) |

## KatFish metrics

| mode | n | accuracy | precision | recall / catch | F1 | FP rate | TP/FP/FN/TN |
|---|---:|---:|---:|---:|---:|---:|---:|
| burstiness_mattr_only | 2094 | 58.3% | 87.5% | 53.9% | 0.667 | 26.6% | 875/125/749/345 |
| patina_without_ko_diagnostics | 2094 | 61.6% | 87.5% | 58.9% | 0.704 | 29.1% | 957/137/667/333 |
| patina_current | 2094 | 69.8% | 84.4% | 74.8% | 0.793 | 47.7% | 1215/224/409/246 |

## Public-web Korean human controls

| mode | n | accuracy | precision | recall / catch | F1 | FP rate | TP/FP/FN/TN |
|---|---:|---:|---:|---:|---:|---:|---:|
| burstiness_mattr_only | 250 | 87.2% | 0.0% | 0.0% | 0.000 | 12.8% | 0/32/0/218 |
| patina_without_ko_diagnostics | 250 | 83.2% | 0.0% | 0.0% | 0.000 | 16.8% | 0/42/0/208 |
| patina_current | 250 | 83.2% | 0.0% | 0.0% | 0.000 | 16.8% | 0/42/0/208 |

## KatFish by genre

| genre | mode | n | recall / catch | FP rate | TP/FP/FN/TN |
|---|---|---:|---:|---:|---:|
| abstract | burstiness_mattr_only | 378 | 61.5% | 53.0% | 171/53/107/47 |
| abstract | patina_without_ko_diagnostics | 378 | 66.5% | 58.0% | 185/58/93/42 |
| abstract | patina_current | 378 | 71.6% | 67.0% | 199/67/79/33 |
| essay | burstiness_mattr_only | 771 | 35.6% | 8.8% | 210/16/380/165 |
| essay | patina_without_ko_diagnostics | 771 | 47.1% | 12.7% | 278/23/312/158 |
| essay | patina_current | 771 | 80.3% | 45.3% | 474/82/116/99 |
| poetry | burstiness_mattr_only | 945 | 65.3% | 29.6% | 494/56/262/133 |
| poetry | patina_without_ko_diagnostics | 945 | 65.3% | 29.6% | 494/56/262/133 |
| poetry | patina_current | 945 | 71.7% | 39.7% | 542/75/214/114 |

## Public-web controls by register

| register | mode | n | recall / catch | FP rate | TP/FP/FN/TN |
|---|---|---:|---:|---:|---:|
| academic-summary | burstiness_mattr_only | 50 | 0.0% | 4.0% | 0/2/0/48 |
| academic-summary | patina_without_ko_diagnostics | 50 | 0.0% | 14.0% | 0/7/0/43 |
| academic-summary | patina_current | 50 | 0.0% | 14.0% | 0/7/0/43 |
| blog | burstiness_mattr_only | 50 | 0.0% | 20.0% | 0/10/0/40 |
| blog | patina_without_ko_diagnostics | 50 | 0.0% | 20.0% | 0/10/0/40 |
| blog | patina_current | 50 | 0.0% | 20.0% | 0/10/0/40 |
| chat-update | burstiness_mattr_only | 50 | 0.0% | 0.0% | 0/0/0/50 |
| chat-update | patina_without_ko_diagnostics | 50 | 0.0% | 4.0% | 0/2/0/48 |
| chat-update | patina_current | 50 | 0.0% | 4.0% | 0/2/0/48 |
| product-doc | burstiness_mattr_only | 50 | 0.0% | 12.0% | 0/6/0/44 |
| product-doc | patina_without_ko_diagnostics | 50 | 0.0% | 12.0% | 0/6/0/44 |
| product-doc | patina_current | 50 | 0.0% | 12.0% | 0/6/0/44 |
| technical-how-to | burstiness_mattr_only | 50 | 0.0% | 28.0% | 0/14/0/36 |
| technical-how-to | patina_without_ko_diagnostics | 50 | 0.0% | 34.0% | 0/17/0/33 |
| technical-how-to | patina_current | 50 | 0.0% | 34.0% | 0/17/0/33 |

## Interpretation

- The KO diagnostics layer is evaluated against `patina_without_ko_diagnostics`, so the delta isolates the spacing/comma/suffix proxy path from existing lexicon behavior.
- The human-control non-regression gate uses the 250-row hash-only public-web Korean control set from #157.
- KatFish human rows are reported in the KatFish table as an OOD caveat; do not turn this binary catch-rate report into an authorship or public AUROC claim.
