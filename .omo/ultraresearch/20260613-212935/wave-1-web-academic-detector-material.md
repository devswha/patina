# Wave 1 Web: Academic Detector Material

## Key Findings

- Recent detector literature repeatedly warns that pooled detector metrics hide domain, language, generator, and adversarial-edit failures.
- RAID, M4, SemEval, GenAI Detection, MultiSocial, and recent critique/survey papers all support Patina's audit-first posture: interpretable feature bundles and calibrated risk bands are safer than binary authorship claims.
- The strongest feature direction for Patina is richer segment-level variation and adversarial/stratified evaluation, not simply increasing the weight of burstiness or MATTR.

## Sources

- RAID: https://arxiv.org/abs/2405.07940 and https://arxiv.org/pdf/2405.07940
- M4: https://aclanthology.org/2024.eacl-long.83.pdf
- SemEval-2024 Task 8: https://aclanthology.org/2024.semeval-1.279/
- GenAI Detection Task 1: https://aclanthology.org/2025.genaidetect-1.27.pdf
- MultiSocial: https://arxiv.org/abs/2406.12549
- Limitations critique: https://arxiv.org/abs/2406.11073
- Survey: https://aclanthology.org/2025.cl-1.8.pdf
- Detectability critique: https://philpapers.org/archive/GENOTD-2.pdf
- Diversity/stylometry: https://arxiv.org/pdf/2509.18880
- Diffusion vs autoregressive text stylometry: https://arxiv.org/pdf/2507.10475
- Weibo CJK stylometry: https://aclanthology.org/2025.ccl-1.64.pdf
- Domain adaptation/censorship tweets: https://aclanthology.org/2025.coling-main.607.pdf

## EXPAND

- LEAD: RAID benchmark shows robustness failures under sampling/adversarial edits — WHY: best stress-test source for Patina’s normalization and stability claims — ANGLE: adversarial robustness, sampling strategy, repetition penalty
- LEAD: M4 benchmark shows multilingual/domain generalization gaps — WHY: directly relevant to Korean/Chinese/Japanese coverage — ANGLE: multilingual cross-domain evaluation and unseen-language transfer
- LEAD: MultiSocial extends to 22 languages and social media — WHY: good proxy for short informal text and platform noise — ANGLE: short-text, platform-shift, emoji/hashtag robustness
- LEAD: Survey summarizes detector families and benchmark limits — WHY: useful map of methods without locking into black-box approaches — ANGLE: taxonomy, evaluation metrics, dataset limitations
- LEAD: Limitations critique on style complexity — WHY: warns against equating readability with AI text — ANGLE: easy-vs-hard human text, fairness, complexity strata
- LEAD: Detectability critique on blurred boundaries — WHY: supports soft scoring rather than binary claims — ANGLE: human edits, AI-assisted writing, reference-grade outputs
- LEAD: Burstiness/diversity papers — WHY: supports richer variance features instead of one scalar burstiness check — ANGLE: surprisal fluctuation, MATTR/TTR, segment variance
- LEAD: CJK stylometry paper on Weibo — WHY: gives interpretable short-text stylometric precedent in Chinese — ANGLE: feature importance, short social comments, Chinese-specific signals
