# Panel v2 design — judge panel reconstitution after kimi's exit

Adopted 2026-07-15, before any v2 study uses it. Trigger: the kimi
subscription ends 2026-07-17 (operator-confirmed), removing `judge-kimi` from
the fixed 3-judge panel used by Studies 0–3. The deterministic document scorer
is promoted to chief judge under the 2026-07-14 calibration; gpt and grok remain
the perceptual panel. Every judging run in studies registered after this date
MUST import the executable policy in `scripts/research/panel-v2.mjs`. Study 3,
registered on 2026-07-12, is unaffected.

Grounding: the judge-calibration side study
(`2026-judge-calibration.md`, registered design, 192/192 judgments) plus a
bridge analysis computed from its existing data — no new calls.

## The panel

| seat | scorer | role |
|---|---|---|
| **chief: judge-det** | patina deterministic prose-score (lang-scoped) | primary document verdict (`score >= 35`) and continuous score |
| judge-gpt | codex CLI, gpt-5.5 | perceptual corroboration (calibrated AUC 1.00 [1.00, 1.00]) |
| judge-grok | xai API, grok-4.5 | perceptual corroboration (calibrated AUC 0.93 [0.83, 1.00]) |

- **Primary document metric:** judge-det's deterministic verdict and continuous
  score. The chief lane is auditable, free, and independent of expiring model
  subscriptions. Its threshold is fixed at 35; no study may tune it on outcome
  data.
- **Binding fresh-corpus gate:** before reporting det binary outcomes, each study
  MUST pass its own labeled fresh corpus to
  `requireFreshCorpusValidation()` in `scripts/research/panel-v2.mjs`.
  Accuracy below 0.85 throws and disables the binary verdict column. Continuous
  deterministic scores remain reportable. This preserves the 2026-07-14
  calibration's anti-overfit condition in executable form.
- **Perceptual corroboration:** report the gpt+grok mean and both individual
  scores beside the chief result. Both are required for claude-generated
  passages; a missing/unparseable required judge is data loss, never silently
  reduced to one judge.
- **No pooled score:** deterministic and LLM scales remain separate. The det
  human mean was 17.7 versus roughly 35 for the LLM judges, so averaging them
  would create a number with no stable interpretation.
- **Authorship-call metrics:** the reported primary call comes from judge-det
  after the fresh-corpus gate. LLM calls are labeled perceptual corroboration,
  not quorum votes.

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

- Adopted by the operator's 2026-07-15 autonomous reconstitution order and
  binding for studies registered from that date; Study 3 remains archived under
  its original panel.
- The judge prompt, parser, retry policy, and invocation shapes remain
  byte-identical to the S2/S3 runners for the two LLM seats.
- Calibration evidence: document threshold 35 reached 0.955 accuracy on 44
  leakage-free KO documents. The same-corpus selection caveat is enforced by
  the per-study fresh-corpus accuracy floor of 0.85.
- Kimi's archived scores and old runners remain untouched for reproducibility;
  no new runner may import `judge-kimi`.
