---
pattern: 28
type: failure
name: Stacked Subordinate Clauses
pack: en-structure
language: en
---

# Pattern 28 (en): Stacked Subordinate Clauses — Failure Case (False Positive)

## Input Text

> A method for processing data, comprising: receiving, by a processor configured to execute machine-readable instructions stored in a non-transitory computer-readable medium, a plurality of input signals; transforming, by the processor, the plurality of input signals into a normalized data structure according to a predefined schema; and outputting, by the processor, the normalized data structure to a connected display device.

## Expected Output

> (No correction — Pattern 28 should not fire on this text)

## Applied Pattern

- Pattern 28 (Stacked Subordinate Clauses): The sentence contains 4+ embedded participial phrases and appositives — "by a processor configured to execute machine-readable instructions stored in a non-transitory computer-readable medium" nests three levels deep, and the overall claim requires parsing 8 commas before reaching the final element.

## Verdict

**Failure (false positive)** — The exclusion condition applies: technical specifications and legal definitions where nested qualification is non-negotiable are explicitly excluded. This is a patent claim written in standard claim format required by patent offices worldwide. The nested structure ("by a processor configured to execute... stored in...") is not an AI artifact — it is the legally mandated way to define the scope of a patent claim. Each qualifying phrase narrows the claim's coverage; removing or splitting them would alter the claim's legal scope and potentially invalidate it. Patent examiners and attorneys expect exactly this structure, and simplifying it would make the claim either broader than intended (risking rejection) or ambiguous (risking litigation).
