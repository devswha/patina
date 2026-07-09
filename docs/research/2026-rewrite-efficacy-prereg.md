# Pre-registration — Does patina rewrite actually reduce AI-likeness?

This is a plan, written down on 2026-07-10, before any of the data existed. The
hypotheses, the metrics, and the rules for calling the thing a success or a
failure are all fixed here so that none of them can quietly move once the numbers
come back. Results go somewhere else — `2026-rewrite-efficacy.md`. Nothing below
gets edited to match what we find. Deviations get appended, dated, and explained.

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

**RQ1 — Construct validity.** Run this first. Everything downstream depends on
whether "AI-likeness" even holds still when different raters look at it.
- H1: pairwise agreement (Spearman ρ / Krippendorff's α) among the three
  cross-family LLM judges, the deterministic stylometry score, and the patina
  internal score is > 0 and materially positive on the pilot set.
- **Decision rule:** if inter-judge α < 0.4 on the pilot, STOP the main study and
  redesign the instrument (the yardstick is too noisy to trust any efficacy
  claim). Report the failure rather than proceeding.

**RQ2 — Perceptual efficacy.** The primary question, and the one patina exists
to answer: does a rewrite read less like a machine to someone who wasn't told?
- H2a: mean independent-judge AI-likeness(rewrite) < AI-likeness(original AI),
  reported as paired effect size (Cliff's δ) + 95% bootstrap CI.
- H2b: in a shuffled 3-way blind (original-AI / rewrite / real-human), the rate
  at which the rewrite is labelled "AI" is < half the original's rate.
- **Anti-circularity decision rule:** if the patina internal-score drop is large
  but the independent-judge drop is not (Δinternal − Δjudge exceeds the pilot's
  agreement band), we conclude patina is **gaming its own detector** and flag the
  rewrite pipeline for redesign — a headline finding, not a footnote.

**RQ3 — Mechanism.** Suppose the needle moves. What actually moved it?
- Regress per-text judge-score delta on feature deltas (burstiness /
  sentence-length variance, ending-suffix monotony [ko], type-token / MATTR,
  lexicon-marker count, patina pattern-hit count, ko: spacing & punctuation per
  KatFish). Report standardized coefficients.
- Output: ranked list separating *perceptually load-bearing* tells from
  *detector-only* tells → evidence-based pattern-pack priorities.

**RQ4 — Humanizer fingerprint.** Barely studied, and the one that would embarrass
us most: a tool that scrubs every text into the *same* voice has not removed the
machine, it has replaced one machine with another.
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

## Deviations from the registered plan

Recorded as they happen, before the affected data is collected. The original
text above is not edited.

### Deviation 1 (2026-07-10) — stimulus length invalidates the planned substrate

A 2-unit end-to-end smoke run of the pilot harness surfaced three problems with
using the rebaseline intake as the efficacy substrate. All are **stimulus**
problems, not construct problems, and would have produced an uninterpretable
RQ1 failure ("the instrument is invalid") when the real cause was "the passages
are too short to judge."

1. **The corpus is paragraph-snippets, not documents.** ko AI: median 154 chars
   (max 207). ko human controls: median 129. en AI: median 424. No sample in
   `intake.*` has ≥ 3 paragraphs.
2. **patina's own analyzer skips them.** `analyzeText` returns
   `skipReason: paragraphs<=2`, so the internal sanity axis degenerates to a
   1-paragraph 0-or-100 hot ratio. It cannot be compared against a graded judge
   score.
3. **Judges disagree wildly at this length.** On one 95-char human control the
   two cross-family judges returned AI-likeness 24 ("human") and 75 ("ai").
   Snippet-level judging is dominated by noise, exactly as the human-perception
   literature predicts for short excerpts.

Additionally, the labelled ko AI snippets were rated 32 / 12 (both "human") by
the judges — the corpus's own AI class is not perceived as AI-like at snippet
length. Any "rewrite reduced AI-likeness" claim measured from that floor would
be meaningless.

**Amended design.** The pilot is restructured into three arms, and the stimulus
length itself becomes a measured moderator rather than an uncontrolled flaw:

- **Arm A — instrument validation (en, document length).** Substrate switches to
  the external, MIT-licensed **HAP-E** parallel corpus already present at
  `artifacts/rebaseline-2025/private/hape-en.private.jsonl`: 8,290 human /
  8,290 AI passages, **paired on `prompt_id`** (so topic *and* register are
  controlled by construction), 6 registers, median 2,689 (human) / 3,300 (AI)
  chars. This is the primary RQ1/RQ2 arm.
- **Arm B — stimulus-length moderator (en, snippet length).** The same judges
  rate the short en intake snippets (median 424 chars). Comparing inter-judge
  agreement α_doc (Arm A) vs α_snippet (Arm B) *quantifies* how much of the
  disagreement is a length artifact. This converts Deviation 1's discovery into
  a reportable result.
- **Arm C — ko, snippet length, explicitly limited.** No document-length Korean
  substrate exists in this repository. ko runs at snippet length and its
  conclusions are **interpreted only through Arm B's measured length penalty**.
  ko human controls are drawn from `web-human-controls.generated.private.jsonl`
  (250 rows, register-matched 50× each across the same 5 registers as the ko AI
  set) to remove the register confound present in the 25-row control file.

**Known limitation introduced.** HAP-E's AI side is a single 2024 model
(`gpt-4o-2024-08-06`), so Arm A cannot speak to modern-model AI-likeness. Arm A
answers "is the instrument valid and does rewrite move the needle at document
length"; modern-model coverage stays with the (snippet-bound) Arms B/C until a
document-length modern corpus exists.

**Blocking future work (now a named gap).** A document-length Korean corpus —
AI-generated across model families and human-authored controls, register-matched
— does not exist here. It is a prerequisite for any credible Korean rewrite
claim, and plausibly explains part of the weak ko cell in the detection
rebaseline. Filed as follow-up.

### Deviation 2 (2026-07-10) — judge-response loss was silently biasing RQ1

Mid-pilot inspection of the first 18 judge calls found an 11% unparseable rate on
one judge (gemini) from two causes: a 240 s timeout on a 3.5 k-char document, and
**schema drift** — the judge returned a valid 0-100 rating under the key
`ai_status` instead of the requested `ai_likeness`, and the parser discarded it.

This is not a cosmetic loss. Krippendorff's alpha needs *both* judges on the same
passage, so every dropped rating destroys an entire agreement unit, and the drops
are not random: they concentrate on whatever that judge found hard to answer.
RQ1 — the gate for the whole program — would have been estimated on a filtered,
easier subset.

Amended before the affected data was analysed:
- the judge parser accepts an explicit alias set for the score key
  (`ai_likeness`, `ai_status`, `ai_score`, `score`, `aiLikeness`) and records
  which key was used (`score_key`) so drift stays visible rather than silent;
- it anchors on the `authorship` field and takes the last JSON object, so a judge
  that narrates before answering (or wraps in a code fence) still parses;
- each judge call gets one retry; residual failures are recorded with
  `retries_exhausted` and reported in the results before any effect estimate;
- the judge timeout rises 240 s -> 360 s for document-length passages.

Ratings collected under the old parser were **discarded** and all arms re-run from
scratch: mixing parser versions inside one dataset means inconsistent inclusion
criteria, which is exactly what a pre-registered protocol exists to prevent.

### Deviation 3 (2026-07-10) — the gpt judge exhausted its quota mid-pilot

Partway through Arm A the `codex` CLI began returning
`ERROR: You've hit your usage limit` on stdout. The harness recorded eight cells
as "unparseable" without keeping the reply, so the cause was invisible until the
backend was probed by hand. Two fixes, both applied before the affected data was
analysed:

1. **Panel substitution.** The primary judge panel becomes **gemini + kimi**
   (Moonshot). Both remain cross-family with respect to the rewriter (claude), so
   the self-preference control of the registered design is intact. Every passage
   in every arm is re-rated so the panel is uniform across A, B and C; a panel
   that changed halfway through would make agreement statistics meaningless.
2. **The `judge-gpt` ratings already collected are kept, untouched, as a partial
   third rater.** They are reported separately with their coverage stated, never
   merged into the primary panel — mixing raters across a partially-observed cell
   is how a filtered subset masquerades as a complete one.

Two harness defects surfaced with it and are fixed:
- a failed judge call blanked its own reply, so a backend *quota error* was
  indistinguishable from a model *formatting error*. The tail of the last reply
  is now retained;
- child processes were killed individually rather than by process group, so the
  local CLIs' helper processes survived as orphans and blocked the next
  invocation of the same CLI. One reaped orphan took Arm A from 26 minutes per
  unit back to 2.5. Both harnesses now kill the group.

**Limitation this introduces.** Judge identity is confounded with time: the
gemini + kimi panel rated some passages minutes after the original run, and kimi
never saw the passages under the same conditions codex did. The pilot's purpose
is to size variance and validate the instrument, not to publish an effect, so the
confound is acceptable here and must not carry into the main study — which will
fix its panel up front and verify quota headroom before the first call.

## Sources
- Self-Preference Bias in LLM-as-a-Judge — arXiv:2410.21819
- TH-Bench (humanizing attacks vs detectors) — arXiv:2503.08708
- Paraphrasing evades detectors (DIPPER) — arXiv:2303.13408
- Humans can learn to detect AI text — arXiv:2505.01877
- Linguistic Characteristics of AI-Generated Text: A Survey — arXiv:2510.05136
- KatFishNet (Korean detection, ACL 2025) — arXiv:2503.00032
