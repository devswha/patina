---
pattern: 11
type: failure
name: Elegant Variation (Synonym Cycling)
pack: en-language
language: en
---

# Pattern 11 (en): Elegant Variation (Synonym Cycling) — Failure Case (False Positive)

## Input Text

> The patient presented with chest pain at 2:14 a.m. The 58-year-old male had a history of hypertension and type 2 diabetes. The emergency department attending ordered a troponin panel and 12-lead ECG within six minutes of the patient's arrival. Mr. Hernandez was transferred to the catheterization lab at 3:01 a.m.

## Expected Output

> (No correction — Pattern 11 should not fire on this text)

## Applied Pattern

- Pattern 11 (Elegant Variation): The same person is called "the patient", "the 58-year-old male", "the patient's" (possessive), and "Mr. Hernandez" — four referents that could look like synonym cycling.

## Judgment

**Failure (false positive)** — The exclusion covers "legitimate disambiguation" where each name adds precision. In a clinical narrative, the four terms serve distinct functions: "the patient" is the standard intake reference, "the 58-year-old male" conveys medically relevant demographics (age, sex), the possessive "the patient's arrival" anchors a timeline, and "Mr. Hernandez" re-identifies the person by legal name at the point of a formal care transition (cath lab transfer). Medical writing conventions require this layered identification for clarity and legal documentation. Collapsing them all into "Mr. Hernandez" would lose clinical demographic context; using only "the patient" would obscure identity at handoff. This is functional clinical writing, not decorative variation.
