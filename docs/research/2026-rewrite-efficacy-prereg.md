# Pre-registration — Does patina rewrite actually reduce AI-likeness?

Status: **pre-registered plan** (hypotheses, metrics, decision rules fixed
before data collection). Registered 2026-07-10. Results land in a separate
`2026-rewrite-efficacy.md`; this file is not edited to match outcomes.

> Framing (per `docs/ROADMAP.md`): patina is an **AI-likeness humanizer**, not a
> detector-bypass product. "Efficacy" here means *reducing perceived AI-likeness
> while preserving meaning*, not defeating any specific detector. We borrow the
> measurement axes of TH-Bench (evasion/quality/overhead) but reframe axis 1 as
> *perceived humanness*, not adversarial evasion.

## Background & prior art

- Detection is already measured (`docs/research/2026-rebaseline.md`): overall AI
  catch 67.3% [63.5–71.0%], with a known weak cell (ko GPT-family 44%). What is
  **not** measured: whether the *rewrite* pass reduces AI-likeness on an
  independent yardstick. This program fills that gap.
- **LLM-judge self-preference bias** (arXiv:2410.21819): LLM judges over-rate
  low-perplexity / same-family text. Mitigation = cross-family judging + direct
  scoring over pairwise "pick the best." → We never let a rewriter's own family
  be its sole judge; we score each text independently and shuffle order.
- **Humanizer benchmarks / paraphrase attacks** (TH-Bench arXiv:2503.08708;
  DIPPER arXiv:2303.13408): consistent finding of an *evasion ↔ quality ↔ cost*
  trade-off — no tool wins all three. → We measure meaning preservation and
  human-control over-editing alongside any AI-likeness drop, so a "win" that
  guts meaning is caught.
- **Human perception cues** (arXiv:2505.01877; 2510.05136): humans key on
  sentence-length variability, vocabulary range, redundancy/repetition, and
  cultural/historical flattening. → These inform the mechanism regression (RQ3)
  feature set.
- **Korean-specific** (KatFish/KatFishNet, ACL 2025, arXiv:2503.00032): spacing,
  POS-combination, punctuation are the discriminative Korean signals. → ko
  mechanism features align to KatFish axes; our `katfish-calibration.mjs` is the
  bridge.

## Research questions & hypotheses

