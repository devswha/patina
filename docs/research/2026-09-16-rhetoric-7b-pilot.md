# H-RHETORIC §7.B single-variable pilot — results (2026-09-16)

Status: pilot results record. Executes the decision in
[`2026-09-15-rhetoric-confirmation-decision.md`](2026-09-15-rhetoric-confirmation-decision.md)
(pre-flight: [`2026-09-15-rhetoric-preflight.md`](2026-09-15-rhetoric-preflight.md)).
**Outcome: the §7.B exploration exit rule was NOT met (E2/E3/E4 fail below), so
the §7.C confirmation stays gated and no §8 adoption-criteria claim is made.**
The shipped H-RHETORIC default (#828) is untouched by this record; its recorded
rollback (`PATINA_RHETORIC_POLICY=legacy`) stands.

Tree: `bot/rhetoric-pilot-7b` from `origin/dev`
`75bcf7f37147fa4d54ab7b0fb62d46eb4e065c89`; runner
`scripts/research/rhetoric-pilot-7b.mjs`, analysis
`scripts/research/rhetoric-pilot-7b-analyze.mjs` (both committed with this
record). Raw sources, drafts, and judge rows stay in the local-only, gitignored
`artifacts/rhetoric-pilot-20260916/` (hash-only manifest included there);
committed evidence is aggregate-only per the private-text policy.

## Protocol as run (PLAN v2 §7.B)

PLAN v2 is the rewrite-quality plan archived as [`rewrite-quality-plan-v2-20260909.md`](rewrite-quality-plan-v2-20260909.md).

- **Sources:** 24 unique originals, KO 16 (T8/C4/N4), EN 8 (T4/C2/N2), fixed
  purpose/register per case, source clusters recorded (samsung-s25 spans
  ko-t1/ko-t2/ko-c4; apple-iphone17 spans en-t1/en-c2). Pools: public web
  originals fetched 2026-09-16 (Samsung newsroom KR, korea.kr policy news ×6,
  toss.tech ×2, Kakao developers, Apple newsroom, AWS, Slack, Notion, MDN,
  Paul Graham, Joel Spolsky) plus 4 KO natural-human web controls from the
  private rebaseline intake. Raw text is local-only; the committed manifest
  carries URL/title/license note/sha256/char-count only. These 24 sources are
  now "seen" and must not be renamed holdout for §7.C.
- **Arms:** N0 (no-op), G (generic polish, direct `claude -p`), P
  (`PATINA_RHETORIC_POLICY=legacy` patina first draft), H (patina default
  first draft) — one generation model (`claude-sonnet-4-6` via claude-cli),
  single generation, no retries, no `--verify`.
- **Judges:** two non-claude families — `judge-gpt` (codex exec, gpt-5.5) and
  `judge-gemini-3.7-flash` (HTTP) — study4-common transports; blind pairwise
  JSON rubric (winner + meaning-damage / removed-empty-hype /
  lost-needed-rhetoric / over-deletion per side). A/B order fixed by a
  pre-registered formula; 24 pre-registered flip cells re-ran reversed.
- **Calls:** 72 generation + 2 recorded generation failures re-attempted once
  for capture (below) + 216 judge calls (192 primary + 24 flips), plus the 3
  smoke calls. No refusal/timeout was retried to success; 0 judge calls
  needed the bounded parse-repair re-ask.
- **Budget note:** PLAN §7.B defers budget detail to BENCHMARK.md, which does
  not exist in this tree; spend authority is the owner's 2026-09-16
  clear-all-work instruction, recorded here. Subscription quota headroom
  remains unknown/not queryable (pre-flight finding); the run completed
  without hitting a cap.

## Deterministic meaning-safety observation (unplanned, first-class)

`en-t1` (number-dense Apple PR): both patina arms' first drafts exited with
code 4 — the CLI's own deterministic meaning-safety gate (`dropped-numbers`)
rejected them. A second attempt per arm (recorded as attempt 2; attempt-1
failures kept in the ledger) generated drafts that passed the gate, so the
failure is draft-level nondeterminism, not a systematic prompt defect — but
2/48 patina first drafts tripping the number guard on one input is exactly
the §6 "생성·검증 실패" axis and carries into any §7.C design. The judged
en-t1 cells use the attempt-2 drafts. `deterministicMeaningGuard` over all 72
accepted drafts: 0 dropped-number warnings.

## Exit-rule results (pre-registered, computed by the committed analyzer)

| Rule | Threshold | Observed | Verdict |
|---|---|---|---|
| E1 safe T improvement over P | ≥3 of T12, both judges, no H damage flags | **3** (ko-t2, ko-t4, ko-t7) | PASS (at the floor) |
| E2 lost safe correction on T | 0 | **1** (ko-t8: both judges flag H losing needed rhetoric / over-deleting) | **FAIL** |
| E3 new core-meaning errors on C/N | 0 | **3 cells** (ko-c3 H/G + H/N0; ko-c4 H/G — both-judge meaning-damage flags on H) | **FAIL** |
| E4 unresolved major judge disagreements | 0 | **21 cells** with opposite non-tie winners | **FAIL** |
| E5 two-judge H/P quality net wins | > 0 | **+2** (9 agreed wins vs 7 agreed losses) | PASS |

Overall: **exploration rule not met — H is not advanced to §7.C on this
evidence.** Per §8, 0-observed is not a proof of 0 risk and these smalls
subsamples carry wide uncertainty; equally, the observed C-case damage flags
and the T-case regression are exactly the failure classes the plan protects.

## Judge-reliability reading (why E4 dominates)

Cell-level agreement (both judges, primary orders): 66/96 agree, 9 one-tie,
21 opposite. Opposite verdicts concentrate on **H/N0 (9/24)** — whether a
rewrite beats the untouched source is where the two families' taste diverges —
then P/G (6), H/P (3), H/G (3). On H/P both families individually lean H
(judge-gpt 11-8-5, judge-gemini 12-9-3) and agree at 19/24. Flip-cell
consistency 21/24. Reading: the H-vs-P contrast itself is comparatively
stable; the E4 failure is mostly baseline-comparison noise, which per §8's
판정 신뢰 axis still forces a hold rather than a favorable reinterpretation.

## What follows (not started here)

- ko-t8, ko-c3, ko-c4 failure readings + the H/N0 disagreement structure are
  the concrete inputs for any revised prompt candidate or judge-rubric fix;
  a re-run needs fresh sources (this set is spent for confirmation purposes).
- The default flip keeps standing on the 13-case diagnostic evidence with its
  rollback path; nothing in this pilot justifies changing product behavior in
  either direction, and nothing here may be quoted as an efficacy claim.

## What this record is not

- Not §7.C, not §8 adoption evidence, not a language-wide quality claim
  (KO 16 / EN 8; ZH/JA untouched).
- Not a scorer/threshold/prompt change; no product file was modified.
- Not human-rater evidence; both judges are models and their disagreement is
  reported, not adjudicated.
