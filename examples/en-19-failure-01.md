---
pattern: 19
type: failure
name: Collaborative Communication Artifacts
pack: en-communication
---

# Pattern 19: Collaborative Communication Artifacts — Failure (False Positive)

## Input Text

> The chatbot's default responses included phrases like "I hope this helps!" and "Feel free to ask if you have more questions." In user testing, 62% of participants said these phrases made the bot feel more approachable, while 28% found them patronizing.

## Expected Output

> (No correction — this text should not trigger Pattern 19)

## Applied Pattern

- Pattern 19 (Collaborative Communication Artifacts): "I hope this helps!" and "Feel free to ask" both appear in the text.

## Verdict

**Failure (false positive)** — The exclusion condition applies: these phrases appear as quoted dialogue being analyzed, not as the author's own conversational artifacts. The text is a UX research report examining how users react to chatbot microcopy. The collaborative phrases are the object of study, not leftover AI conversational habits. Firing here would penalize legitimate analysis of chatbot interface design.
