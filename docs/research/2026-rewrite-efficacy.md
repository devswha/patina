# Does patina rewrite reduce AI-likeness? — Study 0 (pilot) results

Companion to the pre-registration `2026-rewrite-efficacy-prereg.md`, which fixed
these hypotheses, metrics, and decision rules **before** any data existed. Read
that file's four dated deviations alongside this one — the pilot's main product
turned out to be a hardened measurement instrument, not an effect size.

- Run: 2026-07-10. Rewriter: `claude-cli`. Independent judge panel:
  `gemini` + `kimi` (Moonshot), both cross-family to the rewriter.
- Raw generations and per-passage judgments are gitignored under
  `artifacts/rewrite-efficacy-pilot/`; only this synthesis is committed.
- **This is a pilot (n≈7–8 per cell).** Its job is to validate the instrument
  and size variance for a main study — not to license a headline number. Every
  interval below is wide; treat directions, not magnitudes, as the finding.

## Design recap

Three arms, so stimulus length is a measured moderator instead of a confound
(pre-reg Deviation 1):

| Arm | Language | Stimulus | Corpus |
|---|---|---|---|
| A | English | document (~3 000 ch) | HAP-E, human/AI paired on `prompt_id` |
| B | English | same items truncated (~450 ch) | HAP-E |
| C | Korean | snippet (~170 ch) | rebaseline intake + register-matched controls |

