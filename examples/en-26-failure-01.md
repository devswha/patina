---
pattern: 26
type: failure
name: Passive Nominalization Chains
pack: en-structure
---

# Pattern 26: Passive Nominalization Chains — Failure (False Positive)

## Input Text

> Samples were collected from six sites along the river between April and October 2024. Dissolved oxygen levels were measured using a YSI ProDSS multiparameter probe. Nutrient concentrations were determined via ion chromatography at the university's analytical lab.

## Expected Output

> (No correction — this text should not trigger Pattern 26)

## Applied Pattern

- Pattern 26 (Passive Nominalization Chains): Three passive constructions — "were collected," "were measured," and "were determined" — appear in the same paragraph.

## Verdict

**Failure (false positive)** — The exclusion condition applies: scientific methods sections are explicitly excluded because passive voice is a disciplinary norm in experimental methodology. Passive construction in a methods section keeps the focus on the procedure rather than the researcher, which is the accepted convention. Additionally, the actor is appropriately omitted — what matters is *how* the measurements were taken, not *who* held the probe. Firing here would impose a stylistic correction that conflicts with scientific writing standards.
