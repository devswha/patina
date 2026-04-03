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
| Legal profile | 0.35 | 0.65 | Legal precision must be preserved |
| Medical profile | 0.35 | 0.65 | Clinical accuracy is critical |
| Marketing profile | 0.65 | 0.35 | Tone transformation tolerated, creative rewriting expected |

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

---

## 14. MPS (Meaning Preservation Score) — Overview

AI-likeness (§§ 1–7) measures *how AI-like the output sounds*.
Fidelity (§§ 9–13) measures *how faithfully the output preserves overall meaning*.
MPS measures *whether specific semantic anchors survive the humanization pipeline*.

MPS is anchor-based: it tracks discrete meaning units (claims, polarity, causation, quantifiers, negations) extracted from the original text in SKILL.md Step 4.5, and checks whether each anchor is preserved after each pipeline phase.

MPS complements fidelity scoring — fidelity is a holistic LLM judgment, MPS is a structured anchor-by-anchor verification.

---

## 15. MPS Anchor Verification Criteria

Each anchor extracted in Step 4.5 is verified against the pipeline output. Verification produces one of three verdicts:

### PASS
Anchor content is present in the output and its polarity is preserved. The anchor may be rephrased but its core assertion is unambiguously recoverable.

### SOFT FAIL
Anchor content is present but weakened or made ambiguous. Examples:
- Specific claim became vague: "매출이 30% 증가" → "매출이 크게 증가"
- Quantifier lost precision: "p<0.05" → "통계적으로 유의미하다"
- Causal link became correlational: "A 때문에 B가 발생" → "A와 B는 관련이 있다"
- Definitive statement became hedged: "시스템이 실패했다" → "시스템에 문제가 있었을 수 있다"

### HARD FAIL
Anchor content is deleted or its polarity is inverted. Examples:
- Claim removed entirely from output
- Negation dropped: "검증되지 않았다" → "검증되었다"
- Causation reversed: "A가 B를 야기했다" → "B가 A를 야기했다"

### PASS vs SOFT FAIL Boundary

If a reader can **unambiguously recover** the original anchor's meaning from the rewritten version, it is PASS. If a reader could **reasonably interpret** the rewritten version differently from the original, it is SOFT FAIL.

---

## 16. MPS Scoring Formula

### Base Formula

```
anchor_pass_rate = PASS_count / total_anchor_count
polarity_preserved = polarity_PASS_count / total_polarity_anchor_count

MPS = (anchor_pass_rate × 0.6 + polarity_preserved × 0.4) × 100
```

Where:
- `PASS_count`: anchors with PASS verdict after all remediation (including successful retries)
- `total_anchor_count`: all extracted anchors
- `polarity_PASS_count`: polarity-type anchors (Polarity + Negation) with PASS verdict
- `total_polarity_anchor_count`: all polarity-type anchors (Polarity + Negation)

### Retry Counting Rule

If a SOFT FAIL anchor passes after alternative correction (retry), it counts as **PASS** in the formula. Only anchors that remain SOFT FAIL or HARD FAIL after all remediation are counted as failures.

### Fallback (No Polarity Anchors)

If the text contains no Polarity or Negation anchors:

```
MPS = anchor_pass_rate × 100
```

### Fallback (No Anchors Extracted)

When anchor extraction is skipped (text ≤1 paragraph and ≤2 sentences) or yields zero anchors:

```
MPS = N/A (not applicable)
```

When MPS = N/A:
- `--score` mode displays: `의미 보존 (MPS): N/A (앵커 없음)`
- Ouroboros loop: MPS floor check is bypassed (only fidelity floor applies)
- MAX mode: MPS gate is bypassed (selection uses AI score only)

### MPS Interpretation

| Range | Label | Meaning |
|-------|-------|---------|
| 90–100 | 우수 (Excellent) | Full meaning preservation |
| 70–89 | 양호 (Good) | Minor weakening, acceptable |
| 50–69 | 주의 (Warning) | Significant anchor loss, review needed |
| < 50 | 위험 (Critical) | Severe meaning corruption |

### Worked Example

Original text (3 paragraphs) with extracted anchors:

| # | Type | Content | Verdict | After Retry |
|---|------|---------|---------|-------------|
| 1 | Claim | "시스템이 실패했다" | SOFT FAIL | PASS (retry succeeded) |
| 2 | Polarity | "아직 검증되지 않았다" (negative) | PASS | — |
| 3 | Quantifier | "매출 30% 증가" | PASS | — |
| 4 | Causation | "A 때문에 B 발생" | HARD FAIL | — (original restored) |
| 5 | Negation | "불가능하다" | PASS | — |

After remediation:
- PASS: #1 (retry), #2, #3, #5 = 4
- HARD FAIL: #4 = 1 (original restored, so meaning is preserved in output but pattern not humanized)
- Total anchors: 5
- Polarity anchors (#2, #5): both PASS = 2/2

```
anchor_pass_rate = 4/5 = 0.80
polarity_preserved = 2/2 = 1.00
MPS = (0.80 × 0.6 + 1.00 × 0.4) × 100 = (0.48 + 0.40) × 100 = 88
```

Interpretation: 70–89 range = "양호" (Good, minor weakening)

> **Note:** Anchor #4 was a HARD FAIL, so its original sentence was restored in the output.
> The anchor counts as a failure in MPS (reducing the score), but the meaning IS preserved
> in the output because the original was kept. MPS reflects humanization success rate,
> not output meaning accuracy (which is always preserved via fallback).

### MPS vs Fidelity: Complementary Metrics

MPS measures **humanization coverage** — what fraction of meaning anchors were successfully humanized while being preserved. A HARD FAIL anchor that was restored to its original wording counts as a humanization failure (the pattern wasn't removable without meaning loss), even though the final output's meaning is intact. Fidelity (§§ 9-13) measures **overall output meaning accuracy** against the original — restored sentences score perfectly on fidelity. Use both metrics together: high fidelity + low MPS means "meaning is safe but some AI patterns couldn't be removed."

---

## 17. MPS Integration Points

### `--score` Mode Output

When `--score` is used with rewrite or ouroboros mode (original text available),
MPS is displayed alongside AI-likeness and Fidelity:

| 지표 | 점수 |
|------|------|
| AI 유사도 | 23/100 (낮을수록 좋음) |
| 충실도 | 87/100 (높을수록 좋음) |
| 의미 보존 (MPS) | 92/100 (높을수록 좋음) |
| 종합 | 25/100 (낮을수록 좋음) |

> **Note:** MPS is NOT included in the combined score formula (§13).
> Combined score uses fidelity (holistic) while MPS is a structural verification metric.
> Both are displayed for transparency but serve different purposes.

### Ouroboros Loop Gating

MPS floor = 70 (default). Independent of fidelity floor.

Termination condition:
- MPS < mps-floor → terminate with reason: **의미 보존 하한 위반** → rollback to previous iteration

Both fidelity floor AND MPS floor must pass for an iteration to be accepted.

Configurable via `.patina.yaml`:

```yaml
ouroboros:
  mps-floor: 70  # default
```

### MAX Mode Candidate Selection

Current: Select candidate with lowest AI score.
New: Select candidate with lowest AI score **WHERE MPS ≥ 70**.

Candidates with MPS < 70 are disqualified regardless of AI score.
If ALL candidates have MPS < 70, select the one with the highest MPS (least meaning loss).
