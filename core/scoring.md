---
name: AI-Likeness Scoring Algorithm
version: 1.0.0
description: Pattern-based AI-likeness scoring reference for patina score and ouroboros modes
---

# AI-Likeness Scoring Algorithm

Pattern-based scoring that converts AI pattern detection results into a numeric 0-100 score.
Used by `--score` mode and `--ouroboros` loop for termination gating.

---

## 1. Severity Scale (Per-Detection)

Severity is assigned **per detection** by the LLM during the pattern scan phase.
It is NOT intrinsic to the pattern — the same pattern may receive different severity
depending on how egregiously it appears in context.

| Level | Points | Criteria |
|-------|--------|----------|
| High | 3 | Pattern is pervasive — appears multiple times or is especially blatant |
| Medium | 2 | Pattern present at moderate frequency or impact |
| Low | 1 | Pattern barely present — isolated occurrence |
| Not detected | 0 | Pattern not found in text |

---

## 2. Severity Assignment Rubric

To reduce variance between runs, follow these guidelines when assigning severity:

### General Rubric (4+ paragraph text)

| Instances | Severity |
|-----------|----------|
| 1-2 isolated occurrences | Low (1) |
| 3-5 occurrences, or concentrated in one section | Medium (2) |
| 6+ occurrences, or pervasive throughout | High (3) |

### Special Cases

