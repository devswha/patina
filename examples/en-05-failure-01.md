---
pattern: 5
type: failure
name: Vague Attributions
pack: en-content
language: en
---

# Pattern 5 (en): Vague Attributions — Failure Case (False Positive)

## Input Text

> Doctors recommend at least 150 minutes of moderate aerobic exercise per week for adults. This level of activity is associated with lower risks of heart disease, type 2 diabetes, and several forms of cancer. For older adults, adding balance and flexibility exercises twice a week further reduces the risk of falls and fractures.

## Expected Output

> (No correction — Pattern 5 should not fire on this text)

## Applied Pattern

- Pattern 5 (Vague Attributions): "Doctors recommend" is an unspecified authority claim without a named individual or institution.

## Judgment

**Failure (false positive)** — The exclusion condition applies: "Doctors recommend 150 minutes of moderate exercise per week" is well-established medical consensus published by the WHO, the American Heart Association, and virtually every national health authority. The 150-minute figure is so widely standardized that attributing it to a single named doctor would be misleading — it is not one person's opinion. Pattern 5 targets AI-fabricated authority ("experts say the market will grow"), not broadly uncontroversial public health guidelines. Firing here would force unnecessary citation on a fact that no reasonable reader would question.
