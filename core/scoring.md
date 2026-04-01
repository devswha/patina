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

### Chinese (zh)

| Category | Weight | Patterns |
|----------|--------|----------|
| content | 0.20 | 6 |
| language | 0.20 | 6 |
| style | 0.20 | 6 |
| communication | 0.15 | 3 |
| filler | 0.10 | 3 |
| structure | 0.15 | 4 |
| **Total** | **1.00** | **28** |

### Japanese (ja)

| Category | Weight | Patterns |
|----------|--------|----------|
| content | 0.20 | 6 |
| language | 0.20 | 6 |
| style | 0.20 | 6 |
| communication | 0.15 | 3 |
| filler | 0.10 | 3 |
| structure | 0.15 | 4 |
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

## 8. Known Limitations

- **Custom pattern packs** are auto-discovered and scored. A new category
  (e.g., `custom/patterns/ko-domain.md` with `pack: ko-domain`) gets default weight 0.10.
- **LLM non-determinism** means the same text may score differently across runs.
  The formula is deterministic; the severity assignment is not.
- **Fidelity scoring** (meaning preservation vs original) is defined in §§ 9–13 below
  and integrated into `--score`, `--ouroboros`, and MAX mode pipelines.

---

## 9. Fidelity Scoring — Overview

AI-likeness (§§ 1–7) measures *how AI-like the output sounds*.
Fidelity measures *how faithfully the output preserves the original meaning*.

Both dimensions are necessary: aggressive humanization can achieve a low AI score
by deleting content or changing meaning entirely. Fidelity scoring guards against this.

Fidelity scoring is integrated into `--score`, `--ouroboros`, and MAX mode pipelines.
See SKILL.md § 6 (score mode) and SKILL-MAX.md § 6 for integration details.

---

## 10. Fidelity Criteria

Four criteria, each scored independently by the LLM comparing original → output:

### 10.1 Claims Preserved

Every factual claim in the original appears (perhaps rephrased) in the output.

| Level | Points | Criteria |
|-------|--------|----------|
| High | 3 | All key claims preserved — no factual content lost |
| Medium | 2 | Minor claims omitted — supporting details or examples dropped, but core argument intact |
| Low | 1 | Significant claims missing — one or more central facts or arguments absent |
| Fail | 0 | Core meaning lost — the output says something fundamentally different |

### 10.2 No Fabrication

The output does not add claims, facts, or specifics not present or implied by the original.

| Level | Points | Criteria |
|-------|--------|----------|
| High | 3 | No fabrication — every claim in the output traces to the original |
| Medium | 2 | Minor additions — a reasonable inference stated as fact, or an illustrative example added |
| Low | 1 | Noticeable fabrication — specific numbers, names, or claims not in the original |
| Fail | 0 | Significant fabrication — output contains substantial invented content |

### 10.3 Tone Match

The output's register matches the original (or the profile's target register, if explicitly overridden).

| Level | Points | Criteria |
|-------|--------|----------|
| High | 3 | Tone matches — formality level, domain register, and audience consistent |
| Medium | 2 | Slight drift — somewhat more/less formal, but still appropriate for the context |
| Low | 1 | Noticeable mismatch — formal original made casual (or vice versa) without profile justification |
| Fail | 0 | Register violation — academic text made into slang, or casual text made into legalese |

**Profile exception:** When a profile explicitly shifts register (e.g., blog profile amplifies
informality), tone match is assessed against the *profile target*, not the original register.

### 10.4 Length Ratio

Compares output length to original. Extreme changes suggest content loss or padding.

| Ratio | Points | Criteria |
|-------|--------|----------|
| 70–130% | 3 | Length preserved — natural variation within ±30% |
| 50–69% or 131–150% | 2 | Moderate change — some compression or expansion, likely acceptable |
| 30–49% or 151–200% | 1 | Significant change — substantial content probably lost or padded |
| < 30% or > 200% | 0 | Extreme change — content almost certainly lost or heavily padded |

**Calculation:** `length_ratio = len(output) / len(original) × 100`

Length is measured in characters (not words or tokens) for language-agnostic consistency.

---

## 11. Fidelity Severity Assignment Rubric

To reduce variance, apply these guidelines when scoring fidelity criteria:

### Claims Preserved
- Count discrete factual claims in the original. If all appear (rephrased or not) → High.
- If only supporting details are dropped but the argument structure survives → Medium.
- If a numbered list loses items, a causal chain loses a step, or a key qualifier is dropped → Low.

### No Fabrication
- Paraphrasing that changes word choice but not meaning → High.
- Adding a commonly-known context note ("Seoul, the capital of South Korea") → Medium.
- Inventing a statistic, date, or name not in the original → Low or Fail.

