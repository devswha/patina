---
pattern: 9
type: failure
name: Negative Parallelisms
pack: en-language
language: en
---

# Pattern 9 (en): Negative Parallelisms — Failure Case (False Positive)

## Input Text

> The event is not a conference but a workshop — no keynotes, only hands-on sessions lasting 90 minutes each. Attendees work in groups of five on a single design problem chosen by the facilitator. Last year, 80% of participants said the format was more useful than traditional conference talks.

## Expected Output

> (No correction — Pattern 9 should not fire on this text)

## Applied Pattern

- Pattern 9 (Negative Parallelisms): "not a conference but a workshop" appears once.

## Judgment

**Failure (false positive)** — The exclusion condition applies: this is a genuine contrastive clarification correcting a specific misconception. The sentence distinguishes a workshop from a conference and immediately explains the concrete difference — no keynotes, hands-on sessions only, 90-minute length. The negative frame is doing real informational work: people who expect a conference format (keynote talks, passive audience) need to know this event operates differently. Only one instance appears, below the 2+ threshold, and the rest of the paragraph is packed with specifics (group size, facilitator role, 80% satisfaction figure). Flagging this would strip a useful distinction.
