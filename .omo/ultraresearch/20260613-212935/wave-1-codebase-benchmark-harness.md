# Wave 1 Codebase: Benchmark Harness

## Key Findings

- Current benchmark coverage is deterministic fixture classification, not runtime performance.
- The repo already has a suitable convention for a separate performance lane: `tests/quality/*.mjs` runners, `scripts/*report.mjs` publishers, `docs/benchmarks/*.{md,json}` checked-in artifacts, and CI drift checks.
- Missing performance metrics: wall-clock latency, throughput, memory, token/cost accounting, retry counts, and backend-slot wait time.

## Sources

- `/home/devswha/workspace/patina/package.json` lines 12-45: quality/benchmark script surface.
- `/home/devswha/workspace/patina/tests/quality/benchmark.mjs` lines 1-325: deterministic fixture benchmark.
- `/home/devswha/workspace/patina/scripts/benchmark-report.mjs` lines 1-290: benchmark report generation.
- `/home/devswha/workspace/patina/.github/workflows/test.yml` lines 1-104 and `release.yml` lines 1-64: CI/release gate patterns.
- `/home/devswha/workspace/patina/docs/research/ai-human-metrics.md` lines 171-273: future performance/cost metric design notes.

## EXPAND

- LEAD: `tests/quality/benchmark.mjs` is the core deterministic gate — WHY: it defines the actual measured signals and fixture contract, so any performance harness should sit beside it rather than inside it — ANGLE: inspect how to add a sibling `performance` runner without changing the existing fixture benchmark semantics
- LEAD: `scripts/benchmark-report.mjs` and `docs/benchmarks/README.md` are the publish path — WHY: they show the repo’s checked-in report convention and drift model — ANGLE: mirror this pattern for a performance report artifact if one is added
- LEAD: `docs/research/ai-human-metrics.md` names the missing performance/cost axis — WHY: it explicitly lists latency, throughput, and retries as future research metrics — ANGLE: use it as the design spec for a new performance benchmark scope
- LEAD: `.github/workflows/test.yml` and `.github/workflows/release.yml` define the gate insertion points — WHY: they show where a new benchmark would be enforced or kept optional — ANGLE: add a performance job here only after deciding whether it is a CI gate or a report-only artifact
