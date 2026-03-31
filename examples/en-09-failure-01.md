---
pattern: 9
type: failure
name: Negative Parallelisms
pack: en-language
language: en
---

# Pattern 9 (en): Negative Parallelisms — Failure Case (False Positive)

## Input Text

> The label says "100% juice," but the FDA allows that claim even when the product is reconstituted from concentrate. The sweetness comes not from added sugar but from apple juice concentrate, which has roughly the same sugar density as Coca-Cola. Calling it a health drink is not accurate — it is a flavored sugar delivery system with a vitamin label.

## Expected Output

> (No correction — Pattern 9 should not fire on this text)

## Applied Pattern

- Pattern 9 (Negative Parallelisms): Three "not/but" constructions appear: the label claim vs. FDA reality, "not from added sugar but from apple juice concentrate", and "not accurate — it is a flavored sugar delivery system." These match the surface syntax of the pattern.

## Judgment

**Failure (false positive)** — The exclusion covers "genuine contrastive clarification correcting a misconception." All three contrasts here do real epistemic work: the first exposes a misleading label claim, the second corrects a consumer assumption about sugar sourcing, and the third reframes a marketing term. Removing any of the negative framing would weaken the argument — "the sweetness comes from apple juice concentrate" is less informative than explicitly contrasting it with "added sugar," which is what consumers are checking for. These are investigative contrasts with factual stakes, not decorative "not just X but Y" inflation.
