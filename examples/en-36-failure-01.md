---
pattern: 36
type: failure
name: Faux-Insight Setup
pack: en-filler
language: en
---

# Pattern 36: Faux-Insight Setup — Failure (False Positive)

## Input Text

> Most people don't realize that the 1976 Copyright Act already covers this case. The common belief, repeated in three of the five textbooks on my shelf, is that pre-1978 sound recordings fall outside federal protection entirely. Section 301(c) says otherwise: state-law protection continues until 2067, and the CLASSICS Act of 2018 layered federal digital-performance rights on top.

## Expected Output

> (No correction — this text should not trigger Pattern 36)

## Applied Pattern

- Pattern 36 (Faux-Insight Setup): "Most people don't realize" opens the passage.

## Judgment

**Failure (false positive)** — The exclusion condition applies: the piece documents what the common view is (naming where it appears), then rebuts it with specific statutory citations. The setup is doing real argumentative work — identifying a genuinely widespread misreading before correcting it with evidence — not flattering the writer as a lone insider.
