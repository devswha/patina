---
pattern: 16
type: failure
name: Title Case in Headings
pack: en-style
language: en
---

# Pattern 16 (en): Title Case in Headings — Failure Case (False Positive)

## Input Text

> ## How Google Cloud Platform Changed Our DevOps Pipeline
>
> After migrating from on-premise servers to Google Cloud Platform, our team reduced deployment times from four hours to under fifteen minutes. The combination of Cloud Build, Artifact Registry, and GKE made continuous delivery practical for a team of six.

## Expected Output

> (No correction — Pattern 16 should not fire on this text)

## Applied Pattern

- Pattern 16 (Title Case in Headings): Multiple capitalized content words — "Google", "Cloud", "Platform", "Changed", "Our", "DevOps", "Pipeline".

## Judgment

**Failure (false positive)** — The exclusion condition applies: "Google Cloud Platform" is an official product name that requires capitalization, and "DevOps" is an established industry term consistently written with capital D and O. The only non-proper-noun capitalizations are "Changed", "Our", and "Pipeline", which fall below the 3-content-word threshold once proper nouns are excluded. Lowercasing "Google cloud platform" or "devops" would be factually incorrect. Pattern 16 should not penalize headings where the majority of capitalized words are proper nouns or brand names.
