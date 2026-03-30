---
pattern: 4
type: failure
name: Promotional Language
pack: en-content
---

# Pattern 4: Promotional Language — Failure (False Positive)

## Input Text

> The hotel's own website describes the property as "a breathtaking escape nestled among ancient olive groves" and "a must-visit hidden gem of the Amalfi Coast." These claims are difficult to verify, since the hotel opened only six months ago and has 14 reviews on TripAdvisor, averaging 3.8 stars.

## Expected Output

> (No correction — this text should not trigger Pattern 4)

## Applied Pattern

- Pattern 4 (Promotional Language): "breathtaking," "nestled," "must-visit," and "hidden gem" all appear in the text.

## Verdict

**Failure (false positive)** — The exclusion condition applies: the promotional language appears inside direct quotations from marketing materials being analyzed, not as the author's own descriptive prose. The author is critically examining these claims, not endorsing them. The surrounding text provides a skeptical counterpoint with specific data (14 reviews, 3.8-star average). Firing here would penalize legitimate media criticism.
