---
pattern: 2
type: failure
name: Undue Emphasis on Notability/Media
pack: en-content
language: en
---

# Pattern 2 (en): Undue Emphasis on Notability/Media — Failure Case (False Positive)

## Input Text

> The documentary premiered at Sundance in January 2024 and won the Grand Jury Prize. A24 acquired distribution rights the following week. It opened in 300 theaters on March 8 and earned $4.2 million in its first weekend, roughly twice the studio's projection.

## Expected Output

> (No correction — Pattern 2 should not fire on this text)

## Applied Pattern

- Pattern 2 (Undue Emphasis on Notability/Media): Mentions a major film festival (Sundance) and a well-known studio (A24), which could superficially resemble unsourced prestige claims.

## Judgment

**Failure (false positive)** — Every notability claim here is verifiable and specific: a named festival (Sundance), a named prize (Grand Jury Prize), a named distributor (A24), exact dates (January 2024, March 8), a theater count (300), and an opening-weekend figure ($4.2 million). The text is not making vague claims of attention — it is reporting discrete, fact-checkable events in chronological order. The exclusion condition requires specificity, and this passage provides it at every turn. Firing Pattern 2 would penalize factual entertainment reporting.
