# 2026 modern-model rebaseline

Status: claim-ready for the checked-in deterministic benchmark surface as of 2026-05-22.
Related issues: #155, #157, #160, #303.

This page records the first #155-compatible rebaseline after the HC3-era claim was retired. It does not replace the broader protocol in [`2025-rebaseline-plan.md`](2025-rebaseline-plan.md); it is the current public claim surface for Korean and English only.

## Inputs

| input | rows | public text | notes |
|---|---:|---:|---|
| `artifacts/rebaseline-2025/private/modern-generations.private.jsonl` | 600 | 0 | Locally generated raw text from logged-in CLI surfaces; kept ignored under `private/`. |
| `artifacts/rebaseline-2025/human-controls.public.jsonl` | 100 selected from 250 | 0 | Korean public-web human controls, hash-only and already scored. |
| `artifacts/rebaseline-2025/private/hape-en.private.jsonl` | 100 selected from HAP-E human rows | 0 | English HAP-E human controls, transformed to hash-only public rows. |
| `artifacts/rebaseline-2025/rebaseline-2026.scored.public.jsonl` | 800 | 0 | Public scored manifest: metadata, hashes, deterministic scores, and outcomes only. |

Modern-model positive cells are balanced at n=100 for each language × family:

| language | model family | local surface/model |
|---|---|---|
| en | gpt-family | `codex-cli` / `gpt-5.5` |
| en | claude-family | `claude-cli` / `claude-sonnet-4-6` |
| en | gemini-family | `gemini-cli` / `gemini-2.5-pro` |
| ko | gpt-family | `codex-cli` / `gpt-5.5` |
| ko | claude-family | `claude-cli` / `claude-sonnet-4-6` |
| ko | gemini-family | `gemini-cli` / `gemini-2.5-pro` |

The model rows are ordinary assistant completions requested through CLI tools, not API-temperature-controlled lab completions. Treat the result as a deterministic Patina detector rebaseline for these local surfaces, not as an authorship study.

## Claim gate

`npm run benchmark:rebaseline:claim-manifest -- --scored-at 2026-05-22` writes the public-safe manifest, then:

```bash
node scripts/rebaseline-summary.mjs \
  --input artifacts/rebaseline-2025/rebaseline-2026.scored.public.jsonl \
  --write \
  --basename rebaseline-latest \
  --require-claim-ready
```

Latest report: [`docs/benchmarks/rebaseline-latest.md`](../benchmarks/rebaseline-latest.md).

| gate | result |
|---|---:|
| generator families with n≥100 positive cells | 3 |
| languages with n≥100 positive cells | 2 |
| qualified positive language × family cells | 6 |
| natural/human languages with n≥100 | 2 |
| complete expected/predicted outcome rows | 800 |
| public raw text committed | 0 |

## Headline metrics

All intervals below are Wilson 95% confidence intervals.

| metric | value |
|---|---:|
| Overall AI catch rate | 67.3% [63.5–71.0%] |
| Overall human-control false-positive rate | 16.0% [11.6–21.7%] |
| Precision | 92.7% |
| F1 | 0.780 |
| TP/FP/FN/TN | 404/32/196/168 |

## Catch rate by language × model family

| language | model family | n | catch rate | 95% CI | caught/missed |
|---|---|---:|---:|---:|---:|
| en | claude-family | 100 | 74.0% | 64.6%–81.6% | 74/26 |
| en | gemini-family | 100 | 79.0% | 70.0%–85.8% | 79/21 |
| en | gpt-family | 100 | 77.0% | 67.8%–84.2% | 77/23 |
| ko | claude-family | 100 | 68.0% | 58.3%–76.3% | 68/32 |
| ko | gemini-family | 100 | 62.0% | 52.2%–70.9% | 62/38 |
| ko | gpt-family | 100 | 44.0% | 34.7%–53.8% | 44/56 |

## False-positive rate by language

| language | n | FP rate | 95% CI | FP/TN |
|---|---:|---:|---:|---:|
| en | 100 | 14.0% | 8.5%–22.1% | 14/86 |
| ko | 100 | 18.0% | 11.7%–26.7% | 18/82 |

## Interpretation

- The old README headline, “91% Korean / 76% English,” is no longer the current claim. It came from smaller HC3-era/paired fixtures and overstated current Korean catch behavior.
- English remains around the previous HC3 headline on these modern CLI samples (74–79% per family), but Korean is materially lower, especially the GPT-family cell at 44%.
- Human-control false positives remain inside the existing ≤25% acceptance envelope overall, but register-level review is still needed before any threshold tightening.
- This is an editing-hotspot detector benchmark. It must not be presented as a reliable author-attribution or detector-bypass guarantee.

## Reproducibility notes

- Raw generated and HAP-E text stays in ignored `artifacts/rebaseline-2025/private/` files. The committed manifest stores `sha256` digests, metadata, Patina scores, and outcome labels only.
- The generation helper is `scripts/rebaseline-generate-modern.mjs`; the public-safe combiner is `scripts/rebaseline-build-claim-manifest.mjs`.
- HAP-E is used only for English human controls in this report. The previous #160 HAP-E lexicon-mining note still applies: HAP-E is useful, but it is not a substitute for Korean or 2026 model positives.
- `docs/benchmarks/rebaseline-latest.json` is the machine-readable companion to the Markdown report.

## Remaining research work

1. Add lightly/heavily edited-AI rows so rewrite behavior is tested separately from raw assistant completions.
2. Add non-KO/EN languages once public controls and generated positives reach the same n≥100 cell gate.
3. Repeat the generation on API surfaces with explicit decoding parameters if a stricter lab-style claim is needed.
4. Review Korean GPT-family misses before changing thresholds; the current result argues for targeted KO diagnostics rather than global score inflation.
