---
pattern: 32
type: failure
name: Comparison Adverb Overuse
pack: en-language
language: en
---

# Pattern 32 (en): Comparison Adverb Overuse — Failure Case (False Positive)

## Input Text

> The new route is more efficient than the old route: average travel time fell from 42 minutes to 31 minutes over the last 20 test runs. It is also more reliable in heavy rain, with missed pickups dropping from 7% to 2%.

## Expected Output

> (No correction — Pattern 32 should not fire on this text)

## Applied Pattern

- Pattern 32 (Comparison Adverb Overuse): "more efficient" and "more reliable" appear in the same paragraph.

## Judgment

**Failure (false positive)** — Both comparative phrases have explicit baselines and metrics. "More efficient than the old route" names the comparison target and gives measured travel times. "More reliable in heavy rain" is followed by a missed-pickup rate change. Rewriting these away would remove useful evidence rather than reducing AI-like padding.
