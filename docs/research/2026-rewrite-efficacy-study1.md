# Does patina rewrite reduce AI-likeness? — Study 1 (main study) results

Companion to `2026-rewrite-efficacy-prereg.md` ("Study 1" section, registered
2026-07-10 before any Study 1 data) and to the Study 0 pilot
(`2026-rewrite-efficacy.md`). Decision rules were fixed up front; nothing below
moved after the numbers arrived.

- Run: 2026-07-10. Rewriter: `claude-cli` (unchanged from the pilot).
- Judge panel (fixed pre-run): `kimi` (moonshot, kimi-for-coding/k2.5) +
  `codex` (gpt-5.5) + `grok` (xai, grok-4.5) — all cross-family to the
  rewriter; 2-of-3 quorum. gemini was excluded **before the first call**
  (monthly spend cap; recorded in the pre-registration).
- Corpus generation models (Arm D AI side, family rotation):
  gpt-5.5 / claude-sonnet-5 / kimi-k2.5 / grok-4.5.
- Raw texts and judgments stay gitignored under
  `artifacts/rewrite-efficacy-study1/`; only this synthesis is committed.
- Final matrix: **576/576 panel ratings present, 0 rewrite failures,
  0 unparseable cells** (61 ratings arrived via the top-up pass — see
  Execution notes).

## Design recap

Two document-length arms (snippet arms were measured in the pilot and not
re-run):

| Arm | Language | Corpus | n (AI+human) |
|---|---|---|---|
| A1 | en | HAP-E paired on `prompt_id`, disjoint from pilot items | 25+25 (21+21 after `spok` exclusion) |
| D | ko | **new**: 27 human documents (1.2–4.0k chars, 5 registers, 39 vetted public sources) + 27 topic-paired AI documents (public title + register + length band only — the human text never entered a prompt) | 27+27 |

Arm D length-band enforcement: 5/27 AI documents finished slightly under
their paired band after 3 attempts (worst −20%; models chronically undershoot
Korean char targets) and 1 slightly over (+2.8%); all recorded
(`band_met:false`), none excluded.

## RQ1 — construct validity: **PASS both arms**

| arm | units | Krippendorff α | mean pairwise ρ | mean abs gap |
|---|---:|---:|---:|---:|
| A1 (en doc) | 84 | **0.751** | 0.845 | 14.1 |
| D (ko doc) | 108 | **0.526** | 0.568 | 18.4 |

Both clear the pre-registered α ≥ 0.4 gate. Korean document agreement (0.526)
is markedly lower than English (0.751) — "AI-likeness" is a noisier construct
for Korean prose even at document length, consistent with the pilot's
length-penalty finding but now visible *within* document-length stimuli.

## RQ2 — perceptual efficacy: **supported in both arms, with a 4× language gap**

AI-likeness 0–100; negative Δ = reads less AI-like after rewrite.

| arm | class | n | before → after | Δ (95% CI) | Cliff's δ | "AI"-call |
|---|---|---:|---|---|---:|---|
| A1 | AI | 21 | 82.9 → 59.4 | **−23.4 [−30.8, −16.5]** | −0.79 | 92% → 65% |
| A1 | human | 21 | 17.2 → 20.5 | +3.3 [−0.0, +7.0] | +0.17 | 2% → 5% |
| D | AI | 27 | 83.6 → 77.6 | **−6.0 [−10.0, −3.4]** | −0.49 | 95% → 93% |
| D | human | 27 | 45.4 → 41.9 | −3.5 [−8.1, +0.8] | −0.13 | 25% → 22% |

- **H2a: SUPPORTED in both arms** — every AI-text CI lies below zero.
- **H2b (AI-call rate halved): FAILS in both arms**, decisively in Korean
  (95% → 93%).
- **The headline is the language gap.** On English documents the rewrite
  removes ~23 points of perceived AI-likeness and drops a third of the
  AI verdicts. On Korean documents it removes **six** — judges still call
  93% of rewritten Korean AI documents "AI". At document length, patina's
  Korean humanization is currently marginal.

### Anti-circularity — no gaming signature, but watch Korean

Internal-score drop vs independent-judge drop: A1 −16.7 vs −23.4 (judges move
*more* than the internal score — the healthy direction); D −13.4 vs −6.0 (the
internal score falls **2.2× further than judges do**). The pre-registered
trigger (internal falls, judges flat) does not fire, but the Korean gap is the
direction it fires in; if ko pattern work optimizes the internal score without
moving judges, this becomes the detector-gaming finding.

