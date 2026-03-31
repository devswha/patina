---
pattern: 10
type: failure
name: Rule of Three Overuse
pack: en-language
language: en
---

# Pattern 10 (en): Rule of Three Overuse — Failure Case (False Positive)

## Input Text

> Color mixing starts with three primaries: red, yellow, and blue. From those three, you get three secondaries: orange, green, and purple. Every other hue is a blend of a primary and an adjacent secondary. That is why a basic paint set ships with six tubes, not twelve.

## Expected Output

> (No correction — Pattern 10 should not fire on this text)

## Applied Pattern

- Pattern 10 (Rule of Three Overuse): Two three-item lists appear ("red, yellow, and blue" and "orange, green, and purple"), matching the surface frequency condition of 2+ triple-item lists in one document.

## Judgment

**Failure (false positive)** — The exclusion covers "naturally occurring triads in genuinely three-part processes." Primary colors and secondary colors are each exactly three — this is a fact of subtractive color theory, not an editorial choice. Listing only two primaries or adding a fourth would be factually wrong. The author even uses the triple structure to derive a concrete implication (six tubes, not twelve), showing the count is doing analytical work. This is pedagogical precision, not the decorative rhythm of AI triples.
