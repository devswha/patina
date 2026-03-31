---
pattern: 23
type: failure
name: Excessive Hedging
pack: en-filler
language: en
---

# Pattern 23 (en): Excessive Hedging — Failure Case (False Positive)

## Input Text

> This treatment may reduce symptoms in patients with moderate-to-severe cases, though larger trials are needed to confirm the effect size. The Phase II data showed a 22% improvement over placebo in a 120-patient cohort. Regulatory agencies will likely require a Phase III trial with at least 500 participants before considering approval.

## Expected Output

> (No correction — Pattern 23 should not fire on this text)

## Applied Pattern

- Pattern 23 (Excessive Hedging): "may reduce symptoms" and "needed to confirm" appear to hedge the central claim.

## Judgment

**Failure (false positive)** — The exclusion condition applies: a single hedge ("may reduce") on a genuinely uncertain claim backed by preliminary evidence is appropriate, not excessive. The Phase II trial had only 120 patients, so "may" accurately reflects the strength of the evidence. The sentence immediately follows with a concrete data point (22% improvement, 120-patient cohort) and a specific regulatory expectation (Phase III, 500+ participants). There is no stacking of qualifiers — each sentence makes a clear, falsifiable statement. This is calibrated scientific language, not AI-style hedge piling.