- **Structure patterns (#25-28):** Assess at document level, not instance count.
  A single structural issue (e.g., every paragraph follows identical template) is High.
- **Communication patterns (#19-21):** A single clear chatbot expression
  (e.g., "좋은 질문입니다!") may be High — these are strong AI signals regardless of count.
- **Short text (1-2 paragraphs):** Adjust thresholds proportionally.
  2 instances in 2 paragraphs = Medium, not Low.

---

## 3. Category Derivation

Categories are derived **dynamically** from pack frontmatter, not hardcoded.

```
Category = pack frontmatter `pack` field minus language prefix
Example: pack: ko-content  → category: content
         pack: en-style    → category: style
         pack: ko-custom   → category: custom

Pattern count = pack frontmatter `patterns` field
```

If multiple packs map to the same category (e.g., `ko-content` and `custom/ko-content`),
their patterns are merged and counts summed for that category.

Unknown categories (from custom packs not in the weight config) get default weight: **0.10**.

---

## 4. Category Weights

### Korean (ko)

| Category | Weight | Patterns |
|----------|--------|----------|
| content | 0.20 | 6 |
| language | 0.20 | 6 |
| style | 0.20 | 6 |
| communication | 0.15 | 3 |
| filler | 0.10 | 3 |
| structure | 0.15 | 4 |
| **Total** | **1.00** | **28** |

### English (en)

| Category | Weight | Patterns |
|----------|--------|----------|
| content | 0.22 | 6 |
| language | 0.22 | 6 |
| style | 0.22 | 6 |
| communication | 0.14 | 3 |
| filler | 0.10 | 3 |
| structure | 0.10 | 4 |
| **Total** | **1.00** | **28** |

Weights are configurable via `ouroboros.category-weights.{lang}` in `.patina.yaml`.

---

## 5. Profile Override Adjustments

Before summing severities, apply profile `pattern-overrides` modifiers:

| Override | Factor | Effect |
|----------|--------|--------|
| amplify | × 1.5 (cap at 3) | Increases severity contribution |
| reduce | × 0.5 | Decreases severity contribution |
| suppress | × 0.0 | Excludes pattern entirely |
| normal (default) | × 1.0 | No change |

Example: blog profile suppresses #14 (bold) → pattern #14 severity becomes 0,
excluded from ko-style category calculation.

### Language-Scoped Overrides

`pattern-overrides` may be nested under a language code (`ko:`, `en:`) to avoid
cross-language number collisions (e.g., ko #8 is "~적 접미사" while en #8 is
"Copula Avoidance" — the same number refers to unrelated patterns in each language).

```yaml
# Language-scoped format (recommended for multi-language profiles)
pattern-overrides:
  ko:
    8: amplify    # ko-language #8 (~적 접미사)
    14: suppress  # ko-style #14 (볼드체)
  en:
    8: amplify    # en-language #8 (Copula Avoidance)
    14: suppress  # en-style #14 (Boldface)
```

**Resolution rule:** When the active language has a sub-section under `pattern-overrides`,
apply **only** that sub-section's overrides. Top-level (unscoped) overrides apply to all
languages and are merged before language-scoped ones (language-scoped wins on conflict).

---

## 6. Scoring Formula

### Per-Category Score

```
category_score = (sum of adjusted severities / (pattern_count × 3)) × 100
```

- `sum of adjusted severities`: sum severity points for all detected patterns in category,
  after applying profile override factors
- `pattern_count × 3`: maximum possible score (all patterns detected at High severity)
- Result: 0-100 per category

### Overall Score

```
overall_score = Σ(category_score × category_weight) for all categories
```

### Worked Example (Korean, default profile)

Input text detected patterns:

| Pattern | Category | Raw Severity | Override | Adjusted |
|---------|----------|-------------|----------|----------|
| #1 과도한 중요성 부여 | content | High (3) | normal | 3 |
| #3 피상적 분석 | content | Medium (2) | normal | 2 |
| #5 모호한 출처 | content | Low (1) | normal | 1 |
| #8 ~적 접미사 | language | Medium (2) | normal | 2 |
| #14 볼드체 | style | High (3) | normal | 3 |
| #17 이모지 | style | Medium (2) | normal | 2 |
| #23 채움 표현 | filler | Low (1) | normal | 1 |
| #25 구조적 반복 | structure | High (3) | normal | 3 |

Category scores:

| Category | Detected | Sum | Max (count×3) | Score |
|----------|----------|-----|---------------|-------|
| content | 3/6 | 3+2+1=6 | 6×3=18 | 33.3 |
| language | 1/6 | 2 | 18 | 11.1 |
| style | 2/6 | 3+2=5 | 18 | 27.8 |
| communication | 0/3 | 0 | 9 | 0.0 |
| filler | 1/3 | 1 | 9 | 11.1 |
| structure | 1/4 | 3 | 12 | 25.0 |

Overall = 33.3×0.20 + 11.1×0.20 + 27.8×0.20 + 0.0×0.15 + 11.1×0.10 + 25.0×0.15
       = 6.66 + 2.22 + 5.56 + 0.00 + 1.11 + 3.75
       = **19.3**

Interpretation: 16-30 range = "거의 사람다움" (Mostly human, minor traces)

---

## 7. Score Interpretation

| Range | Label | Meaning |
|-------|-------|---------|
| 0-15 | 사람다움 | Strongly human-like |
| 16-30 | 거의 사람다움 | Mostly human, minor AI traces |
| 31-50 | 혼재 | Mixed signals, noticeable AI patterns |
| 51-70 | AI 느낌 | Clearly AI-generated |
| 71-100 | AI 생성 | Heavily AI-generated |

> **Variance Note:** Scores have expected variance of **±8-10 points** between runs
> due to LLM severity assignment. Use score ranges, not exact numbers, for comparison.
> A score of 42 should be interpreted as "roughly 32-52 range" for decision-making.

---

## 8. Known Limitations (Phase 1)

- **Single mode only.** MAX mode (SKILL-MAX.md) uses separate subjective evaluation.
  These approaches will be reconciled in Phase 2.
- **Custom pattern packs** are auto-discovered and scored. A new category
  (e.g., `custom/patterns/ko-domain.md` with `pack: ko-domain`) gets default weight 0.10.
- **LLM non-determinism** means the same text may score differently across runs.
  The formula is deterministic; the severity assignment is not.
- **Fidelity scoring** (meaning preservation vs original) is deferred to Phase 2.
