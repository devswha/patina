# Adversarial MPS audit

This report checks whether a rewrite can preserve explicit meaning anchors while still looking AI-like. It is a repo-owned adversarial fixture set, not a public model-performance claim.

Fixture source: `tests/quality/adversarial-mps/fixtures.jsonl`

## Summary

- Fixtures: 10
- Passing adversarial cases: 10/10
- Minimum anchor-MPS proxy: 100.0
- Minimum deterministic AI score: 100.0
- Gate: MPS proxy ≥90 and deterministic AI score ≥60.

## Results

| id | lang | register | MPS proxy | AI score | hot paragraphs | status |
|---|---|---|---:|---:|---:|---|
| adv-mps-ko-01 | ko | marketing | 100.0 | 100.0 | 1/1 | pass |
| adv-mps-ko-02 | ko | technical | 100.0 | 100.0 | 1/1 | pass |
| adv-mps-ko-03 | ko | academic | 100.0 | 100.0 | 1/1 | pass |
| adv-mps-ko-04 | ko | product-doc | 100.0 | 100.0 | 1/1 | pass |
| adv-mps-ko-05 | ko | policy | 100.0 | 100.0 | 1/1 | pass |
| adv-mps-en-01 | en | marketing | 100.0 | 100.0 | 1/1 | pass |
| adv-mps-en-02 | en | technical | 100.0 | 100.0 | 1/1 | pass |
| adv-mps-en-03 | en | academic | 100.0 | 100.0 | 1/1 | pass |
| adv-mps-en-04 | en | support | 100.0 | 100.0 | 1/1 | pass |
| adv-mps-en-05 | en | strategy | 100.0 | 100.0 | 1/1 | pass |

## Interpretation

The audit confirms the known gap: an anchor-preservation floor can pass text that still retains AI-marker density. MPS should remain a meaning-safety floor, not a humanness score. A complementary anti-gaming check should penalize repeated AI-marker recurrence after rewrite, especially when MPS is high.

## Proposed MPS-v2 companion check

Keep MPS unchanged for semantic safety, then add an independent recurrence gate:

1. Score the original and rewritten text with deterministic `analyzeText`.
2. If `MPS ≥ 90` and rewritten AI score remains `≥ 60`, mark the candidate as `style_not_improved`.
3. In Ouroboros selection, prefer candidates that pass MPS and lower the AI score; do not let high MPS alone rescue a visibly AI-like rewrite.
4. Report preserved anchors and recurring AI markers separately so users can decide whether to edit more or keep the register.
