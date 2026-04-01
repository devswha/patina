---
pattern: 12
type: failure
name: False Ranges
pack: en-language
language: en
---

# Pattern 12 (en): False Ranges — Failure Case (False Positive)

## Input Text

> The study tracked 3,400 patients aged 18 to 65 over a period from January to June 2024. Blood pressure readings ranged from 90/60 to 180/110 mmHg at baseline. Participants were drawn from 12 clinics across four states, and follow-up visits occurred every two weeks throughout the six-month window.

## Expected Output

> (No correction — Pattern 12 should not fire on this text)

## Applied Pattern

- Pattern 12 (False Ranges): "aged 18 to 65," "from January to June 2024," and "from 90/60 to 180/110 mmHg" are three range constructions in one paragraph.

## Judgment

**Failure (false positive)** — The exclusion condition applies: all three ranges are genuine numeric or temporal bounds, not decorative rhetoric. "Aged 18 to 65" defines the inclusion criteria for the study cohort. "January to June 2024" specifies the exact observation window. "90/60 to 180/110 mmHg" reports the actual measured spread of baseline blood pressure values. Each range communicates precise, falsifiable information — a reader can verify whether a given patient falls within the age range or whether a reading falls within the reported spread. Replacing these with non-range alternatives would lose critical methodological detail. Pattern 12 targets decorative breadth claims, not empirical data reporting.
