# Wave 2: Evaluation Benchmark Literature

Scope: external evidence for improving Patina's detection-quality evaluation while preserving deterministic, audit-first behavior.

## Strong Recommendations

1. Add low-FPR metrics
   - Source: A Practical Examination of AI-Generated Text Detectors for Large Language Models, https://aclanthology.org/2025.findings-naacl.271/
   - Evidence: the paper emphasizes `TPR@FPR` and reports cases where `TPR@.01` is as low as 0%.
   - Patina fit: add `TPR@1%FPR` and possibly `TPR@5%FPR` alongside accuracy, precision, recall, F1, AUROC, and PR-AUC.

2. Add robustness slices
   - Source: RAID, https://arxiv.org/abs/2405.07940
   - Evidence: RAID spans 6M+ generations, 11 models, 8 domains, 11 attacks, and 4 decoding strategies; detectors are brittle to adversarial attacks, decoding changes, repetition penalties, and unseen generators.
   - Patina fit: add deterministic regression slices for paraphrase, repetition/variance perturbation, homoglyph/zero-width noise, punctuation stripping, unseen generator, and domain holdouts.

3. Split by domain and generator
   - Source: M4GT-Bench, https://aclanthology.org/2024.acl-long.218/
   - Evidence: good performance often requires access to training data from the same domain and generator.
   - Patina fit: report in-domain/seen-generator, in-domain/unseen-generator, out-of-domain/seen-generator, and out-of-domain/unseen-generator separately.

4. Calibrate by language
   - Source: KInIT at SemEval-2024 Task 8, https://aclanthology.org/2024.semeval-1.84/
   - Evidence: competitive SemEval system used language identification and per-language classification-threshold calibration.
   - Patina fit: thresholds and diagnostic weights should be calibrated per language/script family, with a fallback bucket.

5. Add short/social text
   - Source: MultiSocial, https://arxiv.org/abs/2406.12549
   - Evidence: 22 languages, 5 platforms, short informal social text; platform selection affects transfer.
   - Patina fit: add short-text and social-style slices, especially for emoji/hashtag/code-switching cases.

6. Account for edited/hybrid text
   - Source: Can AI-Generated Text be Reliably Detected?, https://openreview.net/forum?id=NvSwR4IvLO
   - Evidence: recursive paraphrasing can break many detector families with slight quality degradation.
   - Patina fit: keep paragraph/span-level explanations and add edited-AI / human-edited-AI slices instead of only whole-document labels.

## Current Repo Gap

The latest public rebaseline summary covers 800 records, but only English and Korean. It reports 71.5% accuracy, 92.7% precision, 67.3% recall, 16.0% false-positive rate, and notable weak slices such as Korean GPT-family catch rate at 44.0%, chat-update FN at 49.2%, and technical-how-to FP at 30.0%.

This means the next quality-improvement work should prioritize slice coverage and calibration before claiming broad multilingual robustness.

## Recommended Next Benchmark Shape

- `global`: AUROC, PR-AUC, accuracy, precision, recall, F1, `TPR@1%FPR`.
- `language`: EN, KO, ZH, JA, mixed, unknown.
- `domain/register`: blog, academic, product-doc, chat-update, technical-how-to, social.
- `generator`: GPT, Claude, Gemini, open-weight, unseen.
- `attack`: paraphrase, zero-width, homoglyph, punctuation/case, repetition/sampling variation.
- `length`: 1 sentence, 2-3 sentences, paragraph, multi-paragraph.
- `authorship`: human, AI-like, lightly edited AI, heavily edited AI, mixed human-machine span.

