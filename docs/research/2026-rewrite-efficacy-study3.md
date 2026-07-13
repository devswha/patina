# Does a structure-plan step fix the Korean gap? — Study 3 results

Companion to `2026-rewrite-efficacy-prereg.md` ("Study 3" section, registered
2026-07-12 before any data), Study 1 (`2026-rewrite-efficacy-study1.md`), and
Study 2 (`2026-rewrite-efficacy-study2.md`). Study 2 rejected the prompt-text
mechanism; Study 3 tested its named successor — a two-stage **plan → execute**
rewrite in which the model first emits a reorganization plan under a
KEEP-verbatim number/entity contract, then carries it out.

**Verdict up front: the plan-step mechanism fails every pre-registered
criterion, and is measurably WORSE than the plain single-pass rewrite. It
must not ship in any form; the next iteration falls to candidate 2
(deterministic structure transforms with LLM infill), pending priority
reassessment.**

- Run: 2026-07-12 → 07-13 (18 supervisor passes across three claude
  session-limit windows). Same corpus (54 Study 1 Arm-D documents), rewriter
  model claude-sonnet-4-6 invoked exactly as patina's claude-cli backend, same
  fixed 3-judge panel (kimi / gpt-5.5 / grok-4.5, 2-of-3 quorum). Stage
  prompts fixed before the first row (sha `5c43a5f5…` / `d8dc4497…`, stamped
  in every row); plans recorded per row as auditable intermediates.
- Final matrix: **53/54 documents** (27 AI + 26 human), 0 unparseable judge
  cells. One human document (`toss-front-2`) is data loss: three consecutive
  900 s execute-stage timeouts (see execution notes).

## H-S3a (primary) — paired improvement on AI documents: **REJECTED (direction reversed)**

Baseline = each document's own Study 1 panel scores.

| | orig | rewrite (S1, plain) | rewrite (S3, plan-step) | paired d = rw3−rw1 (95% CI) |
|---|---:|---:|---:|---|
| AI docs (n=27) | 83.6 | 77.6 | **80.0** | **+2.4 [−0.3, +4.9]** |

Pre-set support required CI excluding 0 below AND d ≤ −5. Instead the point
estimate is **positive**: the plan-step rewrite reads MORE AI-like to the
panel than the plain rewrite it was supposed to beat (descriptive vs Study 2's
pack rewrite: +3.1). AI-call rate 93% → 94%. The judged-credibility ground for
these scores is the calibration side study (`2026-judge-calibration.md`:
panel AUC 0.96, per-judge repeat SD 2–5).

## H-S3b — structural-cue share: **REJECTED**

Among judgments still calling the S3 rewrite "ai": **75% structural cues**
(S1: 81%, S2: 82%; pre-registered target < 60%). The plan step nudged the
number three points — the judges' complaints remain uniform paragraphs,
tidy arcs, checklist coverage. Planning the reorganization did not produce
perceived reorganization.

## Guard rails — **both violated (same directions as Study 2, now stronger)**

1. **Meaning-safety gate (pre-set ≥ 95%, ≥ 52/54):** 49/53 pass (92.5%).
   Four dropped-numbers failures — one is the known corpus-artifact document
   (generator length-preamble numbers), three are real content numbers lost
   despite the plan explicitly enumerating KEEP-verbatim strings. **The
   KEEP-verbatim contract does not survive execution**: the model writes a
   compliant plan, then loses the numbers anyway while reorganizing.
2. **Human-control over-editing:** paired d = **+3.6 [+0.1, +9… 7.5]** — the
   plan-step rewrite pushed human documents' AI-likeness back UP to original
   levels (42.6 → 46.1 vs original 46.2), erasing the plain rewrite's small
   gain; CI excludes 0. AI-call on human docs 23% → 27%. Structure-level
   editing harms human text — the third study in a row to measure this
   failure mode.

Mean rewrite/original length ratio: 0.93 (AI), 0.86 (human) — the compression
pressure Study 2 flagged persists and is stronger on human docs.

## Why it failed (diagnosis)

Study 2 showed *describing* target architecture doesn't change it. Study 3
shows *planning* it doesn't either: the model produces plausible
merge/split/reorder plans, but execution collapses back into
paragraph-by-paragraph paraphrase — now with extra degrees of freedom that
cost meaning (dropped numbers), cost length (0.86–0.93), and cost perception
(+2.4). The failure is in the **execute step's fidelity to a structural
plan**, not in plan quality. Two registered interventions have now failed in
complementary ways; the honest conclusion is that current-generation LLM
rewriting cannot be prompted or planned into document-architecture
humanization. Candidate 2 (deterministic structure transforms — section
merge/split scaffolding — with LLM infill confined to seams) is the remaining
mechanism, and its cost/benefit should be reassessed against the measured
ceiling before any build.

## Execution notes

- Two stage-timeout raises were made mid-run as execution notes (never
  touching prompts or criteria): execute 600 s → 900 s after two distinct
  documents hit the wall (PR #634), following S1's 300→600 precedent. One
  document (`toss-front-2`, 3.9k chars) timed out at 900 s three consecutive
  times and is recorded as data loss rather than raising further.
- The run crossed three claude session-limit windows; the supervisor's
  prune-and-resume loop (18 passes) preserved every clean row. A host tmux
  crash mid-run did not affect the detached runner.
- Corpus artifact (known from the smoke row): 2/54 stored S1 originals carry
  generator length-preamble meta-text; one of them accounts for one of the
  four gate failures (same document failed S2's gate identically). Removing
  it from the count (48/52 = 92.3%) does not change the guard-rail verdict.
- Judge panel context: this is the last study on the kimi-inclusive panel
  (subscription ends 07-17); panel v2 (`2026-panel-v2-design.md`) governs
  subsequent studies.

## What ships

Per the pre-registered decision rule: nothing. The results are published
as-is; no efficacy claim attaches to any structure-rewrite surface; the
plan-step mechanism is not productized. The next candidate (deterministic
transforms + LLM infill) is **not** started — Study 2's follow-up options are
held for operator priority reassessment, as directed.