`spok` (HAP-E's degraded-ASR register) is excluded from the primary analysis and
restored in a sensitivity check (Deviation 4).

## RQ1 — is "AI-likeness" a stable construct? **PASS**

Inter-judge agreement (Krippendorff's α, interval):

| Arm | stimulus | α | Spearman ρ |
|---|---|---:|---:|
| A | document | **0.82** | 0.87 |
| B | snippet (same docs) | 0.67 | 0.78 |
| C | Korean snippet | 0.86 | 0.76 |

All well above the pre-registered α ≥ 0.4 gate, so the efficacy estimates are
interpretable and the main study is cleared to proceed.

**The length moderator paid off.** Same documents, document-length vs
truncated-to-450-chars: α falls 0.82 → 0.67. Shorter stimulus = noisier
judgment, exactly as the smoke test's chaos (α ≈ 0.02 on 95–150-char Korean
snippets) first suggested. But Arm C's Korean 170-char snippets still reach
α 0.86 — so the smoke test's failure was **extreme** shortness plus a
register-mismatched control set, not snippet length per se. That distinction only
exists because Deviation 1 turned the flaw into a factor.

## RQ2 — does rewrite reduce *perceived* AI-likeness? **Directionally yes, everywhere**

AI-likeness is 0–100; negative Δ = reads less AI-like after rewrite.

| Arm | class | n | judge before → after | Δ (95% CI) | Cliff's δ | "AI"-call rate |
|---|---|---:|---|---|---:|---|
| A | AI | 7 | 70.5 → 56.3 | −14.2 [−24.5, −5.7] | −0.43 | 77% → 62% |
| B | AI | 7 | 66.1 → 43.9 | −22.1 [−35.2, −9.4] | −0.63 | 71% → 46% |
| C | AI | 8 | 76.5 → 58.9 | −17.6 [−32.3, −6.4] | −0.73 | 88% → 69% |

**H2a is supported in all three arms** — every CI lies entirely below zero. The
rewrite reliably moves AI text toward "human" on judges that never saw patina and
score each passage blind.

But two cautions sit right next to that:

1. **The effect shrinks with stimulus length.** At document length (Arm A) the
   drop is smallest (−14) and the AI-call rate stays a majority (62%). A reader
   asked "human or AI?" still says AI most of the time after rewriting a full
   document. The rewrite reduces AI-likeness; it does not, at this size, cross
   the line into "reads human."
2. **H2b (AI-call rate halved) is not met.** No arm halves the rate; the best is
   C's 88 → 69%. The signal is a shift in degree, not a flip in classification.

## Anti-circularity — is patina just gaming its own detector? **No**

The pre-registered failure mode: internal score craters while independent judges
barely move. Observed (AI texts, per arm):

| Arm | independent-judge Δ | patina internal Δ |
|---|---:|---:|
| A | −14.2 | −28.5 |
| B | −22.1 | −26.3 |
| C | −17.6 | −16.0 |

The internal drop and the independent-judge drop move together — largest gap in
Arm A, but never the decoupling the rule was written to catch. **The gains are
real to outside raters, not an artifact of optimizing the home detector.** (Arm A
carries the widest internal-vs-judge gap, worth watching at scale.)

## RQ5 — meaning and collateral

- **RQ5a (meaning preserved): met.** The persona safety gate (MPS / fidelity /
  dropped numbers) passed on 44/44 rewrites once the `spok` word-salad was
  removed — and the harness only counts this honestly because a mid-pilot fix
  stopped it from silently discarding gate-failing rewrites.
- **RQ5b (over-editing human prose): mostly clean, one flag.** Rewriting human
  controls barely moved their AI-likeness in A (−2.9) and C (−4.1) and never
  raised a human text's AI-call rate. Arm B is the exception: human Δ −13.4 — but
  the humans there *dropped* toward more-human, and Arm B's human "before" score
  was oddly high (26.8), likely the truncation reading as abruptness. Worth a
  look at scale; not an over-editing alarm yet.

## RQ4 — does patina leave its own house style? **No signal (underpowered)**

Rewrites cluster slightly tighter in style space than human controls (cohesion
0.96 vs 0.91), but the permutation test is not significant (p = 0.078, n = 8).
Suggestive of a mild convergent voice, nowhere near conclusive at pilot size.
Flagged as a real question for the main study, not a finding.

## Surviving cues (what still reads as AI after rewrite)

Judges' free-text "strongest cue" on rewritten AI text clustered on **structure**,
not vocabulary: "formulaic thematic structure," "generic corporate-essay
structure with topic-sentence paragraphs and abstract-noun stacking," "neatly
resolved thematic ending." Meanwhile the cues they named on *human* text were all
**specificity**: named institutions, idiosyncratic anecdotes, character-driven
dialogue. This is the most actionable pilot output: patina is scrubbing lexical
tells (the internal score falls hard) but leaving the **architectural** ones —
the tidy intro-body-resolution arc — largely intact. That points pattern-pack
work toward structure, and matches why the effect is weakest on long documents,
where structure has the most room to show.

## Verdict

Against the pre-registered criteria: **RQ1 passes**, **RQ2/H2a is supported in
all arms**, the **anti-circularity rule does not trigger**, and **H5a is met** —
but **H2b (AI-call rate halved) fails**, and the effect **shrinks as text
lengthens**. So, honestly stated: on this pilot, patina makes AI text *read
meaningfully less AI-like to independent judges while preserving meaning*, and
the gain is not a home-detector artifact — but it *does not yet make
document-length AI text pass as human*, and the residual tells are structural.

## What the pilot changed (instrument, not just estimate)

The pilot's durable output is a measurement rig that survived contact with reality
and four recorded deviations:
1. corpus substrate swapped to document-length paired HAP-E after snippets proved
   unjudgeable (Dev 1);
2. judge parser hardened against schema drift + silent loss (Dev 2);
3. panel moved to gemini+kimi after codex exhausted its quota mid-run, with the
   partial codex ratings kept as a separate third rater (Dev 3);
4. non-prose register excluded with a paired sensitivity analysis (Dev 4).

It also surfaced a patina bug unrelated to the numbers: exit code 4 (persona
safety gate) was undocumented, so tooling that treats non-zero as failure would
silently drop exactly the meaning-drifted rewrites (fixed; PR #609).

## Go / no-go for the main study

**Go**, with these conditions carried from the pilot:
- fix the judge panel up front and verify quota headroom before the first call
  (codex died mid-pilot; two texts deterministically hang gemini — the main study
  needs a 3-judge panel with a 2-of-3 quorum so one backend stalling can't void a
  cell);
- power: pilot AI-text Δ SDs imply ~20–30 items per cell for a stable estimate;
- **a document-length Korean corpus does not exist and is the blocking
  prerequisite** for any Korean claim at the length where the effect is weakest;
- report structural-tell survival (RQ3/cues) as a primary outcome, since that is
  where the pilot says the humanization actually falls short.
