# Does the ko-doc-structure pack fix the Korean gap? — Study 2 results

Companion to `2026-rewrite-efficacy-prereg.md` ("Study 2" section, registered
2026-07-12 before any data) and to Study 1 (`2026-rewrite-efficacy-study1.md`).
Study 1 found Korean document rewrites barely move perceived AI-likeness
(Δ −6.0) and that 75–81% of surviving cues are structural. The
`ko-doc-structure` pack (6 document-architecture patterns, authored from that
cue evidence) was the designed response. This study measured it.

**Verdict up front: the pack does not work in its current form, and it harms
two guard rails. It must not ship with any efficacy claim, and we have pulled
it from the pro-pack manifest until a redesigned intervention passes.**

- Run: 2026-07-12. Same corpus (54 Study 1 Arm-D documents), same rewriter
  (claude-cli), same fixed 3-judge panel (kimi / gpt-5.5 / grok-4.5, 2-of-3
  quorum). Intervention: the pack installed via the shipping `patina pack`
  path (sha `36f5491f…` recorded per row); its 6 patterns entered the live
  rewrite prompt (verified in Study-1-era e2e).
- Final matrix: 54/54 rewrites, 0 unparseable judge cells.

## H-S2a (primary) — paired improvement on AI documents: **REJECTED**

Baseline = each document's own Study 1 panel scores (original + rewrite).

| | orig | rewrite (S1, no pack) | rewrite (S2, pack) | paired d = rw2−rw1 (95% CI) |
|---|---:|---:|---:|---|
| AI docs (n=27) | 83.6 | 77.6 | 76.9 | **−0.7 [−3.4, +1.8]** |

The CI includes 0. Adding the pack's pattern descriptions to the rewrite
prompt produced no detectable perceptual improvement over the pack-less
rewrite. AI-call rate: 93% (S1) → 88% (S2) — marginal.

## H-S2b — structural-cue share: **REJECTED**

Among judgments that still called the S2 rewrite "ai": **82% structural cues**
(Study 1: 81%; pre-registered target: <60%). The judges' complaints are the
same complaints — uniform report-style paragraphs, checklist coverage, tidy
arcs. The pack described these shapes to the rewriter; the rewriter did not
dismantle them.

## Guard rails — **both violated**

1. **Meaning-safety gate (target ≥95% pass):** 87.0% (47/54), down from 92.6%
   on the same 54 documents in Study 1. All 7 failures are dropped-numbers.
   Structure-level editing drops facts: when the rewriter merges sections or
   compresses checklists, numbers fall out. This is exactly why the gate
   exists.
2. **Human-control over-editing:** paired d = **+5.1 [+0.3, +9.6]** — the
   pack-on rewrite made human documents read MORE AI-like than the pack-less
   rewrite did (41.9 → 47.0 vs original 45.4), and the CI excludes 0. AI-call
   on human docs rose 22% → 32%. The over-editing failure mode Study 1 flagged
   as borderline on English is now measured and significant on Korean, caused
   by the intervention itself.

Mean rewrite/original length ratio 0.91 (the pack's compression pressure is
visible but mild).

## Why it failed (diagnosis, not spin)

The intervention was **pattern descriptions in the prompt** — the same
mechanism that works for lexical patterns. Document architecture apparently
does not yield to that mechanism: the rewriter edits sentence-by-sentence and
paragraph-by-paragraph, so "break the parallel sections, make coverage
asymmetric" degrades into local paraphrase plus occasional deletion (hence the
dropped numbers) rather than actual reorganization. The one thing the pack
reliably did — push toward compression — cost meaning without buying
perception.

Design implication, carried to the next iteration: structural humanization
needs a **structural mechanism**, not more prompt text. The candidate designs,
in order of likely cost-effectiveness:
1. a pre-rewrite **structure plan step** (LLM produces a reorganization plan —
   merge/split/reorder decisions with number-preservation constraints — then
   the rewrite executes it);
2. deterministic structure transforms (section merge/split scaffolding) with
   LLM infill;
3. persona-conditioned document templates per register.

## Execution notes

- Two infrastructure failures interrupted the run (a duplicated config key
  from the over-editing-guard commit; a claude CLI login expiry). Both
  produced fail-soft recorded rows, were pruned, and re-ran cleanly; the
  resume path (skip-by-original_sha) worked as designed. Neither affects
  judged data: every kept row has a real rewrite and full panel coverage.
- The new over-editing guard fired on exactly the human controls whose
  deterministic signal was already clean (7 warnings, 0 on AI docs) — its
  first live validation, consistent with its design.
- One S2-specific confound stands as registered: rewriter/judges are
  stochastic and S1 ran two days earlier. The paired design absorbs
  document-level variance but not run-level drift; given d ≈ 0 with a tight
  CI, the conclusion "no effect distinguishable from rerun variance" is the
  honest reading — and the guard-rail violations are same-run internal
  comparisons (gate) or CI-excluding-zero (human d), so they do not hinge on
  the confound.

## What ships

Per the pre-registered decision rule: the results are published as-is; the
pack carries **no efficacy claim**; `ko-doc-structure` is **removed from the
pro-pack manifest** (unpublished, kept in the repo history for iteration 2);
the next intervention targets the structural mechanism, not the pattern prose.
