---
pattern: 25
type: failure
name: Metronomic Paragraph Structure
pack: en-structure
---

# Pattern 25: Metronomic Paragraph Structure — Failure (False Positive)

## Input Text

> **iPhone 15 Pro:** The A17 Pro chip delivers a 10% CPU improvement over the A16. GPU performance is up 20%, which matters mainly for gaming. Battery life is rated at 23 hours of video playback. Starting price: $999.
>
> **Samsung Galaxy S24 Ultra:** The Snapdragon 8 Gen 3 matches or exceeds the A17 in most benchmarks. The 200MP camera sensor is the highest resolution in any flagship phone. Battery life is rated at 27 hours of video playback. Starting price: $1,299.
>
> **Google Pixel 8 Pro:** The Tensor G3 chip is weaker on raw benchmarks but optimized for on-device AI tasks. The camera uses computational photography rather than high megapixel counts. Battery life is rated at 24 hours of video playback. Starting price: $999.

## Expected Output

> (No correction — this text should not trigger Pattern 25)

## Applied Pattern

- Pattern 25 (Metronomic Paragraph Structure): All three paragraphs follow the same internal template — processor, then camera/GPU, then battery life, then price.

## Verdict

**Failure (false positive)** — The exclusion condition applies: comparative reviews where the repeated structure is the required format are explicitly excluded. This is a product comparison evaluating three phones on the same criteria (processor, camera, battery, price). The parallel structure is deliberate and expected — readers need consistent categories to compare products. The regularity is a feature of the format, not an AI artifact.
