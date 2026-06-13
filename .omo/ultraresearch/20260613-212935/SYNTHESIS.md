# Patina Performance Research Synthesis

Date: 2026-06-13.

## Executive Summary

Patina has concrete performance-upgrade opportunities, but the best order is measurement first, then two deterministic hot-path fixes, then playground responsiveness, then LLM-backed latency/cost cleanup.

Highest confidence implementation candidates:

1. Replace `mattr()` with a rolling unique-count algorithm.
   - Local evidence: current `mattr()` in `src/features/stylometry.js` lines 120-136 slices each moving window and builds a fresh `Set`.
   - Verification: synthetic equivalence delta was 0, and 100k-token mean time dropped from about 247ms to about 14ms in the local microbenchmark.

2. Precompile or cache lexicon phrase regexes per lexicon load.
   - Local evidence: `src/features/lexicon-core.js` lines 50-78 calls phrase regex construction per phrase per paragraph.
   - Verification: synthetic 1000-paragraph density run dropped from about 46ms to about 7ms with precompiled phrase regexes.

3. Add a deterministic performance benchmark report before broad refactors.
   - Repo evidence: current `tests/quality/benchmark.mjs` measures fixture classification, not latency/throughput. The repo already has a checked-in benchmark report pattern through `scripts/benchmark-report.mjs` and `docs/benchmarks/`.
   - Recommended shape: `tests/quality/perf.mjs`, `scripts/perf-report.mjs`, and `docs/benchmarks/perf-latest.{md,json}` with median/p95/p99 timing.

4. Move playground analysis off the main thread if long-paste UI responsiveness matters.
   - Local evidence: `playground/app.js` calls `analyzePlaygroundText()` synchronously on input; `playground/analyzer.js` runs the deterministic analysis synchronously.
   - Runtime evidence: MDN documents Web Workers as background threads that can run work without interfering with the UI.

5. Improve LLM-backed paths through prompt caching, structured outputs, and retry ownership.
   - OpenAI prompt caching can reduce repeated-prefix latency/cost and requires exact stable prefixes.
   - `src/scoring.js` currently retries after JSON parse/schema failures; provider-native structured outputs can reduce that on compatible backends.
   - `src/api.js`, `src/scoring.js`, and backend adapters can multiply retries; ownership should be explicit.

## Detection-Quality Research Implications

The external literature argues against optimizing only aggregate accuracy:

- RAID shows detector brittleness under adversarial attacks, sampling changes, repetition penalties, and unseen generators.
- M4 and M4GT-Bench show multilingual/domain/generator generalization is still hard.
- SemEval Task 8 demonstrates multilingual/multidomain task structure and practical per-language calibration.
- MultiSocial shows short social text is a distinct regime.
- Practical detector evaluation work argues for `TPR@FPR`, including `TPR@1%FPR`, because aggregate AUROC/accuracy can hide deployment failure.

Patina should add slice dashboards and low-FPR metrics before making broader public robustness claims.

## Recommended Priority Order

1. Add a report-only performance harness.
2. Implement rolling MATTR with equivalence tests.
3. Add lexicon precompile/cache layer with EN/KO/ZH/JA regression tests.
4. Add playground debounce or Web Worker, depending on observed UI latency.
5. Extend benchmark reports with `TPR@1%FPR`, language/domain/generator/length slices, and edited-AI slices.
6. Make LLM prompt assembly cache-friendly and structured-output capable where providers support it.
7. Revisit Korean diagnostics and structural-feature duplicate passes after performance reports identify their share.

## Sources

- Local verification: `verify-mattr-lexicon-hotspots.md`.
- Local analyzer map: `wave-1-codebase-deterministic-analyzer.md`.
- Benchmark design: `wave-2-performance-benchmark-proposal.md`.
- Runtime/provider docs: `wave-2-web-runtime-and-provider-docs.md`, `wave-2-llm-backend-optimization.md`.
- Evaluation literature: `wave-1-web-academic-detector-material.md`, `wave-2-evaluation-benchmark-literature.md`.