## RQ5 — meaning and collateral

- **RQ5a: met** — safety-gate pass 95.8% (92/96) against the ≥95% target. All
  4 failures are dropped-number cases, recorded with the emitted text kept.
- **RQ5b: one flag.** Rewriting *human* English documents nudges them **toward**
  AI (+3.3, CI [−0.0, +7.0], AI-call 2% → 5%). The CI touches zero, so this is
  a borderline over-editing signal, not a verdict — but it is the same
  direction as RQ4 below and deserves a targeted look before any "safe on
  human text" claim. Korean human controls moved the other way (−3.5, n.s.).

## H6 — structural-tell survival (pre-registered primary): **SUPPORTED in both arms**

Deterministic keyword rubric over judges' `strongest_cue` on rewritten AI text
(rubric fixed in the harness before any data):

| arm | structure | lexical | specificity-absence | other |
|---|---:|---:|---:|---:|
| A1 (63 cues) | **40%** | 11% | 11% | 38% |
| D (81 cues) | **75%** | 9% | 0% | 16% |

Exploratory (not pre-registered) — restricted to judgments that still called
the passage "ai": A1 49% structure; **D 81% structure**.

The Korean surviving tells are overwhelmingly architectural, and the verbatim
cues name the exact shapes: "보고서식 문장", "균일한 설명 리듬과 체크리스트식
포괄성", "너무 매끈한 문제-위기-교훈 서사", "rigid three-axis scaffolding plus
tidy triadic close", "uniform exhaustive tutorial cadence, no personal
fingerprint". Meanwhile, cues that flipped judges to "human" cite *specificity*
(lived edge cases, px values, Slack reactions, first-person asides). This is
the evidence base for a **ko structure pattern pack**: break uniform paragraph
rhythm, checklist exhaustiveness, and the tidy problem→crisis→lesson arc;
inject document-level irregularity rather than word-level substitutions.

## RQ4 — humanizer fingerprint: **now significant in BOTH arms**

| arm | rewrite cohesion | human cohesion | gap | permutation p |
|---|---:|---:|---:|---:|
| A1 | 0.9323 (n=25) | 0.8833 (n=25) | +0.049 | **0.029** |
| D | 0.9621 (n=27) | 0.9313 (n=27) | +0.031 | **0.045** |

The pilot's suggestive p = 0.078 was real: at n≈25, patina's rewrites are
measurably more alike than independently-authored human texts, in both
languages. patina removes the generator's fingerprint and leaves its own — a
second-order tell a per-text score cannot see, and a concrete work item
(voice diversification / persona-conditioned variation), not just a caveat.

## Sensitivity — `spok` restored (Arm A1)

α 0.751 → 0.747; Δ −23.4 → −25.7 [−32.4, −19.2]. Both verdicts survive; the
headline does not rest on the exclusion.

## Execution notes (transparency)

- **codex quota died mid-run again** — headroom was verified on a fresh reset
  before the first call (as pre-registered) and the recorded run still
  exhausted it. Unlike the pilot's Deviation 3, the pre-registered 3-judge /
  2-of-3 quorum absorbed it: every affected row kept a valid 2-judge quorum
  during the run, and all 33 missing gpt cells were repaired by the top-up
  pass after the next reset. **Limitation:** those gpt ratings were collected
  hours after their kimi/grok counterparts (judge × time confound on 33/576
  cells, D arm only).
- 13 Korean document rewrites exceeded the 300 s rewrite timeout in-run; all
  13 succeeded in the top-up pass at 600 s. Document-length Korean rewrite
  latency runs 4–10 minutes through the live CLI path — itself a product
  observation.
- Top-up total: 61/576 ratings (10.6%) repaired; 5 in-run retries; zero
  schema-drift keys (the pilot's Deviation-2 hardening held).

## Verdict

Against the pre-registered rules: **RQ1 passes in both arms; H2a is supported
in both arms; H2b fails in both; anti-circularity does not trigger; H5a is
met; H6 (structure-modal surviving cues) is supported in both arms; H4 (house
style) is now significant in both arms.**

Honestly stated: **patina reliably makes English AI documents read much less
AI-like (−23, a third of AI verdicts flip) while preserving meaning — but on
Korean documents the perceptual gain is small (−6, AI verdicts nearly
unmoved), the surviving tells are overwhelmingly structural, and the rewriter
leaves a measurable house style in both languages.** The product implications
are ranked by this data: (1) a Korean **structure** pattern pack, (2) house-
style diversification, (3) an over-editing guard for human English input.
