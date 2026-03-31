---
pattern: 12
type: failure
name: False Ranges
pack: en-language
language: en
---

# Pattern 12 (en): False Ranges — Failure Case (False Positive)

## Input Text

> Wind speeds during the hurricane ranged from 75 mph at the outer bands to 160 mph near the eyewall. Storm surge projections varied from 4 feet in sheltered bays to 18 feet along exposed coastline. Evacuation zones covered everything from low-lying mobile home parks to beachfront condominiums up to the third floor.

## Expected Output

> (No correction — Pattern 12 should not fire on this text)

## Applied Pattern

- Pattern 12 (False Ranges): Three "from X to Y" / "ranged from" constructions appear — wind speed, storm surge, and evacuation zones — matching the pattern's watch words.

## Judgment

**Failure (false positive)** — The exclusion covers genuine numeric and spatial ranges. The first two ranges (75–160 mph, 4–18 feet) are quantitative meteorological measurements that define observable physical parameters. The third range (mobile home parks to beachfront condominiums up to the third floor) is a spatial/structural range that describes the actual boundaries of an evacuation order — the poles are not decorative but define the literal scope of a government directive. All three ranges are informative: a reader learns the wind gradient, the surge variation, and which structures fall inside the evacuation zone. This is emergency communication where ranges carry operational meaning, not marketing breadth claims.
