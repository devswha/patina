---
pattern: 8
type: failure
name: Copula Avoidance
pack: en-language
---

# Pattern 8: Copula Avoidance — Failure (False Positive)

## Input Text

> Under the new governance charter, the ethics committee serves as an independent advisory board to the CEO. It reviews all proposed acquisitions above $50 million and can issue binding recommendations on conflicts of interest.

## Expected Output

> (No correction — this text should not trigger Pattern 8)

## Applied Pattern

- Pattern 8 (Copula Avoidance): "serves as" appears once, describing the committee's function.

## Verdict

**Failure (false positive)** — The exclusion condition applies: "serves as" is acceptable when the subject has a formally designated role function. The ethics committee has an institutional role defined by a governance charter — "serves as an independent advisory board" describes a formal designation, not a decorative usage. The sentence also appears only once in the paragraph, not meeting the 2+ threshold. Replacing it with "is" would lose the nuance that the board's advisory role is an assigned institutional function.
