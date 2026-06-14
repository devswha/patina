# Rebaseline Low-FPR Report (measure-only)

Report-only TPR at fixed false-positive budgets, by language and language×register.
**Not a detector-threshold change and not a CI gate.** A `no_calibration_signal_yet`
status means the corpus is too easy to expose an FP/FN trade-off, which is a valid
honest outcome.

- Generated at: 2026-06-14T12:20:56.462Z
- Node: v22.17.1
- Input manifest: artifacts/rebaseline-2025/manifest.en.scored.public.jsonl
- Score field: `patina_score`
- Rows: 330
- Targets: 1.0%, 5.0%
- Reproduce: `npm run benchmark:rebaseline:low-fpr -- --input <manifest> [--basename <name>]`

## Overall

| scope | target FPR | n | pos | neg | max FP | actual FPR | TPR | status |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| overall | 1.0% | 330 | 130 | 200 | 2 | 0.0% | 0.0% | supported |
| overall | 5.0% | 330 | 130 | 200 | 10 | 0.0% | 0.0% | supported |

## By language

### language

| scope | target FPR | n | pos | neg | max FP | actual FPR | TPR | status |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| en | 1.0% | 330 | 130 | 200 | 2 | 0.0% | 0.0% | supported |
| en | 5.0% | 330 | 130 | 200 | 10 | 0.0% | 0.0% | supported |

## By language × register

### language × register

| scope | target FPR | n | pos | neg | max FP | actual FPR | TPR | status |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| en × academic-summary | 1.0% | 126 | 26 | 100 | 1 | 0.0% | 0.0% | supported |
| en × academic-summary | 5.0% | 126 | 26 | 100 | 5 | 0.0% | 0.0% | supported |
| en × blog | 1.0% | 126 | 26 | 100 | 1 | 0.0% | 0.0% | supported |
| en × blog | 5.0% | 126 | 26 | 100 | 5 | 5.0% | 88.5% | supported |
| en × chat-update | 1.0% | 26 | 26 | 0 | 0 | n/a | n/a | no_negatives |
| en × chat-update | 5.0% | 26 | 26 | 0 | 0 | n/a | n/a | no_negatives |
| en × product-doc | 1.0% | 26 | 26 | 0 | 0 | n/a | n/a | no_negatives |
| en × product-doc | 5.0% | 26 | 26 | 0 | 0 | n/a | n/a | no_negatives |
| en × technical-how-to | 1.0% | 26 | 26 | 0 | 0 | n/a | n/a | no_negatives |
| en × technical-how-to | 5.0% | 26 | 26 | 0 | 0 | n/a | n/a | no_negatives |
