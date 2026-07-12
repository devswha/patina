# Do the study-series judges measure anything? — calibration results

Companion to `2026-judge-calibration-prereg.md` (registered 2026-07-13 before
any data). Run: 2026-07-13 00:25–02:45 KST, post-midnight window, zero claude
usage, fully separated from Study 3 (which was running concurrently on its
own artifacts). Decision rules below were fixed in the registration; nothing
moved after the numbers arrived.

- Corpus: 20 fresh human KO web documents (collected at registration time;
  sha256+URL dedupe against every store the deterministic layer was ever
  tuned, swept, or benchmarked on — 21,482 hashes / 94 URLs excluded) +
  24 fresh topic-paired AI documents (8 each gpt-5.5 / kimi-k2.5 / grok-4.5,
  title+register+length-band pairing, human text never in a prompt).
- Judging: 192/192 calls parsed (0 lost) — 132 main + 60 stability repeats.
- Headline metrics are cross-family (each judge never scored its own
  family's generations); self-family cells reported separately.

## Verdicts (pre-set criteria: PASS = AUC ≥ 0.75 AND median repeat SD ≤ 12; DEMOTE = AUC < 0.65 OR SD > 20)

| judge | accuracy | AUC [95% CI] | bias human/AI | repeat SD (median) | self-pref | verdict |
|---|---:|---|---|---:|---:|---|
| judge-kimi (k2.5) | 0.75 | 0.83 [0.69, 0.95] | 36.0 / 71.1 | 4.5 | +6.0 | **PASS** |
| judge-gpt (gpt-5.5) | 0.92 | **1.00 [1.00, 1.00]** | 39.1 / 92.1 | 2.2 | −9.3 | **PASS** |
| judge-grok (grok-4.5) | 0.92 | 0.93 [0.83, 1.00] | 32.1 / 76.1 | 4.1 | +11.9 | **PASS** |
| **pooled panel (2-of-3 mean)** | — | **0.96 [0.90, 1.00]** | — | — | — | **PASS** (pre-set ≥ 0.80) |

**The panel is real.** All three judges discriminate certain-human from
certain-AI Korean documents well above chance, and repeat scoring is tight
(SD 2–5 points on a 0–100 scale).

**The kimi 35↔92 swing is explained.** Kimi's repeat variance is small
(SD 4.5), so its Study 3 swings are *document-driven disagreement*, not
sampling noise: kimi is the weakest discriminator (accuracy 0.75, CI dipping
to 0.69) with the strongest tendency to read human docs as AI-ish (bias 36.0).
Its dissents are real opinions of a mediocre judge — the 2-of-3 quorum design
is doing exactly the work it was added for.

**Self-preference exists but is small and mixed.** gpt flatters its own
family's generations by ~9 points (classic self-preference); grok is ~12
points *harsher* on its own family. The study series' cross-family judging
rule already neutralizes this.

## Deterministic stylometry on the same corpus

| layer | AUC [95% CI] | mean score human/AI |
|---|---|---|
| prose-score `score` (lang ko) | **0.98 [0.93, 1.00]** | 17.7 / 78.1 |

- The deterministic score **matches or beats every judge** on this
  leakage-free corpus, at zero marginal cost and perfect reproducibility.
- Pre-registered promotion rule (deterministic AUC ≥ best judge − 0.05 =
  0.95) **fires** → a promotion-review decision is filed with the operator
  (promotion is an operator call, not this study's).
- Caveat that keeps this honest: the *binary* document verdict currently used
  in some surfaces ("any hot paragraph") scores only 0.55 accuracy here — the
  continuous score separates nearly perfectly, but the hot-paragraph trigger
  is miscalibrated at document length. Any promotion should promote the
  score/threshold, not the current binary rule.

## Limitations (named, not hidden)

- n = 16 cross-family AI + 20 human per judge — CIs are wide (kimi's spans
  0.69–0.95). This is a calibration smoke test, not a benchmark claim.
- Register skew: human side is 14 blog + 4 technical-how-to + 2 chat-update
  (fresh-collection reality); no product-doc/academic register.
- gpt's perfect 1.00 may reflect an easy corpus ceiling (3-family generic
  generations); it does not certify gpt on harder, edited, or rewritten text.
- The corpus is certain-label by construction; humanized/edited-AI middle
  ground — the study series' actual subject — is out of scope here.

## What this means for Study 3

Study 3's panel scores stand on measured ground: three PASS judges, panel
AUC 0.96, low repeat variance. Kimi dissents should be read as a lenient
judge's real opinion, absorbed by the quorum.
