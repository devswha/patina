# Panel v2 design — judge panel reconstitution after kimi's exit

Drafted 2026-07-13, before any study uses it. Trigger: the kimi subscription
ends 2026-07-17 (operator-confirmed), removing `judge-kimi` from the fixed
3-judge panel used by Studies 0–3. This document is the registered design for
every judging run in studies registered after this date; each future
pre-registration binds itself to this design by citing it. Study 3 (running
under its own 2026-07-12 registration) is unaffected.

Grounding: the judge-calibration side study
(`2026-judge-calibration.md`, registered design, 192/192 judgments) plus a
bridge analysis computed from its existing data — no new calls.

## The panel

| seat | scorer | role |
|---|---|---|
| judge-gpt | codex CLI, gpt-5.5 | LLM judge (calibrated AUC 1.00 [1.00, 1.00]) |
| judge-grok | xai API, grok-4.5 | LLM judge (calibrated AUC 0.93 [0.83, 1.00]) |
| judge-det | patina deterministic prose-score (lang-scoped) | always-on free baseline lane (calibrated AUC 0.98 [0.93, 1.00]) |

- **Primary perceptual metric:** LLM panel mean over gpt + grok, both
  required per passage-condition; a missing/unparseable judge is data loss,
  reported (no silent 1-of-2 scoring).
- **judge-det is a co-primary corroboration lane, not pooled** into the LLM
  mean: every study reports Δ_det beside Δ_panel. Pooling raw det scores
  measured AUC 0.996 on the calibration corpus, but mixing scales (det human
  mean 17.7 vs judges ~35) breaks absolute comparability with the archived
  series; pooling stays deferred together with the operator-deferred panel-
  shrink decision (#153 ③) until a middle-ground (edited/humanized text)
  validation exists.
- **Authorship-call metrics** (AI-call rate) come from the LLM judges only;
  det's document-level binary verdict is miscalibrated (0.55 accuracy at
  document length — see calibration results) and MUST NOT be used until the
  approved recalibration task lands.

## Bridge to the old panel (computed from calibration data, n=44 docs)

| quantity | value |
|---|---|
| old panel (kimi+gpt+grok) AUC | 0.963 |
| new LLM panel (gpt+grok) AUC | **0.989** |
| per-document correlation old ↔ new | 0.96 |
| mean offset (new − old) | +2.0 points |

No measured quality loss — kimi was the panel's weakest discriminator
(AUC 0.83, human-doc bias 36.0), so removing it slightly *sharpens* the
panel. The +2.0 offset means absolute panel scores drift up slightly.

## Comparability with the archived series (the important rule)

Whenever a v2-era study compares against stored Study 0–3 ratings, the stored
baseline MUST be recomputed as the gpt+grok mean from the archived per-judge
rows (they retain each judge's score, so this is exact, not estimated).
Never compare a 3-judge historical mean against a 2-judge v2 mean — the
kimi column simply drops out of both sides. Kimi's archived scores stay in
the artifacts untouched.

## Corpus generation after kimi

kimi-k2.5 also leaves the generation rotation. Future fresh-corpus studies
rotate generator families over the available non-judge family (claude) plus
gpt/grok under the existing cross-family judging exclusion: a judge never
scores its own family's generations, so gpt/grok-generated documents are
scored by the other LLM judge + det lane; claude-generated documents are
cross-family for both LLM judges. Per-cell counts are reported as in the
calibration study.

## Agreement statistics

Krippendorff α is computed over the two LLM raters (α over 2 raters is
defined and was the pilot's snippet-arm reality); the det lane's agreement
with the LLM panel is reported separately (Spearman ρ) as a drift monitor.

## Effective date & audit trail

- Binding for studies registered on/after the first registration that cites
  this document; at the latest, any run after 2026-07-17 (kimi unavailable).
- The judge prompt, parser, retry policy, and invocation shapes remain
  byte-identical to the S2/S3 runners for the two LLM seats.
- This design was approved as a proposal lane by tower decision #153 follow-up
  (panel reconstitution requested by the operator); adoption of THIS concrete
  design is a separate operator decision.
