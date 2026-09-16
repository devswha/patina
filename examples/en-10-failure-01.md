---
pattern: 10
type: failure
name: Rule of Three Overuse
pack: en-language
language: en
---

# Pattern 10 (en): Rule of Three Overuse — Failure Case (False Positive)

## Input Text

> The experiment has three phases: setup, measurement, and analysis. During setup, the team calibrates sensors and verifies ambient conditions. Measurement runs for 48 hours continuously, and analysis typically takes another two weeks as the data passes through three independent review stages.

## Expected Output

> (No correction — Pattern 10 should not fire on this text)

## Applied Pattern

- Pattern 10 (Rule of Three Overuse): "setup, measurement, and analysis" is a three-item list.

## Judgment

**Failure (false positive)** — This is a genuine three-part process (setup, measurement, and analysis), the same class as classification/segmentation/detection or input/process/output. The count is not rhetorical; two or four phases would misstate the method. The triad appears once. Pattern 10 fires only on rhetorical triples that could equally be two or four, and only when they appear 2+ times.
