# Deterministic document-verdict recalibration (research lane)

Executes the operator-approved task from tower decision #153 ② (2026-07-13):
the deterministic prose-score's document-level BINARY verdict was measured at
0.55 accuracy on the leakage-free calibration corpus
(`2026-judge-calibration.md`) — while its continuous score separates at
AUC 0.98. The binary rule, not the score, was broken.

## What was wrong

The implicit document verdict used until now — "any hot paragraph ⇒ AI" —
fires on nearly every long document (human docs usually contain at least one
paragraph that trips a paragraph-level signal) and is uncalibrated at
document length. Measured on the 44-document calibration corpus:
accuracy **0.545** (worse than useless given the score's separation).

## Calibration (2026-07-14, on the judge-calibration corpus, n=44)

Document verdict = `score ≥ T` (prose-score `score` = hot-paragraph ratio
× 100, lang ko):

| T | accuracy | TPR | FPR |
|---:|---:|---:|---:|
| 25 | 0.886 | 0.96 | 0.20 |
| 30 | 0.932 | 0.96 | 0.10 |
| **35** | **0.955** | 0.96 | 0.05 |
| 40 | 0.932 | 0.88 | **0.00** |
| 45 | 0.909 | 0.83 | 0.00 |

## Adopted rule (research lane only)

- **judge-det document verdict: `score ≥ 35`** (balanced operating point);
  a zero-FP posture may use 40 where false positives are costlier.
- Scope: the panel-v2 det lane (`2026-panel-v2-design.md`) — this lifts that
  design's prohibition on det binary verdicts once the caveat below is met.
- **NOT adopted for the product surface**: `analyzeText`'s paragraph-level
  hot logic, the public benchmark, and CLI score output are untouched.
  Changing those shifts published headline claims and requires its own
  validation run plus an operator decision.

## Honest caveats

- The threshold was selected on the same 44-document corpus it is evaluated
  on (optimistic by construction), and that corpus is pure generations at
  document length, KO only. **Revalidation rule (binding):** before det
  binary verdicts are used in any study's reported outcome, the T=35 rule
  must hold ≥ 0.85 accuracy on that study's own fresh corpus or the verdict
  column is dropped for that study. Continuous-score lanes are unaffected.
- Coincidence note: T=35 sits near the repo's prose gate (30) but is a
  different quantity (verdict threshold vs editing-gate); no coupling.
