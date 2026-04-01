---
pattern: 27
type: failure
name: Zombie Nouns (Excessive Nominalization)
pack: en-structure
language: en
---

# Pattern 27 (en): Zombie Nouns (Excessive Nominalization) — Failure Case (False Positive)

## Input Text

> The court's decision in Smith v. Jones established that an investigation by a licensed professional is required before any recommendation can be issued under Section 12(b). The statute defines "investigation" as a formal inquiry conducted pursuant to regulatory guidelines, and "recommendation" as a written determination of compliance status. Failure to obtain such a determination prior to enforcement action constitutes a procedural violation under the Administrative Procedure Act.

## Expected Output

> (No correction — Pattern 27 should not fire on this text)

## Applied Pattern

- Pattern 27 (Zombie Nouns): Three nominalized forms — "decision," "investigation," and "recommendation" — appear in the same paragraph, superficially matching the 3+ threshold.

## Judgment

**Failure (false positive)** — The exclusion condition applies: noun forms that carry meaning unavailable in the verb are explicitly excluded, as are legal contexts where nominalized forms have specific technical definitions. Here, "decision" refers to a binding judicial ruling — not the act of deciding. "Investigation" is a defined statutory term meaning a formal inquiry under regulatory guidelines, distinct from the general verb "investigate." "Recommendation" is a legal instrument — a written determination of compliance status — not a suggestion. Converting these to verbs would lose their precise legal meanings and potentially alter the interpretation of the statute.
