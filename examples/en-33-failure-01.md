---
pattern: 33
type: failure
name: Definitional-Metaphor Equation
pack: en-language
language: en
---

# Pattern 33 (en): Definitional-Metaphor Equation — Failure Case (False Positive)

## Input Text

> This API is the heart of the authentication flow: every request passes through it, and it handled 300 million token checks last month.

## Expected Output

> (No correction — Pattern 33 should not fire on this text)

## Applied Pattern

- Pattern 33 (Definitional-Metaphor Equation): one metaphor-equation (`is the heart of`) appears once.

## Judgment

**Failure (false positive)** — A single instance is below the 2+ rewrite gate, and the sentence immediately supplies concrete support (every request passes through it; 300 million token checks last month). This is a technical importance claim with evidence, not a free-floating pseudo-profound equation.
