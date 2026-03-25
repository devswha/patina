---
pattern: 7
type: failure
name: AI Vocabulary Words
pack: en-language
language: en
---

# Pattern 7 (en): AI Vocabulary Words — Failure Case (False Positive)

## Input Text

> The 2024 study followed 1,200 participants across six cities over 18 months. Researchers found that robust community support networks reduced hospital readmission rates by 14%. The result was consistent across urban and rural cohorts.

## Expected Output

> (No correction — Pattern 7 should not fire on this text)

## Applied Pattern

- Pattern 7 (AI Vocabulary Words): "robust" appears once.

## Judgment

**Failure (false positive)** — "Robust" appears once in a data-dense empirical summary. The fire condition requires 3+ watch words in a single paragraph. With only one watch-list word and the rest of the text consisting of specific numbers (1,200 participants, six cities, 18 months, 14% reduction), this passage reads as human research writing. "Robust" is a standard adjective in quantitative research to describe statistically stable findings. Flagging it in isolation, surrounded by concrete evidence, would be a false positive. Pattern 7 fires on clusters, not on single legitimate uses.
