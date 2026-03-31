---
pattern: 17
type: failure
name: Emojis
pack: en-style
language: en
---

# Pattern 17 (en): Emojis — Failure Case (False Positive)

## Input Text

> New drop 🔥 Link in bio
>
> We spent 6 months on this one. Hand-stitched, limited to 200 units. Once they're gone, they're gone 👋
>
> Tag someone who needs this 👇

## Expected Output

> (No correction — Pattern 17 should not fire on this text)

## Applied Pattern

- Pattern 17 (Emojis): Three emojis in text — 🔥, 👋, 👇.

## Judgment

**Failure (false positive)** — The exclusion condition applies: this is social media copy (Instagram-style brand post) where emojis are a deliberate and genre-appropriate stylistic choice. The 🔥 signals excitement about a product launch, 👋 reinforces scarcity with a casual goodbye gesture, and 👇 is a standard call-to-action pointing users to comments. Removing these emojis would strip the post of its platform-native tone and make it feel stiff and out of place in a social media feed. Pattern 17 explicitly excludes social media copy where emojis are intentional.
