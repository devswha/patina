---
pattern: 30
type: failure
name: Rhetorical Question Openers
pack: en-structure
language: en
---

# Pattern 30: Rhetorical Question Openers — Failure (False Positive)

## Input Text

> **Q: When should I respond to a work email?**
>
> For internal email, four hours is the typical expectation. For external clients, one hour. If you're in meetings or traveling, set an auto-responder noting your return.
>
> **Q: What if I'm too busy to actually reply that fast?**
>
> Send a short acknowledgment first: "Got it, I'll respond within N days after I've reviewed." Silence is the worst answer.

## Expected Output

> (No correction — this text should not trigger Pattern 30)

## Applied Pattern

- Pattern 30 (Rhetorical Question Openers): Two consecutive paragraphs open with interrogative sentences and answer them immediately.

## Judgment

**Failure (false positive)** — This is FAQ-format content, which Pattern 30 explicitly excludes. The interrogative openers are not structural filler — they are the format itself. Converting them to declaratives would destroy the genre.
