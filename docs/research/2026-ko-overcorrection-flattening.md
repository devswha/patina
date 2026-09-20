# Korean flattening overcorrection calibration — 2026-09-19

Scope: calibration round for the fourth overcorrection signal named in #882
("한국어 어투를 한 형태로 과도하게 평탄화하면서 직역만 남김"), run on `dev`
after stage 1 (#890, dash wipe + introduced slang) and stage 2 (#911, EN
cadence stack) landed. `src/cli/overcorrection-advisory.js` explicitly
records that Korean-flattening checks are not in those stages; this unit
supplies the measurement the promotion decision needs. Nothing here is wired
into the product.

## Question

Can a rewrite that collapses a genuinely varied source into a single Korean
speech level be detected at high precision — enough to print a warning —
without firing on faithful edits, already-uniform sources, short sources,
user-requested register unification, or near-total-but-not-total collapse?

## Signal

Sentence-ending variety. Each sentence is classified into one of six ending
classes — 합니다체 (formal), 명사형 종결 (clipped), 해요체 (polite), 의문
(question), 해체 (banmal), 평서형 (plain) — longest-suffix-first. The
profile of a text is (n, distinct classes, dominance of the top class). The
guard compares source to rewrite, exactly like the dash-wipe signal: the
source must have had variety worth defending before its loss can be a note.

**Key implementation lesson.** 합니다체 surfaces never contain a fixed
suffix list: ㅂ-irregular verbs put the ㅂ into the batchim of the previous
syllable, so 됩니다/드립니다/줍니다/깝니다 do not contain "합니다" or
"습니다". The reliable surface form is the syllable tail `니다` (and `니까`
for formal questions). A suffix-list matcher misclassifies a third of formal
sentences as plain — this exact bug produced the seven false misses in the
first measured run of this unit.

## Method

- Fixture: `tests/fixtures/ko-overcorrection/flattening-50.jsonl` — 50
  labeled (source, rewrite) pairs. 25 hot: varied sources (≥3 ending
  classes, dominance ≤0.80, ≥5 classifiable sentences) flattened to one
  class — 합니다체 11, 평서형 9, 해요체 5, across 블로그/업무 문서/SNS.
  25 cold in five control groups: 10 faithful rewrites, 4 uniform sources,
  4 short sources, 5 register-requested unifications (`registerRequested:
  true` — the implementation must honor the config veto), and 2 boundary
  rows at dominance 0.875.
- Harness: `scripts/ko-overcorrection-flattening-candidate-eval.mjs`
  (measurement only; deterministic, LLM-free).
- Three variants:
  - **v1 collapse** — the rewrite is single-ending (dominance 1.00).
  - **v2 dominance** — the rewrite's top ending holds ≥0.90 of sentences.
  - **v3 collapse+calque** — v1 AND the rewrite newly carries ≥2 weak
    translationese classes the source lacked (the "직역만 남김" half).

## Result (2026-09-19, 50-pair fixture)

| Variant | TP | FP | TN | FN | Precision | Recall | Gate |
|---|---:|---:|---:|---:|---:|---:|---|
| v1 collapse | 25 | 0 | 25 | 0 | 1.00 | 1.00 | PASS |
| v2 dominance | 25 | 0 | 25 | 0 | 1.00 | 1.00 | PASS |
| v3 collapse+calque | 7 | 0 | 25 | 18 | 1.00 | 0.28 | FAIL |

Floors from `process/pattern-freshness.md` (rewrite lane: precision ≥0.80,
recall ≥0.50); the advisory prints user-visible warnings, so the stricter
floor is the reported bar.

## Reading

1. **The ending collapse is the signal.** v1 separates the corpus perfectly:
   every hot pair is a full single-class rewrite, every cold group —
   faithful, uniform, short, requested, boundary — stays silent. This
   mirrors the dash-wipe design: total loss of a varied source's property,
   not degree-of-change.
2. **v2 buys nothing here and risks more.** It is indistinguishable on this
   corpus (the two 0.875 boundary rows stay cold under both), and 0.90 is an
   unprobed cliff between 0.875 and 1.00. Prefer the conservative v1: one
   surviving sentence of the source's own voice clears the note, the same
   way one surviving dash clears dash-wipe.
3. **The calque coupling cannot gate.** Only 7 of 25 hot rewrites newly
   carry ≥2 calque classes; requiring it silences 18 genuine flattening
   cases (recall 0.28). "직역만 남김" is corroborating context — worth
   naming in the warning text when present — not a condition.
4. **The register veto is load-bearing.** 5 of 25 cold rows are requested
   unifications. The shipped config contract ("omit register to preserve
   the source register") makes the veto clean: the flattening note may only
   fire when `register` is unset; an explicitly requested register is the
   user's own decision.

## Recommendation

Promote **v1** into `src/cli/overcorrection-advisory.js` as #882 stage 3
(Korean flattening), advisory-only, gated on `lang === 'ko'`, with:

- source preconditions: ≥5 classifiable sentences, ≥3 ending classes,
  dominance ≤0.80; rewrite: single class, ≥5 classifiable sentences;
- a `register`-unset veto (requested unification is exempt);
- gained calque classes, if any, appended to the warning text as context.

Promotion is the owner's decision; this unit stays measurement-only until
then.

## Limitations and non-goals

- Sentence-final quotes and non-Korean tails (numbers, Latin) are
  unclassified; a rewrite that ends many sentences in quotes is measured as
  short, not varied. No quote-stripping was attempted.
- Standalone connective sentences ending 니까 (그러니까.) classify formal;
  accepted noise, unobserved in the corpus.
- The 0.875–1.00 dominance band has only two probe rows; v2's cliff is
  asserted, not mapped. v1 avoids the band entirely.
- ZH/JA flattening is out of scope (#880 non-goal stands); the EN side of
  #882 has no flattening signal and is not covered here.
- No rollback behavior is measured — #882's third acceptance bullet is
  satisfied by the warning option, per the stage-2 precedent (#911).
