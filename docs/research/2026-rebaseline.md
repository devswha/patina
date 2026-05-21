# 2026 rebaseline status

Status: blocked for public performance claims.
Related issues: #155, #157, #160, #303.

This page records the current state after the 2026-05-22 performance-issue pass. It does not replace the protocol in [`2025-rebaseline-plan.md`](2025-rebaseline-plan.md).

## What exists now

- `tests/quality/rebaseline-manifest.example.jsonl` validates the public row schema.
- `artifacts/rebaseline-2025/intake.local.example.jsonl` is a 25-row local intake template.
- `artifacts/rebaseline-2025/human-controls.public.jsonl` is a 250-row Korean human-control pilot with 50 rows in each tracked register. It stores metadata, hashes, and scores only; it does not store raw source text.
- `npm run benchmark:rebaseline:report` writes the current blocked summary to `docs/benchmarks/rebaseline-latest.md` and `.json`.

Latest tracked KO pilot snapshot:

| measure | value |
|---|---:|
| public rows | 250 |
| raw text in repo | 0 |
| predicted hot | 42 |
| predicted cold | 208 |
| current point FP rate | 16.8% |

The pilot is useful for Korean false-positive analysis and satisfies the n≥50×5 register coverage target. It is still human-control-only, so it is too small and too one-sided for public catch-rate claims.

## Claim gate

A public 2026 rebaseline needs all of the following:

1. at least three generator families;
2. at least two languages;
3. n≥100 per claim cell;
4. natural/human controls with source review;
5. scored `expected_hot` and `predicted_hot` outcome rows;
6. 95% confidence intervals;
7. issue links for any threshold or lexicon change.

Until that gate passes, README and launch copy should cite only checked-in deterministic benchmark reports, not 2026 catch-rate claims.

## Next data work

1. Add a matching AI-like sample set for GPT, Claude, and Gemini families.
2. Add lightly/heavily edited-AI rows so threshold work checks rewrite behavior, not only raw AI-like text.
3. Refresh public-web controls with `npm run benchmark:rebaseline:web`, then score the private raw rows with `npm run benchmark:rebaseline:score` when the source inventory changes.
4. Refresh `docs/benchmarks/rebaseline-latest.md` only from a claim-ready manifest.
5. Review per-register false positives before promoting any new number.
