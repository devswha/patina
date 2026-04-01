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

**Failure (false positive)** — The exclusion condition applies: this is a naturally occurring triad describing a genuinely three-part process. The experiment literally has three sequential phases, explicitly stated ("three phases"), and each phase is described with distinct concrete details — sensor calibration, 48-hour continuous run, two-week review period. The count is not arbitrary; removing or adding a phase would misrepresent the actual procedure. The triple appears only once in the passage, and no other triple-item lists are present. This is a factual description of methodology, not a rhythmic rhetorical device.
