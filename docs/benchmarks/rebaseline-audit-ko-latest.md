# Rebaseline KO Audit (measure-only)

Operator audit of perfect-score and boundary samples for the KO collection wave
(Wave 1). **Measure-only**: no detector threshold was changed and no
`src/features` behavior was touched. Raw text stays in the gitignored
`artifacts/rebaseline-2025/private/` workspace; this report records only sample
IDs, outcomes, and verdicts.

- Manifest: `artifacts/rebaseline-2025/manifest.ko.scored.public.jsonl` (380 rows)
- Negatives: 250 natural-human (5 registers × 50), reused hash-only controls
- Positives: 120 `ai-like` across 3 model families (gpt 40 / claude 40 / gemini 40)
- Edited-AI: 5 `lightly-edited-ai` + 5 `heavily-edited-ai` (one light + one heavy per register)
- Score field: `patina_score` (deterministic analyzer); scoring is bimodal (0 or 100), so the operating boundary is effectively the `predicted_hot` split.

Verdict vocabulary: **genuine** (correctly labeled, authentic for its class),
**too-easy** (correctly labeled but trivially separable due to an artifact),
**mislabeled** (the class label is wrong).

## Perfect-score positives (patina_score = 100)

70 of 120 `ai-like` rows score 100. Sample reviewed (representative, one per register family):

| sample_id | register | model_family | score | verdict |
|---|---|---|---:|---|
| rb26-ko-gpt-001 | blog | gpt-family | 100 | genuine |
| rb26-ko-gpt-002 | academic-summary | gpt-family | 100 | genuine |
| rb26-ko-gpt-003 | product-doc | gpt-family | 100 | genuine |
| rb26-ko-gpt-004 | chat-update | gpt-family | 100 | genuine |

Notes: these read as authentic modern-assistant Korean prose — balanced
structure, hedged generalities, even sentence rhythm. No AI self-references,
benchmark hints, or generation artifacts that would make them artificially
easy. Correctly labeled `ai-like`. **Verdict: genuine (0 too-easy, 0 mislabeled).**

## Boundary / missed positives (patina_score = 0, predicted_hot = false)

50 of 120 `ai-like` rows score 0 — genuine AI text the deterministic analyzer
does not flag (gpt 22 / claude 15 / gemini 13). Sample reviewed:

| sample_id | register | model_family | score | verdict |
|---|---|---|---:|---|
| rb26-ko-gpt-018 | product-doc | gpt-family | 0 | genuine (evasion) |
| rb26-ko-gpt-019 | chat-update | gpt-family | 0 | genuine (evasion) |
| rb26-ko-gpt-021 | blog | gpt-family | 0 | genuine (evasion) |
| rb26-ko-gpt-022 | academic-summary | gpt-family | 0 | genuine (evasion) |

Notes: these are stylistically indistinguishable from the caught positives
(e.g. gpt-018 vs the caught gpt-003, both product-doc) yet trigger no lexicon /
stylometry tells. They are correctly labeled AI; the analyzer simply misses
them. This is the central measure-only finding: modern assistant Korean is hard,
and detection here is paragraph-tell-driven, not class-driven. **Verdict:
genuine; these are honest false negatives, not mislabels.**

## False-positive negatives (natural-human, predicted_hot = true)

42 of 250 natural-human controls are flagged hot (16.8% FP). Sample reviewed:

| sample_id | register | score | verdict |
|---|---|---:|---|
| ko-human-web-toss-navigation-score-2025-04 | blog | 100 | genuine (human; detector FP) |
| ko-human-web-toss-navigation-score-2025-10 | blog | 100 | genuine (human; detector FP) |
| ko-human-web-toss-bank-interns-2025-07 | blog | 100 | genuine (human; detector FP) |
| ko-human-web-toss-bank-interns-2025-08 | blog | 100 | genuine (human; detector FP) |

Notes: these are real published Korean engineering-blog paragraphs (specific
product/tool names, Kotlin `data class` / `toString()` specifics, conversational
`-어요/-거든요` endings). Unambiguously human. The high score is a genuine
detector false positive on polished Korean technical writing, **not** a label
error. **Verdict: genuine human, correctly labeled; the FP is a detector signal
to feed future calibration (out of scope here).**

## Edited-AI outcomes

| class | per-register outcomes (score / hot) | hot count |
|---|---|---:|
| lightly-edited-ai | blog 0·miss, academic 100·hot, product 0·miss, chat 100·hot, tech 100·hot | 3/5 |
| heavily-edited-ai | blog 100·hot, academic 100·hot, product 0·miss, chat 100·hot, tech 100·hot | 4/5 |

Notes: light edits drop detection in 2/5 registers (blog, product-doc), showing
that a small human editing pass can move AI text under the analyzer's tells —
an expected, useful edited-AI signal. All edited rows are correctly labeled by
construction (revisions of known AI positives). **Verdict: genuine.**

## Summary

- Perfect-score positives audited: **genuine** (0 too-easy, 0 mislabeled).
- Missed positives audited: **genuine** false negatives (modern-AI evasion).
- False-positive negatives audited: **genuine** human, correctly labeled.
- Edited-AI audited: **genuine**.
- **No mislabeled or too-easy samples found.** The corpus is genuinely hard
  (overall TPR at 5% FPR is 0.0% — high-scoring human controls block low-FPR
  operation), which is the honest measure-only outcome motivating a future,
  separately-approved calibration delta.

## Post-calibration update (lexicon density_threshold 2.0 → 3.0)

After the calibration delta, this manifest is re-scored at the current analyzer
with `density_threshold = 3.0`. KO human FP is **14.0% (35/250)**, recall
unchanged at 59.2%. The earlier 16.8% figure reflected the 2026-05-22 analyzer;
re-scoring corrects it. The lexicon threshold change does **not** move KO FP —
KO false-positives are driven by the burstiness signal, which is intentionally
out of scope here and deferred to a separate burstiness-calibration delta. All
verdicts above stand (0 mislabeled, 0 too-easy).
