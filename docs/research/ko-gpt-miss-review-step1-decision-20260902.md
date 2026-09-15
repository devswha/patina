# KO GPT-family miss-review manifest — step-1 review decision (2026-09-02)

Status: **GO (measure-only)** — external review complete; no collector, manifest, taxonomy, threshold, pattern, lexicon, or runtime change was made in this step.
Roadmap: step 1 of the frozen performance-only order in `humanization-data-backlog.md`. Steps 2–8 stay inactive.

This record separates two voices on purpose: what the external reviewer said, and what the executing maintainer session concludes from it. Nothing below changes production behaviour.

## Review setup

- Reviewer: GPT-5.6 Sol (Pro), via the Sol review lane, two messages in one conversation (message 1: verdict, data contract, traps; message 2: taxonomy, procedure, acceptance criteria).
- Context packed: 22 tracked files from a sanitized detached worktree of `dev` (tracked files only; `.env.example` removed from the worktree so the lane's secret guard passed). Exclusions: none from the handoff's required set. The pack was ~49.5K tokens.
  - decision/evidence: `docs/research/humanization-data-backlog.md`, `2026-rebaseline.md`, `docs/benchmarks/rebaseline-audit-ko-latest.md`, `rebaseline-ko-latest.md`, `ko-confirmatory-verdict-20260901.md`, `ko-performance-improvement-handoff-20260818.md`, `2026-rewrite-efficacy.md`, `2026-rewrite-efficacy-study3.md`
  - deterministic boundaries: `src/features/index.js`, `korean-diagnosis.js`, `korean-invariants.js`, `korean-structure-fingerprint.js`
  - manifest/intake contracts and tests: `scripts/rebaseline-intake.mjs`, `rebaseline-build-claim-manifest.mjs`, `rebaseline-generate-modern.mjs`, `tests/quality/rebaseline-manifest.example.jsonl`, `tests/unit/rebaseline-intake.test.js`, `rebaseline-build-claim-manifest.test.js`, `rebaseline-generate-modern.test.js`, `korean-diagnosis.test.js`, `korean-invariants.test.js`, `korean-structure-fingerprint.test.js`
- Raw response artifacts and the conversation URL are kept in the maintainer-private records repository (`sol-reviews/`), not here.

## What the reviewer said (message 1)

**Verdict: GO.** The KO GPT-family cell misses 56 of 100 samples (`2026-rebaseline.md:74`: 44.0% catch, CI 34.7–53.8%), so measuring and decomposing that failure set before any change is the correct highest-priority task.

**Row-level data contract** (public JSONL; every field required unless marked optional):

| field | type / allowed values | invariant and source |
|---|---|---|
| `schema` | literal `ko-gpt-miss-review.v1` | versioned like `koDiagnosis.v1` (`korean-diagnosis.js:4`) |
| `sample_id` | non-empty, unique | copied from the scored manifest; duplicates are errors (`rebaseline-build-claim-manifest.mjs:66-71`) |
| `language` / `class` / `model_family` | literals `ko` / `ai-like` / `gpt-family` | the cell is never re-labelled |
| `register` | `blog` \| `academic-summary` \| `product-doc` \| `chat-update` \| `technical-how-to` | the generation matrix (`rebaseline-generate-modern.mjs:21`) |
| `provider` / `model` | verbatim from the row (currently `codex-cli` / `gpt-5.5`) | `rebaseline-generate-modern.mjs:32-37` |
| `generated_at` / `prompt_id` / `decoding` / `postprocess` | ISO date / string / object / object | copied losslessly (`rebaseline-generate-modern.mjs:229-241`) |
| `expected_hot` / `predicted_hot` | literal `true` / literal `false` | the mechanical definition of a miss (`rebaseline-audit-ko-latest.md:35-38`) |
| `patina_score` / `score_review` | number in [0,100] / object | copied, never recomputed during review |
| `redistribution` / `text_hash` | literal `hash-only` / `sha256:<64 hex>` | no `text` field; intake deletes private text and rejects hash mismatches (`rebaseline-intake.mjs:95-109`) |
| `source_review` | `{status, rationale}` non-empty | provenance for non-public rows (`rebaseline-intake.mjs:110-118`) |
| `source_doc` | literal `docs/research/2026-rebaseline.md` | claim surface |
| `source_manifest` / `source_manifest_hash` | manifest path / SHA-256 of its bytes before selection | freezes the corpus |
| `analysis_provenance` | `{git_commit, options_hash, analyzed_at, normalized_text_hash, signals_hash}` | analyzer options and NFC input fixed (`index.js:75-78`) |
| `analysis_role` | literal `discovery-only` | these hashes are never reused for performance validation |
| `reviewer` / `reviewed_at` | pseudonymous string / ISO-8601 | no real names |
| `taxonomy_version` / `miss_reason` | version string / `^[a-z][a-z0-9-]{0,63}$` from that version's code list | per-row reviewer reason is required (`humanization-data-backlog.md:50-53`) |
| `reviewer_notes` | 1–1000 chars, paraphrase only | no quotation, no distinctive phrases, no PII |
| `meaning_checks` (optional) | `{mps_proxy, fidelity}` numbers or null | meaning checks, never naturalness labels |
| `signals` | source-free projection produced by the fixed analyzer (document, paragraphs, advisory, diagnosis blocks) | valid only if `signals.document.hot === predicted_hot === false`; diagnosis signal IDs limited to the fixed set in `korean-diagnosis.js:16-33`; no source text, spans, or matched tokens stored |

**Three most damaging traps and their controls:**
1. *Discovery-corpus reuse / threshold overfitting* — finding causes on these misses and then claiming improvement on the same hashes is circular. Control: `analysis_role: discovery-only`, frozen corpus/config hashes, and any later change evaluated only on a confirmatory corpus that excludes these `text_hash`es (consistent with `humanization-data-backlog.md:50-53, :166`).
2. *Register and model-family confounds* — KO catch differs by family (Claude 68%, Gemini 62%, GPT 44%; `2026-rebaseline.md:72-74`) and register FN spans 26.9–69.2% (`rebaseline-ko-latest.md:124-130`). Control: `register` and `model_family` are immutable fields; aggregate only per register; never generalize from this cell to all of KO or to other families.
3. *Unblinded label and private-text leakage* — a reviewer who already knows a row is a genuine false negative and sees text plus signals will rationalize; copying phrases into notes leaks the private corpus. Control: hide outcome/model/signal columns at first observation; public artifacts carry hashes, bounded scalars, rule IDs, and paraphrase only; MPS/fidelity stay in `meaning_checks`.

## What the reviewer said (message 2)

**Root-cause taxonomy.** Precondition for every row: `expected_hot=true`, `predicted_hot=false`, `signals.document.hot=false` (the document verdict is the OR at `src/features/index.js:215`); rows that violate it are invalid, not classified. For each row, freeze the active analyzer options (`burstinessBands`, `mattrBands`, `koDiagnosticBands`, `koEndingMonotonyBands`, `lexiconDensityThreshold`, `lexiconMinHotMatches`; `index.js:56-70`) and compute a normalized *gate deficit* per signal family (burstiness, MATTR, lexicon, KO diagnostics, structure): `max(0,(T−x)/|T|)` for `x ≥ T` gates, `max(0,(x−T)/|T|)` for `x < T` gates, `+∞` when the value or pattern is absent; AND gates take the max, OR gates and multiple paragraphs take the min. A review-only constant `NEAR = 0.10` is fixed in advance and never fed back into thresholds. Assign the first matching code, in this order:

| `miss_reason` | rule |
|---|---|
| `multi-threshold-near` | two or more families within NEAR; record `near_families` and all margins |
| `threshold-near-burstiness` | only burstiness within NEAR (standard CV gate incl. its minimum sentence count, plus the KO ending-monotony AND gate; `index.js:131-159`) |
| `threshold-near-mattr` | only MATTR within NEAR (`index.js:136-137,170-173`) |
| `threshold-near-lexicon` | only lexicon within NEAR (density and hot-match count vs. their thresholds; impossible with zero pattern hits; `index.js:161-165`) |
| `threshold-near-ko-diagnostics` | exactly one KO diagnostic rule within NEAR, from its scalar and `koDiagnosticBands` (`index.js:139-144,173-175`; IDs serialized as `rhythm:<reason>`, `korean-diagnosis.js:24-26`) |
| `threshold-near-structure` | only structure within NEAR: min deficit over candor count/2, thematic-break count/3, structural-classifier score/threshold (`index.js:85-92,166-169`) |
| `threshold-far` | no family within NEAR but `min(d) < 1`; record `closest_family`, do not read it as a threshold fix |
| `advisory-only-coverage-gap` | all deficits ≥ 1 or ∞ and only translationese / post-editese rule counts exist (advisory signals deliberately outside `hot`, `index.js:93-98`) |
| `no-modeled-signal` | all deficits ≥ 1 or ∞ and no advisory rule either: the current signal surface has nothing that explains the miss |

`skipReason` is never a root cause (skips are advisory; signals are computed unconditionally, `index.js:113-115`). Diagnosis signal IDs are only the code-generated set (`korean-diagnosis.js:18-33`).

**Sampling and reviewer procedure.** (1) Freeze the population: SHA-256 of `rebaseline-2026.scored.public.jsonl`, then select `language=ko`, `class=ai-like`, `model_family=gpt-family`, `expected_hot=true`, `predicted_hot=false`. The cell currently holds 56 misses out of 100 (`2026-rebaseline.md:74`), so all 56 are reviewed with no sampling. (2) Only if the population ever exceeds 100: strata `(model_family, provider, model, register)`, one seat per non-empty register, remainder by Hamilton largest-remainder on miss proportions, within-stratum order by `SHA256(corpus_hash + "\0" + sample_id)`. (3) Two independent reviewers, each with their own `SHA256(corpus_hash + reviewer_id)` permutation; they see only `blind_id`, the scalar signal projection, the active gate settings, and the computed family margins. `sample_id`, register, provider/model, prior scores/outcomes, MPS/fidelity, and raw text are hidden; the reviewer locks `miss_reason` by the decision tree only. Original ID order is not a review order (generation IDs cycle through registers, `rebaseline-generate-modern.mjs:96-101`). (4) Raw text is never used for the taxonomy verdict. After locking, an authorized reviewer may consult the gitignored private corpus only for source-integrity checks or extraction anomalies, re-verifying `text_hash` first and logging `raw_text_accessed`, purpose, and reviewer; no copying, quoting, or new sidecars. (5) Disagreements: keep both original labels and margins with `disagreement=true`; recompute margins with the same code; regenerate on extraction/config errors; otherwise a third reviewer adjudicates from the same blinded view; `final_reason` and rationale are recorded separately; any unresolved row blocks the whole artifact.

**Acceptance criteria (step 1 is done only when all hold).** Every current miss appears exactly once (56 today; the deterministic cap applies only above 100); each row carries signal breakdown, register, model family, and reviewer reason. Every row is bound to the source-manifest SHA, a unique `sample_id`, a valid `text_hash`, and the analyzer commit/options hash, and regenerating from the same inputs yields byte-identical signal JSON, margins, and `miss_reason`. The precondition triple holds on every row with no missing or NaN metric; no source text, sentence fragments, matched spans, or distinctive n-grams anywhere in the committed manifest or notes. Two independent labels, the initial agreement rate, a category confusion matrix, all original and adjudicated labels are recorded with zero unresolved disagreements. The summary reports population and selection counts and `register × miss_reason` and `provider/model × miss_reason` counts, without generalizing to naturalness or to all KO model families. The only permitted diff is schema, offline extractor/validator/tests, hash-only manifest, and the measure-only report; thresholds, score weights, patterns, lexicon, prompts, runtime, and production defaults do not change (`humanization-data-backlog.md:174-176, 185`).

**Line to any later behaviour change.** A treatment may not start before a separate preregistration is committed and bound to a fresh corpus disjoint from the discovery `text_hash`es (as `ko-confirmatory-verdict-20260901.md:53-56` already requires). The preregistration must fix: the exact hypothesis and target `miss_reason`; the old→candidate value or the pattern/lexicon/prompt/runtime diff with code/asset/prompt/model/decoding hashes; independent calibration/confirmatory splits, corpus SHA, register/model strata, sample sizes, baseline, and stopping rule; for threshold or score changes, per-family/register catch rate and human-FPR limits with CIs (register-level review before tightening, `2026-rebaseline.md:85-87`); for pattern/lexicon changes, candidate selection rules, hot/cold lift, cold document frequency, context gates, and rejection rules (`humanization-data-backlog.md:75-78,169`); for prompt/runtime changes, paired blind naturalness, register fit, and clarity as separate primary outcomes with locked invariants, MPS/fidelity floors, and latency/token/cost budgets (`ko-performance-improvement-handoff-20260818.md:333-369`); and estimator, confidence level, tie/abstention/error and AB/BA handling, exclusions, missing data, multiplicity, and success/stop rules. Deterministic AI-likeness stays a secondary diagnostic for rewrite treatments, never a candidate-selection or promotion gate (`…handoff-20260818.md:371-375`).

## Maintainer session's judgment

The executing session spot-checked the reviewer's citations that carry the design (`index.js:215`, `:56-70`, `korean-diagnosis.js:16-33`, `2026-rebaseline.md:74`, `rebaseline-generate-modern.mjs:21,32-37`, `rebaseline-intake.mjs:95-109`, `humanization-data-backlog.md:174-176`); all resolve to the quoted code or text. The reviewer's GO agrees with the frozen order, and nothing in the review asks for a threshold, pattern, lexicon, prompt, or runtime change.

Accepted as the step-1 design, with three clarifications the session adds:

1. The taxonomy is computable: every `miss_reason` follows from the fixed analyzer output plus the active option values, so the extractor must emit the per-family deficits itself and the reviewer only confirms the tree. That makes the two-reviewer step cheap and keeps raw text out of the loop, which is the point.
2. `NEAR = 0.10` and the deficit normalization are review constants. They must be written into the schema (`taxonomy_version`) so a later change to the constant is a new taxonomy version, not a silent relabel.
3. The population is the 56 current misses; the stratified cap is documented for completeness but is not exercised now. If the scored manifest is regenerated before the extractor runs, the population is re-frozen from the new SHA and this record is amended, not silently reused.

Sol's opinion and this judgment are kept separate above so the reader can see where the design came from.

## Amendment 2026-09-02: population drift at extraction time

Clarification 3 above required an amendment rather than silent reuse if the population changed before the extractor ran. It did, through the analyzer rather than the manifest:

- The scored manifest is unchanged (`sha256:a8cf8565…`, 56 candidate misses), but the analyzer that scored it on 2026-05-22 predates the KO ending-monotony gate (`d23043a`, #498). At the extraction commit, 8 of the 56 candidates are flagged hot by `rhythm:ending-monotony` (7 `academic-summary`, 1 `blog`). They violate the precondition triple and are recorded in `artifacts/rebaseline-2025/ko-gpt-miss-review.v1.exclusions.jsonl` as `precondition-violated:document-hot`, not classified.
- The reviewed population is therefore the 48 candidates that remain misses under the recorded analyzer. Selection stays bound to the frozen manifest SHA; the analyzer commit, `src/features` tree hash, options hash and lexicon hash are in every row.
- Re-scoring the public claim manifest with the current analyzer would move the published KO GPT-family catch rate (44% → 52% on this cell) and is a claim-surface change outside step 1's permitted diff. It is left as an owner decision; if taken, the same 48 `text_hash`es are the misses under the new score, so this review carries over unchanged.
- The extractor default is `--on-drift fail`; the committed manifest was produced with `--on-drift exclude`, and the report states both counts.

## Deferred implementation tasks (not started in this step)

Each is its own branch and PR, measure-only, under the contract above:

Taxonomy constants, the deficit encoding and the two clarified readings (KO diagnostics as one AND gate; deficit 0 at equality) are frozen in [`ko-gpt-miss-taxonomy-v1.md`](./ko-gpt-miss-taxonomy-v1.md).

1. `scripts/ko-miss-review-extract.mjs` — select the frozen population from the scored public manifest, run the fixed analyzer, emit the source-free `signals` projection, per-family deficits, margins, and `miss_reason` per the decision tree; write the `ko-gpt-miss-review.v1` JSONL with `analysis_provenance` and `analysis_role: discovery-only`.
2. `scripts/ko-miss-review-validate.mjs` + unit tests — schema, precondition triple, hash/provenance binding, byte-identical regeneration, no-raw-text checks (mirroring the intake and claim-manifest validators).
3. Blinded review kit — per-reviewer permutation and the signal-only view; capture of both labels, margins, disagreement flags, adjudication.
4. Measure-only report — population/selection counts, `register × miss_reason`, `provider/model × miss_reason`, agreement rate, confusion matrix; committed under `docs/benchmarks/` with the manifest hash.
5. Only after 1–4: any treatment proposal goes through a new preregistration bound to a fresh corpus, per the line above.


## Amendment 2026-09-16: the deferred re-score decision was taken and executed

The owner approved the re-score left open above (2026-09-16 instruction to
complete all remaining decided work). `scripts/rebaseline-build-claim-manifest.mjs`
was re-run with the current analyzer at `origin/dev`
`75bcf7f37147fa4d54ab7b0fb62d46eb4e065c89`, regenerating
`artifacts/rebaseline-2025/rebaseline-2026.scored.public.jsonl` and
`docs/benchmarks/rebaseline-latest.{md,json}`.

- The published KO GPT-family catch rate moved 44% -> **52%** (52/48,
  95% CI 42.3%-61.5%), exactly as predicted here.
- **Carryover verified:** the miss set under the new score is byte-identical
  to the 48 reviewed `text_hash`es of `ko-gpt-miss-review.v1.jsonl`
  (0 in-new-not-reviewed, 0 in-reviewed-not-new), so the blinded review above
  carries over unchanged, and the 8 `precondition-violated:document-hot`
  exclusions are the 8 newly caught rows.
- The full-manifest re-score also moved sibling cells (all reported in the
  regenerated `rebaseline-latest.md`): overall accuracy 71.5% -> 73.6%,
  precision 92.7% -> 94.9%, recall 67.3% -> 68.5%, FPR 16.0% -> 11.0%
  (EN FP 14 -> 4; KO FP unchanged 18); en gemini 79% -> 80%;
  ko claude 68% -> 67%; ko gemini 62% -> 61%.
- The frozen review population and this document's recorded evidence remain
  bound to the 2026-05-22 analyzer as stated; nothing above this amendment
  was rewritten.
