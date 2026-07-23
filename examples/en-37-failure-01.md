---
pattern: 37
type: failure
name: Colon Reveal / Plot-Twist Setup
pack: en-style
language: en
---

# Pattern 37: Colon Reveal / Plot-Twist Setup — Failure (False Positive)

## Input Text

> The report covers three risks: currency exposure, supplier concentration, and regulatory drift. Definition: supplier concentration means more than 40% of components sourced from a single vendor. Recommended reading: the 2022 OECD supply-chain review.

## Expected Output

> (No correction — this text should not trigger Pattern 37)

## Applied Pattern

- Pattern 37 (Colon Reveal / Plot-Twist Setup): Three colons appear in three consecutive sentences.

## Judgment

**Failure (false positive)** — The exclusion condition applies: every colon here is structural. The first introduces a list, the second marks an explicit definition, and the third is a label pointing at a reference. None stages a dramatic reveal; removing them would damage the document's reference formatting rather than fix a rhythm problem.
