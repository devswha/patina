---
pattern: 11
type: success
name: Synonym Cycling
pack: en-language
language: en
---

# Pattern 11 (en): Synonym Cycling — Success Case

## Input Text

> Berlin has emerged as one of Europe's most exciting destinations for digital nomads. The German capital offers affordable coworking spaces in neighborhoods like Kreuzberg and Neukölln. The metropolis also benefits from an extensive public transit network that makes car ownership unnecessary. For many remote workers, the urban center represents a rare combination of low cost of living and high quality of life.

## Expected Output

> Berlin has emerged as one of Europe's most popular destinations for digital nomads. It offers affordable coworking spaces in Kreuzberg and Neukölln, and its U-Bahn and S-Bahn network makes car ownership unnecessary. For many remote workers, Berlin is a rare case: a capital city where a freelancer can rent a one-bedroom apartment for under 900 euros a month.

## Applied Pattern

- Pattern 11 (Synonym Cycling): Berlin is referred to by four different names in four sentences — "Berlin," "the German capital," "the metropolis," and "the urban center." Each is a synonym for the same entity, rotated to avoid repetition.

## Judgment

**Success** — The fire condition (same entity referred to by 3+ different names in a single paragraph) is met with four variants. None of the synonyms add information that "Berlin" or "it" would not convey — "the German capital" does not disambiguate from another Berlin, and "the metropolis" and "the urban center" are generic labels that could describe any large city. The corrected version uses "Berlin" twice and "it/its" for the remaining references, which reads naturally. It also replaces the vague closing claim with a concrete rent figure.
