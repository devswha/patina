# Rebaseline EN Audit (measure-only)

Operator audit of perfect-score and boundary samples for the EN collection wave
(Wave 2). **Measure-only**: no detector threshold change, no `src/features`
change. Raw text stays in the gitignored `artifacts/rebaseline-2025/private/`
workspace; this report records only sample IDs, outcomes, and verdicts.

- Manifest: `artifacts/rebaseline-2025/manifest.en.scored.public.jsonl` (330 rows)
- Negatives: 200 natural-human from HAP-E (browndw/human-ai-parallel-corpus, MIT), balanced academic-summary / blog (the two registers `selectHapeEnglishControls` maps). Other registers have positives only → honest `no_negatives` in the B4 report.
- Positives: 120 `ai-like` across 3 model families (gpt 40 / claude 40 / gemini 40)
- Edited-AI: 5 `lightly-edited-ai` + 5 `heavily-edited-ai` (one light + one heavy per register)
- Score field: `patina_score` (deterministic analyzer); bimodal (0 or 100).

Verdict vocabulary: **genuine** / **too-easy** / **mislabeled** (see KO audit).

## Perfect-score positives (patina_score = 100)

107 of 120 `ai-like` rows score 100. Sample reviewed:

| sample_id | register | model_family | score | verdict |
|---|---|---|---:|---|
| rb26-en-gpt-001 | blog | gpt-family | 100 | genuine |
| rb26-en-gpt-002 | academic-summary | gpt-family | 100 | genuine |
| rb26-en-claude-001 | blog | claude-family | 100 | genuine |
| rb26-en-gemini-001 | blog | gemini-family | 100 | genuine |

Notes: authentic modern-assistant English — even rhythm, balanced hedging, no
generation artifacts or self-references. Correctly labeled. **Verdict: genuine
(0 too-easy, 0 mislabeled).**

## Boundary / missed positives (patina_score = 0, predicted_hot = false)

13 of 120 `ai-like` rows score 0 (claude 7 / gemini 4 / gpt 2). Sample reviewed:

| sample_id | register | model_family | score | verdict |
|---|---|---|---:|---|
| rb26-en-gpt-023 | product-doc | gpt-family | 0 | genuine (evasion) |
| rb26-en-gpt-033 | product-doc | gpt-family | 0 | genuine (evasion) |

Notes: terse, factual product-doc paragraphs that carry no lexicon/stylometry
tells. Correctly labeled AI; honest false negatives. Claude EN evades most
often (7/13). **Verdict: genuine.**

## False-positive negatives (natural-human, predicted_hot = true)

30 of 200 HAP-E human controls are flagged hot (15.0% FP), concentrated in
academic-summary. By construction these are the human half of the HAP-E parallel
corpus (genuine human academic/blog prose). The high score is a genuine detector
false positive on formal English academic writing, **not** a label error.
**Verdict: genuine human, correctly labeled; FP is a calibration signal (out of
scope here).**

## Edited-AI outcomes

| class | per-register outcomes (score / hot) | hot count |
|---|---|---:|
| lightly-edited-ai | blog 100·hot, academic 100·hot, product 100·hot, chat 100·hot, tech 100·hot | 5/5 |
| heavily-edited-ai | blog 0·miss, academic 100·hot, product 0·miss, chat 0·miss, tech 0·miss | 1/5 |

Notes: light edits stay fully detected, but heavy human rewrites drop detection
in 4/5 registers — a strong signal that substantial editing moves English AI text
under the analyzer's tells. Correctly labeled by construction. **Verdict: genuine.**

## Summary

- Perfect-score positives: **genuine** (0 too-easy, 0 mislabeled).
- Missed positives: **genuine** false negatives (modern-AI evasion; claude EN leads).
- False-positive negatives: **genuine** HAP-E human, correctly labeled.
- Edited-AI: **genuine**; heavy edits evade detection 4/5.
- **No mislabeled or too-easy samples found.** EN detection is stronger than KO
  (accuracy 85.8% vs 75.0%, recall 86.9% vs 59.2%), but low-FPR operation still
  collapses to TPR 0% overall — high-scoring human controls block a clean low-FPR
  point, the honest measure-only outcome.

## Post-calibration update (lexicon density_threshold 2.0 → 3.0)

After the calibration delta, this manifest is re-scored with
`density_threshold = 3.0`. EN human FP drops from **15.0% (30/200) to 5.0%
(10/200)** with AI recall unchanged at **86.9%**, and the 49 checked-in fixtures
stay 100% / ROC-AUC·PR-AUC 1.000. This is the lexicon calibration's clean win:
the lexicon signal was largely a false-positive generator for English, so
tightening its density gate cut FPs two-thirds with no recall cost. All verdicts
above stand (0 mislabeled, 0 too-easy).
