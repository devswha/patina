---
pattern: 13
type: failure
name: Em Dash Overuse
pack: en-style
---

# Pattern 13: Em Dash Overuse — Failure (False Positive)

## Input Text

> She opened the envelope, scanned the first line, and stopped. The grant had been denied — no explanation, no appeal process, nothing. She sat with it for a long time before calling her co-founder.

## Expected Output

> (No correction — this text should not trigger Pattern 13)

## Applied Pattern

- Pattern 13 (Em Dash Overuse): One em dash appears in the text.

## Verdict

**Failure (false positive)** — The exclusion condition applies: a single em dash used for a sharp parenthetical or abrupt sentence break is stylistically valid, especially in informal or literary writing. Here the em dash creates a dramatic pause before a blunt enumeration ("no explanation, no appeal process, nothing"), which is a deliberate rhetorical choice. The text contains only 1 em dash, well below the 3+ cluster threshold required to fire.
