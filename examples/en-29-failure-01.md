---
pattern: 29
type: failure
name: False Nuance (Retroactive Reframing)
pack: en-communication
language: en
---

# Pattern 29 (en): False Nuance (Retroactive Reframing) — Failure Case (False Positive)

## Input Text

> A four-day workweek raises employee satisfaction. To be more precise, the effect splits by role: in measurable jobs like call centers, Microsoft Japan's trial reported a 40% productivity gain, but in coverage-critical roles like ER nursing, the remaining staff simply absorbed the missing shifts and burned out faster.

## Expected Output

> (No correction — Pattern 29 should not fire on this text)

## Applied Pattern

- Pattern 29 (False Nuance): The first claim is followed by the watch phrase "To be more precise," which on the surface looks like a retroactive reframing.

## Judgment

**Failure (false positive)** — The exclusion condition applies: the reframe introduces a substantive correction and cites new evidence. "The effect splits by role" genuinely qualifies the opening generalization, and the sentence then supplies concrete evidence and a counterexample — Microsoft Japan's 40% gain versus ER nurses absorbing missing shifts. The conclusion shifts from "raises satisfaction" to "depends on the role," a real analytical pivot. This is not the same statement restated in different words; it is the claim being sharpened by new data, so the "nuance" here is genuine, not cosmetic.
