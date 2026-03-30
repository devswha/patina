---
pattern: 21
type: failure
name: Sycophantic/Servile Tone
pack: en-communication
---

# Pattern 21: Sycophantic/Servile Tone — Failure (False Positive)

## Input Text

> "That's a great question," the senator replied, adjusting her microphone. "The short answer is that we don't have the votes yet. We're three short in committee, and two of those members haven't committed either way."

## Expected Output

> (No correction — this text should not trigger Pattern 21)

## Applied Pattern

- Pattern 21 (Sycophantic/Servile Tone): "That's a great question" appears at the start of the response.

## Verdict

**Failure (false positive)** — The phrase appears inside direct dialogue attributed to a named speaker (the senator) in a reported conversation. This is not the author flattering the reader — it is a realistic depiction of how politicians speak at press conferences. The substantive content follows immediately in the same sentence. Removing the phrase would alter the quoted dialogue and misrepresent the source. Pattern 21 targets AI-generated servile openers in editorial or analytical writing, not quoted speech.
