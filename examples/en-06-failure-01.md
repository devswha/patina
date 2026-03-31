---
pattern: 6
type: failure
name: Formulaic "Challenges and Prospects"
pack: en-content
language: en
---

# Pattern 6 (en): Formulaic "Challenges and Prospects" — Failure Case (False Positive)

## Input Text

> Scaling the team is the hardest part. We hired 12 engineers in Q1 but lost four to competing offers before they started. Our retention fix — a $15K signing bonus with a one-year cliff — cut renege rates from 33% to 8% in Q2. If headcount stays flat through Q3, we push the API launch to January.

## Expected Output

> (No correction — Pattern 6 should not fire on this text)

## Applied Pattern

- Pattern 6 (Formulaic "Challenges and Prospects"): The text acknowledges a challenge (hiring difficulty) and mentions a positive outcome (lower renege rates) followed by a conditional future statement, which could superficially echo the challenges-then-prospects formula.

## Judgment

**Failure (false positive)** — The exclusion requires both poles to be vague to trigger. Here, every element is concrete: a named challenge (losing hires to competing offers), a quantified problem (4 of 12, 33% renege rate), a specific countermeasure ($15K bonus with one-year cliff), a measured result (down to 8% in Q2), and a conditional deadline (API launch pushed to January if headcount stays flat). The passage has the surface shape of "challenge → response → outlook" but none of the vagueness that defines the AI formula. The conditional statement is an operational plan with a named product and a calendar quarter, not "a bright future lies ahead."
