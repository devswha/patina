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

### Deviation 4 (2026-07-10) — the HAP-E `spok` register is not written prose

A rewrite failure led here, not a look at the effect sizes. The one Arm-A/B unit
whose rewrite kept dying (`claude exited with code 1`) turned out to be the
human side of the `spok` (spoken) register, which in HAP-E is degraded ASR
output — word salad, not writing:

> "No clue boots it on the live racist statue poor Lenny versus do something are
> the land upon density is it has unique Su Chuan be a playground party..."

Its AI counterpart is ordinary, coherent AI prose. So the `spok` cell does not
compare AI writing against human writing; it compares AI writing against a
corrupted transcript. Two consequences visible in the data:

- the judges split 86 (gpt) vs 0 (gemini) on that single passage — the widest
  disagreement anywhere in the pilot, and enough on its own to drag alpha down;
- its rewrite fails reproducibly (probably a safety filter on the garbled text),
  so the unit has no rewrite condition at all.

The construct under study is *the AI-likeness of prose*. It is undefined for a
passage that is not prose. `spok` is therefore excluded from Arms A and B.
(HAP-E's other spoken register, `tvm`, is coherent dialogue and stays in.)

**This is a post-hoc exclusion and is treated as one.** The criterion is a
property of the corpus, checkable without reference to any outcome, and it was
found through a crash rather than through inspecting effects. Even so, the
results report **both** analyses: primary (excluding `spok`) and sensitivity
(including it). If the two disagree, the disagreement is the finding.

Arm C is unaffected — its registers are drawn from the ko intake, which has no
`spok` cell.

## Study 1 (main study) — registered 2026-07-10, before any Study 1 data

Study 0 cleared the RQ1 gate (α 0.82/0.67/0.86, all arms above 0.4), so the main
study proceeds. This section fixes its design before the first corpus row or
judge call exists. Study 0's four deviations are inherited as design inputs, not
re-litigated.

### Arms

Study 1 is powered for **document length only** — the pilot already measured the
snippet penalty (α 0.82 → 0.67; effect −14 vs −22), so snippet arms are dropped
rather than re-run underpowered.

- **Arm A1 — en, document.** HAP-E paired on `prompt_id`, same substrate and
  filters as pilot Arm A (`spok` excluded per Deviation 4, sensitivity restored).
  Target n = 25 AI + 25 human (paired), disjoint from the pilot's items where the
  register spread allows.
- **Arm D — ko, document.** The pilot's blocking prerequisite, built new:
  - **Human side:** full-article documents (not paragraph snippets) from the 39
    vetted public ko sources in `artifacts/rebaseline-2025/sources.ko-public.jsonl`
    (5 registers). A document = consecutive accepted paragraphs of one page,
    ≥ 3 paragraphs, 1 200–4 000 chars. Raw text stays gitignored/private,
    hash-only redistribution — same policy as every prior corpus here.
  - **AI side, topic-paired:** for each human document, ONE AI document generated
    from its **public title + register + length band only** (the human text never
    enters the prompt), so topic and register are controlled by construction, as
    in HAP-E. Generation family rotates deterministically across
    gpt (codex CLI) / claude (claude CLI) / moonshot (kimi CLI) / xai (grok API),
    giving ~6–7 documents per family. claude-generated items are legitimate:
    the rewriter-family-vs-judge control lives in the panel, not the corpus.
- Target cell size: 20–30 (power from pilot Δ SDs); anything below 20 in a cell
  is reported as underpowered, not silently pooled.

### Judge panel (fixed up front, per the pilot's go/no-go conditions)

- **Panel: `judge-kimi` (moonshot) + `judge-gpt` (codex) + `judge-grok` (xai).**
  All three are cross-family to the rewriter (claude-cli, unchanged).
- **gemini is excluded before the first call**: its API project exhausted the
  monthly spending cap (429 RESOURCE_EXHAUSTED, probed 2026-07-10). This is a
  scheduled-recovery outage, not a judging decision; recorded here so panel
  composition cannot quietly follow quota luck mid-run, which is exactly what
  Deviation 3 was.
- **2-of-3 quorum:** a passage's panel score = mean of its parseable primary
  ratings; a passage-condition with < 2 ratings after top-up is reported as a
  data loss, never scored from a single judge.
- Quota headroom is probed on all three backends (a real judge-format call, not
  a ping) immediately before the recorded run; the probe results go in the run
  log.

### Outcomes (fixed)

1. **H2a (primary, per arm):** panel AI-likeness Δ on AI texts, paired, Cliff's
   δ + 95% bootstrap CI — same rule as Study 0.
2. **H2b:** AI-call rate on rewritten AI text < half the original's rate.
3. **H6 (new primary — structural-tell survival).** The pilot's headline was
   that surviving cues are architectural. Study 1 pre-registers it: each judge
   `strongest_cue` on a REWRITTEN AI passage is classified by a **deterministic
   keyword rubric fixed in the harness before any data** into
   `structure / lexical / specificity-absence / other`.
   - H6: `structure` is the **modal category** of surviving cues at document
     length, in both arms.
   - The rubric is code, not judgment: cue strings are matched case-insensitively
     against fixed keyword lists committed with the harness; unmatched cues fall
     to `other` and are listed verbatim in the results.
4. **RQ4 (house-style fingerprint)** re-run at n≈25: permutation test as in the
   pilot, now adequately powered for a directional answer.
5. **RQ5a/RQ5b** unchanged (gate pass-rate ≥ 95%; human-control collateral).
6. **Anti-circularity rule** unchanged and evaluated per arm.

### What Study 1 does NOT claim

- zh/ja: no document-length corpus exists in either language; out of scope,
  carried as a named gap exactly as ko was in Study 0.
- Modern-model coverage in Arm A1 is still bounded by HAP-E's single 2024
  generator; Arm D's rotated families carry the modern-model claim.
- Judge identity differs from Study 0 (gemini+kimi → kimi+codex+grok), so
  absolute score levels are not comparable across studies; only within-study
  paired deltas are interpreted.

## Study 2 (intervention study) — registered 2026-07-12, before any Study 2 data

Study 1's headline was that Korean document rewrites barely move perception
(Δ −6.0) and that 75–81% of surviving cues are structural. The
`ko-doc-structure` pack (6 document-architecture patterns, private pro pack,
authored 2026-07-10 from Study 1's cue evidence) is the designed response.
Study 2 measures whether it actually works — before any efficacy claim ships
in marketing or pack docs.

### Design

- **Intervention:** the `ko-doc-structure` pack installed into
  `custom/patterns/` (via the shipping `patina pack` path), which places its 6
  patterns into the live rewrite prompt. Everything else — corpus, rewriter
  (claude-cli), judge panel, prompts, analyzer stats — is identical to
  Study 1's Arm D.
- **Arm D2:** re-rewrite the SAME 54 Study 1 ko documents (27 AI + 27 human,
  by stored original text) with the pack active; judge each new rewrite with
  the same fixed 3-judge panel (kimi / gpt-5.5 / grok-4.5, 2-of-3 quorum).
  Originals are NOT re-judged: Study 1's original-condition ratings are reused
  as the shared baseline, so the paired comparison is
  Δ2(doc) = panel(rewrite₂) − panel(original₁) vs Δ1(doc) from Study 1.
- **Primary outcome (H-S2a):** paired per-document improvement
  d(doc) = Δ2 − Δ1 on AI documents; hypothesis mean d < 0 (the pack helps),
  95% bootstrap CI excluding 0.
- **Secondary (H-S2b):** among still-called-"ai" judgments on D2 rewrites, the
  structural share of strongest-cues (same fixed rubric) falls below 60%
  (Study 1: 81%).
- **Guard rails:** RQ5a gate pass-rate ≥ 95% must hold (structure edits are
  the riskiest for meaning); human-control Δ2 must not worsen beyond Study 1's
  band (over-editing check); rewrite length ratio reported.
- **Confound noted up front:** rewriter and judges are stochastic and two days
  have passed; the comparison is same-original paired but not same-run
  randomized. If d is small relative to rewrite-rerun noise, the honest read
  is "cannot distinguish from rerun variance" — a no-effect verdict, not a
  spin. (A same-run A/B was rejected for cost; this is a pilot-grade
  intervention estimate.)
- Quota headroom probed on all four backends immediately before the run
  (done 2026-07-12: codex, kimi, grok, claude all answered).

### What ships on the result

- d meaningfully negative → the pack's efficacy line in PRO-PACKS/marketing
  may cite it, with CIs and this registration.
- d ≈ 0 or positive → published as-is in the results doc; the pack docs must
  NOT claim measured efficacy, and the next iteration targets whatever the
  surviving cues say.

## Study 3 (structural-mechanism intervention) — registered 2026-07-12, before any Study 3 data

Study 2 rejected the prompt-text mechanism: describing document-architecture
patterns to the rewriter produced no perceptual improvement (paired d −0.7
[−3.4, +1.8]) and violated both guard rails (meaning gate 87.0%, all failures
dropped numbers; human-control over-editing d +5.1 [+0.3, +9.6]). Its results
doc names the design implication: structural humanization needs a
**structural mechanism**, not more prompt prose. Study 3 tests the first
candidate on that list — a pre-rewrite **structure plan step**.

### Design

- **Intervention — two-stage rewrite (plan → execute), same rewriter
  (claude-cli) for both stages:**
  1. **Plan stage:** the model receives the original document plus a fixed
     planning instruction and outputs a reorganization plan: explicit
     merge/split/reorder decisions, target paragraph-size asymmetry, which
     checklist/parallel structures to dismantle — under hard constraints
     written into the plan contract: every number, date, and named entity is
     enumerated in the plan and marked KEEP-verbatim; no new content units;
     no plan may delete a content unit (S2's failure mode was compression
     dropping facts).
  2. **Execute stage:** the model receives the original plus the plan and
     produces the rewrite by carrying out the plan. The plan text is recorded
     per row alongside the rewrite (auditable intermediate).
- **Arm D3:** re-rewrite the SAME 54 Study 1 ko documents (27 AI + 27 human,
  by stored original text). Panel, quorum, prompts, analyzer stats identical
  to Study 1/2 (kimi / gpt-5.5 / grok-4.5, 2-of-3). Originals are not
  re-judged: Study 1 original ratings remain the shared baseline, so
  d(doc) = Δ3 − Δ1, with Δ2 available as a descriptive second comparator only.
- **Primary outcome (H-S3a):** mean paired d on AI documents negative with
  95% bootstrap CI excluding 0 AND point estimate ≤ −5. The stricter point
  threshold is deliberate: the mechanism doubles per-document rewrite cost
  (2 LLM calls), so a sub-5-point gain does not justify shipping it.
- **Secondary (H-S3b):** structural share of strongest-cues among
  still-called-"ai" D3 judgments < 60% (S1: 81%, S2: 82%).
- **Guard rails (both must hold; a violation blocks shipping regardless of d):**
  1. meaning-safety gate pass ≥ 95% (≥ 52/54) — the direct test of the
     KEEP-verbatim plan contract against S2's dropped-numbers failure;
  2. human-control paired d must NOT be significantly positive (CI includes 0
     or is negative) — no repeat of S2's measured over-editing harm.
  Rewrite/original length ratio is reported per class (S2 mean 0.91).
- **Confound noted up front:** same as Study 2 — rewriter/judges stochastic,
  runs days apart; paired design absorbs document-level variance, not
  run-level drift. Near-zero d again reads as "indistinguishable from rerun
  variance", not spin.
- Runner: extends the Study 2 harness (fail-soft recorded rows,
  resume-by-original_sha); quota headroom on all judge backends probed
  immediately before the run, per S2 practice.

### What ships on the result

- All criteria pass → the plan-step mechanism graduates to a **product
  proposal** (candidate surfaces: a restructure option in
  the rewrite pipeline or a redesigned pro pack v2 that carries the plan
  contract) citing this registration and the measured CIs.
- H-S3a fails or a guard rail is violated → published as-is; next iteration
  falls to candidate 2 from the Study 2 results doc (deterministic structure
  transforms with LLM infill). No efficacy claim ships from a failed study.

No Study 3 corpus row, rewrite, plan, or judgment exists at registration time.

## Study 4 (specificity-preservation constraint, survey H-4b) — registered 2026-09-02, before any Study 4 data

Studies 2 and 3 tested structural mechanisms and both failed while dropping
content: S2/S3 compressed documents (length ratio ≈ 0.91) and lost numbers,
and Study 1's judges named *specificity* — named institutions, exact values,
first-person edge cases — as the cue that flips a verdict to "human". The
2026-09 literature survey (`humanization-literature-2026-09.md` §9, H-4b)
records the competing hypothesis this study tests: **the plain rewrite loses
Layer-4 material, and a length floor plus a retain-every-concrete-detail
constraint on the plain rewrite lowers perceived AI-likeness without any new
mechanism.** Owner decision 2026-09-02: this study runs ahead of the frozen
backlog order (steps 2–8), recorded in `humanization-data-backlog.md`.

### Design

- **Corpus (stage 1, ko):** the same 54 Study 1 Arm-D documents (27 AI +
  27 human) by stored original text (`original_sha`). **Stage 2 (en):** the
  42 Study 1 Arm-A1 documents (21 AI + 21 human), identical rules, run only
  after stage 1 completes and reported in the same results doc. Stage 2 is
  registered now so it cannot be dropped silently; it may be deferred with a
  dated note.
- **Two fresh arms per document, run back-to-back (P then S), same pinned
  rewriter** `claude -p --model claude-sonnet-4-6` in a fresh temp cwd (the
  S3 `claudeCall` shape, which is also the claude-cli backend's shape):
  - **P (plain):** the production minimal-mode prompt built by `buildPrompt`
    exactly as `patina --lang ko --backend claude-cli` builds it today
    (document type `default`, no persona, no register, measured document
    signals, `jargon: keep`, headings preserved). No retry.
  - **S (specificity):** the identical prompt with one fixed block spliced in
    immediately before the `## 출력 형식` (ko) / `## Output format` (en)
    section. **Enforcement is part of the mechanism:** if the extracted body
    is shorter than 98% of the original (characters, whitespace-collapsed),
    the model is re-prompted with the same prompt plus a fixed feedback suffix
    stating the measured ratio, at most **two** retries (three attempts). The
    last attempt is kept whether or not it meets the floor; attempt count and
    every attempt's ratio are recorded. P receives no retry.
  - Body extraction uses the production `cleanRewriteOutput`. Every row
    records the rewriter model, the prompt-template sha (prompt built on a
    fixed probe text, S3 style), the constraint-block sha and the retry-suffix
    sha. None of these texts may change after the first real row exists.
- **P today is not Study 1's rw1.** The production prompt changed twice since
  Study 1 (2026-07-28 no-invented-claims rule; 2026-08-05 voice-axis cutover),
  so the primary comparison is S vs P within this run. Comparisons to archived
  S1 rewrites are descriptive only and use the **gpt column alone**, the one
  judge common to S1, P and S.

### The constraint block (ko, verbatim; the en block is its direct translation and is stamped by sha in every row)

```
## 구체성 보존 (필수 — 위의 "±30%" 분량 규칙보다 우선한다)

1. 길이 하한: 다듬은 본문의 글자 수는 원문의 98% 이상이어야 한다. 군더더기를 걷어낸 자리는 요약이 아니라 같은 무게의 구체적인 표현으로 다시 채운다.
2. 원문에 있는 구체적 세부는 하나도 빠뜨리지 않는다: 숫자·날짜·단위·비율, 사람·기관·제품·기능·장소 이름, 인용구, 예시와 일화, 비유에 등장하는 대상. 여러 항목을 "등"이나 일반 명사로 뭉뚱그리지 않는다.
3. 원문에 없는 사실·숫자·이름·예시를 새로 만들어 넣지 않는다. 길이를 채우려고 지어내는 것은 금지다.
4. 다 쓰고 나서 원문과 나란히 대조해, 빠진 세부가 있으면 원래 자리에 되살린 뒤에 출력한다.
```

Retry suffix (ko, verbatim; `{ratio}` is the measured percentage):

```
## 재시도 사유

직전 출력은 원문 길이의 {ratio}%였다. 위 "구체성 보존" 규칙 1의 98% 하한을 지키지 못했다. 빠뜨린 구체적 세부를 되살리고 군더더기 자리를 같은 무게의 표현으로 채워, 원문 길이의 98% 이상으로 다시 출력하라. 새 사실을 지어내지 마라.
```

### Judges — panel v2 with a registered deviation

- **Chief judge-det:** `scoreText(lang)` with the fixed threshold 35. Before
  any binary det column is reported the run calls
  `requireFreshCorpusValidation` on det scores **recomputed at run time** over
  the 54 originals (labels from the corpus). Accuracy < 0.85 disables the
  binary column; continuous det scores stay reportable.
- **Perceptual corroboration:** `judge-gpt` (codex exec, gpt-5.5) and
  **`judge-gemini` (gemini-cli, gemini-2.5-pro, invoked with the production
  backend's arguments) in place of `judge-grok`.** Deviation cause, recorded
  before any row: the xAI API returned HTTP 403 "credits exhausted" on
  2026-09-02 (probe logged). If xAI credit is restored before the first Study
  4 row, grok is used and this deviation is void; a dated note records which
  path ran.
- **Gemini admission rule (bridge, run before any Study 4 row, not study
  data):** gemini scores the 108 archived S1-D passages (54 originals + 54
  S1 rewrites) with the Study 1 judge prompt. Gemini is admitted iff (a) its
  AUC separating the 27 AI from the 27 human originals is ≥ 0.85 (mirrors the
  det gate) AND (b) Spearman(gemini, gpt) over the 108 passages ≥
  Spearman(grok, gpt) over the same 108 − 0.10 (both reference columns exist
  in the archived rows). If gemini fails admission, the study runs with gpt +
  det only and the results doc is labelled *single-perceptual-judge*.
- Both admitted LLM judges are required per passage; a missing or
  unparseable judge after three attempts is data loss, never silently reduced
  to one judge. Originals are not re-judged; rewrites are claude output, so
  both LLM judges are cross-family for every rewrite.

### Metrics (fixed)

- **Perceptual score** = mean of the admitted LLM judges' 0–100 AI-likeness.
- **Primary (H-4b-a):** paired d = score(S) − score(P) on AI documents. Support
  requires **mean d ≤ −3 AND the 95% bootstrap CI upper bound < 0.** Bar
  justification: the mechanism adds no LLM call (only capped retries), so
  Study 3's −5 (set for a doubled-cost mechanism) is not the right bar; −3 is
  the smallest effect separable from per-judge repeat SD (2–5 in the
  calibration study) at n = 27.
- **Secondary:** (b) AI-call rate S vs P on AI documents (McNemar); (c)
  detail-token retention S vs P (definition below); (d) floor achievement:
  share of S rows with final length ratio ≥ 0.98 (target ≥ 80%; below it the
  enforcement itself failed and (a) is read with that caveat); (e) det chief
  continuous delta S − P and verdict flips; (f) structural share of
  strongest-cues among still-"ai" judgments (descriptive, S1 rubric); (g)
  descriptive gpt-only comparison of S and P with archived S1 rw1.
- **Detail tokens (frozen):** text is NFC-normalized and whitespace-collapsed.
  (1) numbers: `/\d[\d,.]*(?:\s?(?:%|[A-Za-z]{1,4}|[가-힣]{1,2}))?/gu`, then
  thousands separators removed; (2) Latin tokens:
  `/[A-Za-z][A-Za-z0-9+._-]+/gu`, lower-cased; (3) quoted spans: the inner
  text of `/[“"‘'「『]([^”"’'」』\n]{2,60})[”"’'」』]/gu`. Each text yields a
  unique set. Retention = |orig ∩ rewrite| / |orig| (documents with an empty
  original set are excluded from the mean and counted). Added =
  |rewrite − orig|.

### Guard rails (any violation blocks shipping regardless of d)

1. Deterministic meaning gate (`deterministicMeaningGuard`, dropped numbers)
   passes on ≥ 95% of S rows (≥ 52/54).
2. Human-control paired d(S − P) is not significantly positive (CI includes 0
   or is negative): a length floor must not push human text toward AI.
3. **Invented-content proxy:** mean added detail tokens per document in S
   must not exceed P's by more than 1.0. A length floor invites padding; the
   meaning gate only catches *dropped* numbers, this catches *added* ones.
4. **Copy check (descriptive, reported):** character-trigram Jaccard between
   original and rewrite for P and S. If S's median exceeds 0.90 while P's does
   not, "preserved specificity" is read as "rewrote less", and the results doc
   says so beside the primary result.

### Confounds noted up front

Rewriter and judges are stochastic; the two arms run back-to-back per
document so run-level drift is shared, but the judge panel differs from the
archived series (gemini for grok) and the production prompt differs from
Study 1, so only within-run S vs P is confirmatory. Near-zero d reads as
"indistinguishable from rerun variance".

### Runner

Clone of the Study 3 harness: fail-soft recorded rows, resume by
`original_sha` + arm, three-failure circuit breaker, a supervisor loop with a
30-minute back-off, and quota probes on claude, codex and gemini logged
immediately before launch. Plumbing is smoke-tested on a synthetic paragraph,
never on a corpus document. Raw texts stay in gitignored
`artifacts/rewrite-efficacy-study4/`; rows carry hashes, scores and metadata
only.

### What ships on the result

- All criteria pass (stage 1) → a product proposal to fold the constraint
  block into the production rewrite prompt (minimal and strict modes) for ko,
  with the en decision waiting on stage 2, citing this
  registration and the measured CIs.
- H-4b-a fails or a guard rail is violated → published as-is; the next
  candidate is H-4a (deterministic merge/split with seam-only infill). No
  efficacy claim ships from a failed study.

No Study 4 corpus row, rewrite, or judgment exists at registration time.

### Study 4 — dated note 2026-09-02 (before the first row): gemini failed admission, running single-perceptual-judge

The registered bridge ran on the 108 archived S1-D passages (`artifacts/rewrite-efficacy-study4/bridge-verdict.json`): gemini-2.5-pro AUC on the 54 originals **0.556** (gpt 0.995, grok 0.967); Spearman(gemini, gpt) **0.137** vs Spearman(grok, gpt) 0.857 on the same passages. Both admission conditions fail, so per the registered fallback stage 1 runs with **judge-gpt + judge-det only** and the results doc is labelled *single-perceptual-judge*. xAI credit was not restored before launch. If it is restored later, grok may score the stored P/S bodies as a post-hoc corroboration column, labelled as collected after the run; it cannot enter the primary metric.

### Study 4 — amendment 2026-09-02 (recorded before any Study 4 judge outcome was read): second-judge candidates without xAI credit

The owner asked for a second perceptual judge that does not need xAI credit.
Recorded before the bridges run and before this session has read any Study 4
per-document judge score (the run log is filtered to loop-level lines):

- Candidates, all cross-family for claude rewrites, reached through the
  OpenAI-compatible API endpoints patina's providers already use:
  `gemini-3.7-flash`, `gemini-3.1-pro-preview`, `deepseek-v4-pro`, `kimi-k3`.
  Each is bridged exactly like gemini-2.5-pro (108 archived S1-D passages,
  Study 1 judge prompt) under the **same registered admission rule** (AUC on
  the 54 originals ≥ 0.85 AND Spearman with gpt ≥ Spearman(grok, gpt) − 0.10).
- Selection rule, fixed now: among admitted candidates, the one with the
  highest AUC on the originals; ties broken by Spearman with gpt. Exactly one
  candidate is added, so the panel stays two LLM judges + det.
- The admitted judge scores **every** P and S body from the stored private
  texts, including rows finished before admission, and the run continues with
  both judges for the remaining rows. The primary metric is then the two-judge
  mean; if no candidate is admitted, stage 1 stays single-perceptual-judge.
- Bridge rows and verdicts for every candidate are kept
  (`artifacts/rewrite-efficacy-study4/bridge-*.jsonl`, `bridge-verdict-*.json`);
  the results doc reports all of them, admitted or not.

### Study 4 — dated note 2026-09-02 (after the candidate bridges, before any Study 4 judge outcome was read): `judge-gemini-3.7-flash` admitted and selected

Bridge results on the 108 archived S1-D passages (reference on the same passages: gpt AUC 0.995, grok AUC 0.967, Spearman(grok, gpt) 0.857; admission needs AUC ≥ 0.85 and Spearman with gpt ≥ 0.757):

| candidate | scored | AUC (54 originals) | Spearman vs gpt | Spearman vs grok | admitted |
|---|---:|---:|---:|---:|---|
| gemini-3.7-flash (API) | 108/108 | **1.000** | **0.884** | 0.794 | yes |
| gemini-3.1-pro-preview (API) | 108/108 | 0.971 | 0.849 | 0.790 | yes |
| deepseek-v4-pro (API) | 49/108 | incomplete (5 consecutive unparseable replies stopped the bridge) | 0.696 (partial) | 0.690 (partial) | no — incomplete at decision time |
| kimi-k3 (API) | 0/108 | account suspended for insufficient balance (HTTP 429) | — | — | not bridged |
| gemini-2.5-pro (CLI, original deviation) | 108/108 | 0.556 | 0.137 | 0.233 | no |

Selection rule (highest AUC among admitted) picks **`judge-gemini-3.7-flash`**. From this note on, stage 1 is a two-judge panel (`judge-gpt` + `judge-gemini-3.7-flash`) plus det: the admitted judge scores every stored P/S body from rows finished so far, and the runner is restarted with both judges for the remaining rows. The results doc drops the *single-perceptual-judge* label and reports every candidate above. The deepseek bridge may be resumed for the record only; it cannot change the selection.

### Study 4 — dated note 2026-09-04 (before any stage 2 row): stage 2 (en) started on the owner's instruction

Stage 1 (ko) closed on 2026-09-03 with H-4b not supported. The owner asked to resume; stage 2 runs under the identical registered rules. Before the first row: (1) the 42 Arm-A1 documents inherit Study 1's `spok` exclusion (pilot Deviation 4); (2) the second-judge seat is re-bridged on the 84 archived Arm-A1 passages (42 originals + 42 S1 rewrites) with the English judge prompt under the same admission rule — `judge-gemini-3.7-flash` was admitted on Korean only. The bridge verdict is recorded in `artifacts/rewrite-efficacy-study4/bridge-en-verdict-gemini-3.7-flash.json`; if it fails, `judge-gemini-3.1-pro` is bridged next, and if neither passes stage 2 runs single-perceptual-judge as registered. Plumbing is smoke-tested on a synthetic English paragraph only.

### Study 4 — dated note 2026-09-04 (before any stage 2 row): stage 2 judge seat

EN bridge on the 84 archived Arm-A1 passages: `judge-gemini-3.7-flash` (Gemini API, the local research key — not the product keys, which the owner rotated to product-only use the same day) scored 84/84, **AUC 0.994**, Spearman vs gpt **0.911** (reference: gpt AUC 1.000, grok AUC 0.998, Spearman(grok, gpt) 0.894) — admitted. A subscription-only transport of the same model (`judge-gemini-3.7-flash-cli`, gemini CLI) was bridged in parallel to avoid API-key use; it produced 8/84 scores and then timed out three times in a row on consecutive passages (180 s each), so it is **not admitted** and its partial rows are discarded. Stage 2 therefore runs with the same two-judge panel as stage 1: `judge-gpt` + `judge-gemini-3.7-flash` (API) plus the det chief.

### Study 4 — correction 2026-09-04: the "CLI" gemini transport was also API-key authenticated

On this machine the gemini CLI's effective auth is `gemini-api-key` (`~/.gemini/settings.json` → `security.auth.selectedType`) and `GEMINI_API_KEY` is exported in the login shell, so every gemini CLI call in this study — the 2026-09-02 gemini-2.5-pro bridge (108 passages) and the 2026-09-04 `judge-gemini-3.7-flash-cli` bridge (8 passages before timeouts) — was billed to the local research key, not to a subscription. The earlier notes' "subscription-only" wording for that transport is withdrawn; the transports differ only in sampling defaults. Nothing about the admitted judge, the panel, or any row changes.

### Study 4 — dated note 2026-09-04 (after stage 2): stage 2 closed; detail-token definition flaw on English

Stage 2 (en, 42/42) closed **not supported** (paired d +3.7 [−3.5, +10.8]; det +12.1 [+4.5, +20.6]; floor met 42/42; meaning gate 38/42 violated). Post-hoc observation, not a criterion change: the registered detail-token regex `[A-Za-z][A-Za-z0-9+._-]+` matches every English word, so H-4b-c retention and guard rail 3 are vocabulary-overlap measures on English and are reported as such in the results doc. Both stages are complete; nothing ships; the next candidate is H-4a.

## Sources
- Self-Preference Bias in LLM-as-a-Judge — arXiv:2410.21819
- TH-Bench (humanizing attacks vs detectors) — arXiv:2503.08708
- Paraphrasing evades detectors (DIPPER) — arXiv:2303.13408
- Humans can learn to detect AI text — arXiv:2505.01877
- Linguistic Characteristics of AI-Generated Text: A Survey — arXiv:2510.05136
- KatFishNet (Korean detection, ACL 2025) — arXiv:2503.00032
