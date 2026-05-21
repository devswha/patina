# Benchmark reports

This directory stores checked-in benchmark summaries. They are useful for
regression review, release notes, and public claims only when the matching gate
says the evidence is ready.

## Files

| File | Source command | Use |
|---|---|---|
| `latest.md` / `latest.json` | `npm run benchmark:report` | Deterministic suspect-zone fixture benchmark for KO / EN / ZH / JA, including `signal_score` ROC-AUC / PR-AUC diagnostics. |
| `detector-comparison.md` / `.json` | `npm run benchmark:compare` | Manual/offline comparison protocol for third-party detectors. |
| `rebaseline-latest.md` / `.json` | `npm run benchmark:rebaseline:report` | Sanitized 2025+ model-era manifest summary. Public claims stay blocked until the corpus gate passes. |

## Refresh

```bash
npm run benchmark:report
npm run benchmark:compare
npm run benchmark:rebaseline:report
```

Use `npm run benchmark` for the fast fixture classifier smoke check. Use
`npm run quality:live` only when you want the opt-in rewrite-quality scaffold;
by default it does not call a model.

## Public-claim rule

Do not copy numbers into README, launch copy, or social posts unless the report
itself contains the required evidence. The rebaseline report must stay
`BLOCKED` until it has scored outcome rows, n≥100 per claim cell, at least two
languages, at least three generator families, and confidence intervals.

The `latest` report's ranking diagnostics are regression evidence for the
checked-in fixtures only. They help compare thresholds and signal changes, but
they are not a general claim that patina detects authorship or current model
families.

## False-positive loop

If a person-written paragraph is flagged too aggressively, collect it through
the false-positive form:

<https://github.com/devswha/patina/issues/new?template=false_positive.yml>

A useful report includes the exact paragraph that fired, language/register,
score output, and whether the sample can become a public fixture. Private or
vendor-copied text should stay out of the repository; use metadata and hashes
instead.