### Tone Match
- Compare the first and last paragraphs of original vs. output for register cues.
- Profile-targeted register shifts are expected, not penalized.
- Mixed register (formal opening, casual middle) counts as Low.

### Length Ratio
- This criterion is deterministic — compute the ratio and look up the table.
- No LLM judgment needed. Include the raw ratio in the score output.

---

## 12. Fidelity Scoring Formula

### Per-Criterion Score

Each criterion is scored 0–3 (same as AI-likeness severity). The fidelity score normalizes
across all four criteria:

```
fidelity_score = ((claims + fabrication + tone + length) / 12) × 100
```

- Maximum: (3+3+3+3) / 12 × 100 = **100** (perfect fidelity)
- Minimum: (0+0+0+0) / 12 × 100 = **0** (total meaning loss)

### Criterion Weighting (Optional)

For profiles that need non-uniform criterion importance, weights can be configured:

```yaml
fidelity:
  weights:
    claims-preserved: 0.35
    no-fabrication: 0.30
    tone-match: 0.20
    length-ratio: 0.15
```

When weights are configured:

```
fidelity_score = Σ((criterion_points / 3) × criterion_weight) × 100
```

Default weights (when not configured): equal at 0.25 each (equivalent to the simple formula).

### Worked Example

Original: 4-paragraph academic article about climate change policy.
Output: Humanized version.

| Criterion | Score | Reasoning |
|-----------|-------|-----------|
| Claims preserved | 3 (High) | All policy recommendations and cited figures present |
| No fabrication | 2 (Medium) | Added "as widely reported" — minor inference stated as fact |
| Tone match | 3 (High) | Academic register maintained throughout |
| Length ratio | 2 (Moderate) | Output is 68% of original length (within 50-69% band) |

Fidelity = (3+2+3+2) / 12 × 100 = **83.3**

Interpretation: 76-90 range = "높은 충실도" (High fidelity, minor issues)

### Fidelity Score Interpretation

| Range | Label | Meaning |
|-------|-------|---------|
| 91-100 | 완벽한 충실도 | Perfect fidelity — all meaning preserved |
| 76-90 | 높은 충실도 | High fidelity — minor omissions or additions |
| 51-75 | 보통 충실도 | Moderate fidelity — noticeable meaning changes |
| 26-50 | 낮은 충실도 | Low fidelity — significant meaning loss or fabrication |
| 0-25 | 의미 왜곡 | Meaning severely distorted or lost |

> **Note:** Unlike AI-likeness (lower = better), fidelity uses **higher = better**.
> A score of 83 means "roughly 73-93 range" given ±10 LLM variance —
> solidly in the "높은 충실도" band.

---

## 13. Combined Score

### Formula

AI-likeness and fidelity compose into a combined score with configurable weighting:

```
combined = (ai_likeness × ai_weight) + (fidelity_inverted × fidelity_weight)
```

Where:
- `ai_likeness`: AI-likeness score from § 6 (0-100, lower = more human)
- `fidelity_inverted`: `100 - fidelity_score` (invert so both dimensions use "lower is better")
- `ai_weight + fidelity_weight = 1.0`

### Default Weights

| Context | AI Weight | Fidelity Weight | Rationale |
|---------|-----------|-----------------|-----------|
| Default | 0.60 | 0.40 | Balanced — humanization is primary goal |
| Academic profile | 0.40 | 0.60 | Meaning preservation is critical in scholarly work |
| Blog profile | 0.70 | 0.30 | Creative rewriting tolerated |
| Technical profile | 0.35 | 0.65 | Accuracy is paramount in docs |
| Social profile | 0.75 | 0.25 | Tone transformation expected |
| Email profile | 0.50 | 0.50 | Equal importance |

Configurable via `ouroboros.combined-weights.{profile}` in `.patina.yaml`:

```yaml
ouroboros:
  combined-weights:
    default:
      ai-likeness: 0.60
      fidelity: 0.40
    academic:
      ai-likeness: 0.40
      fidelity: 0.60
```

### Combined Score Interpretation

| Range | Label | Meaning |
|-------|-------|---------|
| 0-15 | 최적 | Excellent — human-like and faithful |
| 16-30 | 양호 | Good — minor issues in one or both dimensions |
| 31-50 | 보통 | Acceptable — noticeable trade-offs |
| 51-70 | 주의 | Caution — significant AI traces or meaning loss |
| 71-100 | 부적합 | Poor — heavy AI patterns and/or substantial meaning loss |

### Ouroboros Termination

When used with `--ouroboros`, the loop terminates when:
- Combined score ≤ threshold (default: 30), OR
- Fidelity score drops below floor (default: 70) — **hard stop**, even if AI score improves

This prevents the ouroboros loop from "improving" AI score by destroying content.
