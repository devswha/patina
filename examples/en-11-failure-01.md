---
pattern: 11
type: failure
name: Synonym Cycling
pack: en-language
language: en
---

# Pattern 11 (en): Synonym Cycling — Failure Case (False Positive)

## Input Text

> Alphabet reported $307 billion in revenue for fiscal year 2024, up 14% from the prior year. Most of that growth came from Google, whose advertising division alone generated $224 billion. Meanwhile, DeepMind — the research lab Alphabet acquired in 2014 — published 82 papers at major AI conferences, more than any other corporate lab that year.

## Expected Output

> (No correction — Pattern 11 should not fire on this text)

## Applied Pattern

- Pattern 11 (Synonym Cycling): "Alphabet," "Google," and "DeepMind" are three different names appearing in the same paragraph.

## Judgment

**Failure (false positive)** — The exclusion condition applies: these are three distinct legal entities, not synonyms for the same thing. Alphabet is the parent holding company, Google is its largest subsidiary (with its own revenue line), and DeepMind is a separate research lab that Alphabet acquired. The text uses each name precisely where it is needed — Alphabet for consolidated revenue, Google for advertising revenue, DeepMind for research output. Replacing all three with a single term would be factually wrong: Google's ad revenue is not the same as Alphabet's total revenue, and DeepMind's paper count is not attributable to Google. This is legitimate disambiguation, not synonym cycling.
