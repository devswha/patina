---
pattern: 38
type: failure
name: 2026 Cadence Stack
pack: en-style
language: en
---

# Pattern 38: 2026 Cadence Stack — Failure (False Positive)

## Input Text

> Deploy failed twice. Rolled back. Root cause was a stale TLS cert on the edge node. Revenue still grew across 2020—2024.

## Expected Output

> (No correction — this text should not trigger Pattern 38)

## Applied Pattern

- Pattern 38 (2026 Cadence Stack): Four sentences, three of them short, and a dash is present.

## Judgment

**Failure (correct non-fire)** — The surface rhythm looks like the tell, but the second required signal is absent. The short sentences each carry a concrete anchor (a count, a rollback, a named cause), so they are not parallel empty fragments, and the only dash is a numeric range — span punctuation, explicitly excluded, never an aside. Human incident writing is genuinely clipped; firing here is exactly the over-correction Pattern 38's exclusions exist to prevent.
