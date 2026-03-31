---
pattern: 5
type: failure
name: Vague Attributions
pack: en-content
language: en
---

# Pattern 5 (en): Vague Attributions — Failure Case (False Positive)

## Input Text

> Parents generally know when their child has a fever — the forehead feels hot, the child is lethargic, and a thermometer reading above 38°C confirms it. Pediatricians advise giving fluids and monitoring for 24 hours before seeking further care, unless the child is under three months old or the fever exceeds 40°C.

## Expected Output

> (No correction — Pattern 5 should not fire on this text)

## Applied Pattern

- Pattern 5 (Vague Attributions): "Parents generally know" and "pediatricians advise" are technically unspecified attributions — no individual doctor or study is named.

## Judgment

**Failure (false positive)** — The exclusion condition covers "well-established consensus facts with no reasonable controversy." Fever management for children is textbook pediatric guidance available in any standard reference (AAP, NHS). The text supplements the generic attribution with specific, falsifiable clinical thresholds: 38°C, 24 hours, under three months, 40°C. These specifics make the advice verifiable without citing a named source. Requiring a citation for "give fluids when your kid has a fever" would be absurd. This is practical health communication, not the pattern of invoking phantom experts to support speculative claims.
