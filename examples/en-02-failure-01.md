---
pattern: 2
type: failure
name: Undue Emphasis on Notability/Media
pack: en-content
language: en
---

# Pattern 2 (en): Undue Emphasis on Notability/Media — Failure Case (False Positive)

## Input Text

> Dr. Elena Marquez's 2019 paper on CRISPR delivery mechanisms has been cited over 3,000 times according to Google Scholar. Nature featured her lab's follow-up study in its March 2023 issue, and the Nobel Committee included her work in its shortlist commentary published that October. She is now the most-funded principal investigator in her department's history.

## Expected Output

> (No correction — Pattern 2 should not fire on this text)

## Applied Pattern

- Pattern 2 (Undue Emphasis on Notability/Media): "cited over 3,000 times" and "most-funded principal investigator" could superficially resemble notability claims.

## Judgment

**Failure (false positive)** — The exclusion condition applies: every claim of notability is backed by specific, verifiable detail. The citation count names the platform (Google Scholar) and gives a number (3,000). The media mention names the publication (Nature) and the date (March 2023). The Nobel reference specifies the document type and month. Pattern 2 targets vague, unsourced acclaim — not attributed statements with named outlets, dates, and figures. Firing here would penalize precisely the kind of sourced writing that pattern 2 is designed to encourage.
