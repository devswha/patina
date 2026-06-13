# Wave 2: Performance Benchmark Proposal

Scope: repo-native design for measuring deterministic analyzer performance without changing existing correctness gates.

## Minimal Files

- `tests/quality/perf.mjs`: offline timing harness for in-tree deterministic code.
- `tests/quality/perf-fixtures.jsonl` or `tests/quality/perf-fixtures/*.jsonl`: checked-in fixed-size samples.
- `scripts/perf-report.mjs`: report renderer.
- `docs/benchmarks/perf-latest.md` and `docs/benchmarks/perf-latest.json`: checked-in artifacts.
- Optional: `tests/unit/perf-report.test.js` for report schema.

## Metrics

- Per fixture: `wall_ms`, `input_chars`, `input_paragraphs`, language, size bucket.
- Per bucket: mean, median/p50, p95, p99, texts/sec.
- Metadata: Node version, platform, generated time, schema version, fixture count.
- Regression watch: relative slowdown percentage against a pinned baseline, but report-only first.

## Fixture Shape

Use small fixed inputs:

- short English
- medium English
- short Korean
- medium Korean
- long mixed-paragraph sample
- optional synthetic worst case for MATTR and lexicon density

No network, no LLM, no random sampling.

## Flake Control

- Use `node:perf_hooks` or `process.hrtime.bigint()`.
- Warm up once.
- Run 5-11 measured passes.
- Report median and p95, not a single run.
- Keep performance checks out of mandatory `prepublishOnly` until baselines are stable.
- Add scheduled/manual CI before PR-blocking CI.

## Repo Fit

- `package.json` already has `benchmark` / `benchmark:report` scripts.
- `tests/quality/benchmark.mjs` already emits deterministic JSON and fails nonzero on correctness regressions.
- `scripts/benchmark-report.mjs` and `docs/benchmarks/README.md` define the checked-in report pattern.
- `docs/research/ai-human-metrics.md` already names latency, tokens, cost, and retries as future performance/cost metrics.

## Recommendation

Add the performance harness before optimizing more code. It will make rolling MATTR, precompiled lexicon regexes, playground worker changes, and future Korean single-pass extraction measurable in the same convention as the existing benchmark reports.

