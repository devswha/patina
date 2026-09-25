# Benchmark reports

This directory stores checked-in benchmark summaries. They are useful for
regression review, release notes, and public claims only when the matching gate
says the evidence is ready.

## Files

Regenerated reports have a source command. **Dated** reports record one run and
are not regenerated; read them as evidence for their date and conditions.

| File | Source command | Use |
|---|---|---|
| `latest.md` / `.json` | `npm run benchmark:report` | Deterministic suspect-zone fixture benchmark for KO / EN / ZH / JA, including `signal_score` ROC-AUC / PR-AUC diagnostics. CI fails if the checked-in copy drifts. |
| `detector-comparison.md` / `.json` | `npm run benchmark:compare` | Manual/offline comparison protocol for third-party detectors. CI drift-checked. |
| `rebaseline-latest.md` / `.json` | `npm run benchmark:rebaseline:report` | #155 claim-ready 2026 modern-model rebaseline summary (800 hash-only rows; KO+EN × GPT/Claude/Gemini plus human controls). |
| `rebaseline-{en,ko}-latest.md` / `.json` | `node scripts/rebaseline-summary.mjs --input artifacts/rebaseline-2025/manifest.{en,ko}.scored.public.jsonl --write --basename rebaseline-{en,ko}-latest` | Per-language rebaseline manifest summaries. |
| `rebaseline-low-fpr-{en,ko}-latest.md` / `.json` | `npm run benchmark:rebaseline:low-fpr -- --input artifacts/rebaseline-2025/manifest.{en,ko}.scored.public.jsonl --basename rebaseline-low-fpr-{en,ko}-latest` | Report-only TPR at fixed false-positive budgets. Not a threshold change or CI gate. |
| `register-stratified-latest.md` / `.json` | `npm run benchmark:register-pilot -- --write --basename register-stratified-latest` | Human-control false positives by register. |
| `register-stratified.md` | hand-written | Korean register-stratified false-positive plan behind the report above. |
| `rebaseline-audit-{en,ko}-latest.md` | hand-written | Measure-only operator audits of perfect-score and boundary samples; raw text stays private. |
| `ko-gpt-miss-review-v1.md` / `.json` | `npm run benchmark:ko-miss-review:report -- --write` | Measure-only step-1 review of the KO GPT-family misses: population, `register × miss_reason`, family deficits, blinded reviewer agreement. Hash-only manifest in `artifacts/rebaseline-2025/`; regeneration needs the ignored private corpus. Not a threshold recommendation. |
| `robustness-latest.md` / `.json` | `npm run benchmark:robustness` | Adversarial detection robustness. |
| `perf-latest.md` / `.json` | `npm run benchmark:perf` | Report-only analyzer latency. Machine-dependent; not a release gate. |
| `katfish-ko-latest.md` / `.json` | frozen | Aggregate-only private KatFish calibration for the Korean diagnostic layer (2026-05-21). Regeneration needs the private KatFish inputs and is retired, so the report stays as historical evidence. |
| `lexicon-freshness-en-2026-05-22.md` / `.json`, `lexicon-freshness-ko-2026-07.md` | dated | Lexicon provenance evidence cited by `lexicon/ai-{en,ko}.md`; `npm run lexicon:freshness` checks the provenance sidecars. |
| `lexicon-candidates.md` | hand-written | Candidate terms queued for the next lexicon re-mining; not part of any lexicon. |
| `live-scorer-20260905.md` / `.json` | dated | Live model-scorer diagnostics on 49 regression fixtures. |
| `live-rebaseline-20260905.md` / `.json` | dated | Live score distributions on the rebaseline texts, companion to the live-scorer report. |
| `public-examples-20260907.md` / `.json` | dated | Model-rated preservation checks of the playground example pairs; `tests/unit/public-showcase.test.js` checks the recorded hashes against the current pairs. |

## Refresh

```bash
npm run benchmark:report
npm run benchmark:compare
npm run benchmark:rebaseline:report
```

Use `npm run benchmark` for the fast fixture classifier smoke check. Use
`npm run quality:live` only when you want the opt-in rewrite-quality scaffold;
by default it does not call a model.

Re-run `npm test` after `npm run benchmark:report`: the landing page restates
`latest.json` figures, and `tests/unit/playground-benchmark-parity.test.js`
fails with the exact figure to update in `playground/index.html` and
`playground/chatgpt.js` whenever the regenerated report moves them.

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
