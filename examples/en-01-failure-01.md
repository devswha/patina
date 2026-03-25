---
pattern: 1
type: failure
name: Undue Emphasis on Significance
pack: en-content
language: en
---

# Pattern 1 (en): Undue Emphasis on Significance — Failure Case (False Positive)

## Input Text

> On July 20, 1969, Apollo 11 landed on the Moon. It was the first time humans had set foot on another world. The mission fulfilled a goal set by President Kennedy in 1961 and marked a turning point in the Space Race.

## Expected Output

> (No correction — Pattern 1 should not fire on this text)

## Applied Pattern

- Pattern 1 (Undue Emphasis on Significance): "turning point" appears once.

## Judgment

**Failure (false positive)** — "Turning point" appears once, but the exclusion condition applies: this describes a genuine large-scale historical event where the emphasis is proportionate to actual impact. The Apollo 11 Moon landing is an event whose historical significance is widely documented and undisputed. Pattern 1 targets AI inflating the importance of *ordinary* topics with superlatives. A single measured phrase ("turning point") applied to the first crewed Moon landing is not AI inflation — it is accurate description. Firing here would overcorrect factual historical writing.
