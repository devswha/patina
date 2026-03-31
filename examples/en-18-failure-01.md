---
pattern: 18
type: failure
name: Curly Quotation Marks
pack: en-style
language: en
---

# Pattern 18 (en): Curly Quotation Marks — Failure Case (False Positive)

## Input Text

> \u201cTo be or not to be,\u201d wrote Shakespeare, though the full soliloquy is rarely quoted in its entirety. Harold Bloom called it \u201cthe most famous speech in the English language,\u201d a claim that few literary scholars have disputed. The phrase has since entered common usage, often shortened to a rhetorical shrug: \u201cTo be or not to be\u2014that\u2019s the real question, isn\u2019t it?\u201d

## Expected Output

> (No correction — Pattern 18 should not fire on this text)

## Applied Pattern

- Pattern 18 (Curly Quotation Marks): Three pairs of curly double quotes (\u201c \u201d) and two curly apostrophes (\u2019) detected in text.

## Judgment

**Failure (false positive)** — The exclusion condition applies: these curly quotes appear in narrative literary prose, not in code blocks, configuration files, or technical documentation. Curly quotation marks are the typographically correct form for quoted speech and attributed quotations in published writing. The curly apostrophes in \u201cthat\u2019s\u201d and \u201cisn\u2019t\u201d are likewise standard in typeset prose. Replacing them with straight quotes would be a typographic downgrade. Pattern 18 explicitly limits its scope to technical and code contexts where curly quotes cause functional problems.
