# Rebaseline Low-FPR Report (measure-only)

Report-only TPR at fixed false-positive budgets, by language and language×register.
**Not a detector-threshold change and not a CI gate.** A `no_calibration_signal_yet`
status means the corpus is too easy to expose an FP/FN trade-off, which is a valid
honest outcome.

- Generated at: 2026-06-14T14:07:13.283Z
- Node: v22.17.1
- Input manifest: artifacts/rebaseline-2025/manifest.ko.scored.public.jsonl
- Score field: `patina_score`
- Rows: 380
- Targets: 1.0%, 5.0%
- Reproduce: `npm run benchmark:rebaseline:low-fpr -- --input <manifest> [--basename <name>]`

## Overall

| scope | target FPR | n | pos | neg | max FP | actual FPR | TPR | status |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| overall | 1.0% | 380 | 130 | 250 | 2 | 0.0% | 0.0% | supported |
| overall | 5.0% | 380 | 130 | 250 | 12 | 0.0% | 0.0% | supported |

## By language

### language

| scope | target FPR | n | pos | neg | max FP | actual FPR | TPR | status |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| ko | 1.0% | 380 | 130 | 250 | 2 | 0.0% | 0.0% | supported |
| ko | 5.0% | 380 | 130 | 250 | 12 | 0.0% | 0.0% | supported |

## By language × register

### language × register

| scope | target FPR | n | pos | neg | max FP | actual FPR | TPR | status |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| ko × academic-summary | 1.0% | 76 | 26 | 50 | 0 | 0.0% | 0.0% | insufficient_negatives_for_1pct |
| ko × academic-summary | 5.0% | 76 | 26 | 50 | 2 | 0.0% | 0.0% | supported |
| ko × blog | 1.0% | 76 | 26 | 50 | 0 | 0.0% | 0.0% | insufficient_negatives_for_1pct |
| ko × blog | 5.0% | 76 | 26 | 50 | 2 | 0.0% | 0.0% | supported |
| ko × chat-update | 1.0% | 76 | 26 | 50 | 0 | 0.0% | 0.0% | insufficient_negatives_for_1pct |
| ko × chat-update | 5.0% | 76 | 26 | 50 | 2 | 2.0% | 30.8% | supported |
| ko × product-doc | 1.0% | 76 | 26 | 50 | 0 | 0.0% | 0.0% | insufficient_negatives_for_1pct |
| ko × product-doc | 5.0% | 76 | 26 | 50 | 2 | 0.0% | 0.0% | supported |
| ko × technical-how-to | 1.0% | 76 | 26 | 50 | 0 | 0.0% | 0.0% | insufficient_negatives_for_1pct |
| ko × technical-how-to | 5.0% | 76 | 26 | 50 | 2 | 0.0% | 0.0% | supported |
