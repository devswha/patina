---
pattern: 34
type: failure
name: False Agency (Inanimate Actors)
pack: en-language
language: en
---

# Pattern 34: False Agency — Failure (false positive)

## Input Text

> The study finds a significant correlation between sleep debt and error rates. The data show the effect holds across all three cohorts. Meanwhile the linter flags unused imports automatically, and the pipeline retries failed jobs up to three times. The deadline passed before the team could add a fourth cohort.

## Expected Output

> (No rewrite — pattern 34 must not fire on this text)

## Judgment Rationale

- "The study finds", "the data show" — academic citation conventions (metonymy for the authors), excluded.
- "The linter flags", "the pipeline retries" — software doing what software actually does, excluded.
- "The deadline passed" — a genuinely agentless event.
- Multiple inanimate subjects, but every one falls under an exclusion; firing here would wreck standard technical register.