**RQ1 — Construct validity (run first; gates the rest).**
Is "AI-likeness" a stable construct across independent raters?
- H1: pairwise agreement (Spearman ρ / Krippendorff's α) among the three
  cross-family LLM judges, the deterministic stylometry score, and the patina
  internal score is > 0 and materially positive on the pilot set.
- **Decision rule:** if inter-judge α < 0.4 on the pilot, STOP the main study and
  redesign the instrument (the yardstick is too noisy to trust any efficacy
  claim). Report the failure rather than proceeding.

**RQ2 — Perceptual efficacy (primary).**
Does rewrite reduce *perceived* AI-likeness on independent judges?
- H2a: mean independent-judge AI-likeness(rewrite) < AI-likeness(original AI),
  reported as paired effect size (Cliff's δ) + 95% bootstrap CI.
- H2b: in a shuffled 3-way blind (original-AI / rewrite / real-human), the rate
  at which the rewrite is labelled "AI" is < half the original's rate.
- **Anti-circularity decision rule:** if the patina internal-score drop is large
  but the independent-judge drop is not (Δinternal − Δjudge exceeds the pilot's
  agreement band), we conclude patina is **gaming its own detector** and flag the
  rewrite pipeline for redesign — a headline finding, not a footnote.

**RQ3 — Mechanism.**
Which linguistic features drive the judge-perceived change?
- Regress per-text judge-score delta on feature deltas (burstiness /
  sentence-length variance, ending-suffix monotony [ko], type-token / MATTR,
  lexicon-marker count, patina pattern-hit count, ko: spacing & punctuation per
  KatFish). Report standardized coefficients.
- Output: ranked list separating *perceptually load-bearing* tells from
  *detector-only* tells → evidence-based pattern-pack priorities.

**RQ4 — Humanizer fingerprint (novel).**
Does rewrite impose a detectable convergent "house style"?
- H4: mean pairwise stylistic similarity among *rewrites* vs among *human
  controls*. If rewrites cluster tighter than humans, the humanizer leaves its
  own signature (a second-order AI tell). Descriptive + permutation test.

**RQ5 — Collateral (quality/meaning axis).**
- H5a: MPS & fidelity ≥ 70 on ≥ 95% of rewrites (meaning preserved).
- H5b: running rewrite on **human** controls does not push judge-rated writing
  quality down beyond a pre-set churn/quality band (over-editing risk = real
  usage failure).

## Design

Two-stage, pre-registered.

- **Study 0 (pilot):** ko + en, 10 AI + 5 human each (30 texts). Judges: 2
  cross-family. Purpose: validate the pipeline, estimate inter-judge agreement
  (RQ1) and Δ variance for a power calc. Gate for the main study.
- **Study 1 (main):** launched only if Study 0 passes RQ1. Size set by the
  pilot's observed variance; target ~110 AI (ko/en primary, 3 model families ×
  registers; zh/ja reduced cells) + ~55 human controls. Judges: 3 cross-family.

Corpus: reuse the labelled rebaseline intake (`artifacts/rebaseline-2025/`,
ko/en 130 each, stratified by model_family × register) + human controls; raw
text stays gitignored, only hashes/metadata/scores are committed.

### Anti-circularity & bias controls
1. Cross-family judging only; a generator family never its own sole judge.
2. Judges score each text **independently** (0–100), blind to condition and to
   whether patina produced it; 3-way identity task uses shuffled order.
3. Two judge sub-tasks kept separate: "is this AI-written?" vs "which do you
   prefer?" — so self-preference/perplexity bias is *measured*, not conflated
   with the efficacy signal.
4. patina internal score is reported as a **sanity axis only**, never the
   primary efficacy metric (it is the rewriter's optimization target).
5. Human anchor: maintainer blind-rates ~15 ko pairs; judge↔human concordance
   sets the trust ceiling on the LLM judges (issue #159 pilot; RQ1 cross-check).

## Metrics (fixed)
- Primary: independent-judge AI-likeness Δ (Cliff's δ + 95% bootstrap CI);
  3-way "AI"-label rate for original vs rewrite.
- Agreement: Spearman ρ + Krippendorff's α across raters (RQ1).
- Meaning: MPS, fidelity, dropped-number guard hit-rate.
- Collateral: edit churn; human-control judge-quality Δ.
- Mechanism: standardized regression coefficients (RQ3).
- Fingerprint: rewrite-vs-human pairwise style-similarity gap (RQ4).

## Success / failure criteria (pre-set)
- **Efficacy supported** iff H2a effect is negative with CI excluding 0 AND H2b
  holds AND the anti-circularity rule (RQ2) is NOT triggered AND H5a ≥ 95%.
- **Efficacy is a detector-gaming artifact** if the RQ2 anti-circularity rule
  triggers → redesign recommendation.
- **Instrument invalid** if RQ1 α < 0.4 → stop, redesign measurement.
- Every bounded cap / dropped cell / non-retry is logged; silent truncation is a
  protocol violation.

## Token budget & footprint
- Heavy work runs as background scripts calling local CLIs (claude/codex/gemini);
  the interactive session carries only summaries.
- Pilot (Study 0): ~0.3–0.5M tokens across local CLI subscriptions.
- Main (Study 1), if greenlit by the pilot: ~3–4M tokens, spread over hours.
- Go/no-go on the main study is made from pilot results, not assumed up front.

## Outputs
- `docs/research/2026-rewrite-efficacy.md` (cell tables + failure exemplars).
- Surviving-tell taxonomy → pattern-pack issues.
- Raw generations/judgments in gitignored `artifacts/`; only
  hashes/metadata/scores committed.

## Sources
- Self-Preference Bias in LLM-as-a-Judge — arXiv:2410.21819
- TH-Bench (humanizing attacks vs detectors) — arXiv:2503.08708
- Paraphrasing evades detectors (DIPPER) — arXiv:2303.13408
- Humans can learn to detect AI text — arXiv:2505.01877
- Linguistic Characteristics of AI-Generated Text: A Survey — arXiv:2510.05136
- KatFishNet (Korean detection, ACL 2025) — arXiv:2503.00032
