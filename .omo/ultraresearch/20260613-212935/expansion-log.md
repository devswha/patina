# Ultraresearch Expansion Log

## Phase 0 Decomposition

Core question: 현재 Patina의 성능을 고도화할 만한 자료와 구현 후보가 있는지, 코드베이스와 최신 외부 연구/문서를 함께 조사한다.

Axes:
- Local deterministic analyzer: `src/features/*`, lexicon density, MATTR, burstiness, Korean diagnostics, structural/discourse signals, algorithmic hot spots.
- Measurement harness: `tests/quality/*`, `scripts/*`, benchmark reports, CI/release gates, missing latency/throughput/resource metrics.
- Playground runtime: `playground/analyzer.js`, static browser constraints, Web Worker/main-thread responsiveness options.
- API/backend runtime: `src/api.js`, `src/backends/*`, retry/backoff/cache/concurrency and local CLI process overhead.
- External AI-text detection/style research: 2024-2026 multilingual benchmarks, robust evaluation pitfalls, datasets.
- External JS/browser performance material: Node perf APIs, worker threads, `Intl.Segmenter`, Unicode segmentation, Web Workers, prompt caching.

Codebase relevant: yes. External: yes. Browsing: yes. Verification likely: yes. Report requested: no.

## Wave 1 Spawned

- codebase deterministic analyzer: agent `019ec0f6-8328-77c1-ae10-ed29e81aa63f`
- codebase benchmark harness: agent `019ec0f6-89f1-7eb0-a98a-c4b655f935b0`
- codebase playground/browser mirror: agent `019ec0f6-8ff8-7860-b6ef-cabdaa6d8669`
- codebase API/backend runtime: agent `019ec0f6-9634-7dc1-bd56-8abd8e4dab6b`
- web academic detector material: agent `019ec0f6-9c63-71e0-a95b-34ca188f71f0`
- OSS analyzer implementations: agent `019ec0f6-a385-7c11-baeb-92b73bd5262d`

Thread limit prevented eight additional first-wave agents from starting. The orchestrator covered those axes directly with web search and local reads, then reused freed agent slots for expansion lanes.

## Wave 1 Returned

### benchmark harness

Key finding: current benchmark coverage is deterministic hot/cold fixture classification and report drift, not runtime performance.

Sources:
- `/home/devswha/workspace/patina/package.json` lines 12-45: benchmark, report, rebaseline, dogfood, quality scripts.
- `/home/devswha/workspace/patina/tests/quality/benchmark.mjs` lines 1-325: fixture benchmark, metrics, regression ranges.
- `/home/devswha/workspace/patina/tests/quality/README.md` lines 1-298: benchmark contract.
- `/home/devswha/workspace/patina/scripts/benchmark-report.mjs` lines 1-290: checked-in benchmark report generator.
- `/home/devswha/workspace/patina/.github/workflows/test.yml` lines 1-104 and `release.yml` lines 1-64: CI/release gates.
- `/home/devswha/workspace/patina/docs/research/ai-human-metrics.md` lines 171-273: future performance/cost metrics.

Verbatim EXPAND markers:
- LEAD: `tests/quality/benchmark.mjs` is the core deterministic gate — WHY: it defines the actual measured signals and fixture contract, so any performance harness should sit beside it rather than inside it — ANGLE: inspect how to add a sibling `performance` runner without changing the existing fixture benchmark semantics
- LEAD: `scripts/benchmark-report.mjs` and `docs/benchmarks/README.md` are the publish path — WHY: they show the repo’s checked-in report convention and drift model — ANGLE: mirror this pattern for a performance report artifact if one is added
- LEAD: `docs/research/ai-human-metrics.md` names the missing performance/cost axis — WHY: it explicitly lists latency, throughput, and retries as future research metrics — ANGLE: use it as the design spec for a new performance benchmark scope
- LEAD: `.github/workflows/test.yml` and `.github/workflows/release.yml` define the gate insertion points — WHY: they show where a new benchmark would be enforced or kept optional — ANGLE: add a performance job here only after deciding whether it is a CI gate or a report-only artifact

## Wave 2 Spawned

- runtime/provider docs: agent `019ec0fb-e7c3-7c81-aa62-0a2d759c2c8e`
- LLM latency/cost docs: agent `019ec0fb-ee5e-7fc3-85bf-5c21a2503b5a`
- performance benchmark proposal: agent `019ec0fb-f4ed-74e3-9a91-f622c18ea4da`
- evaluation benchmark literature: agent `019ec0fb-fad6-75d2-9a4b-2798cebaa247`

## Wave 2 Returned

### runtime/provider docs

Key finding: Web Workers are the right browser primitive for playground responsiveness; Node `worker_threads` fit CPU-heavy batch analysis but not I/O-heavy work; `perf_hooks` is the right no-dependency timing primitive.

Sources:
- MDN Web Workers: https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers
- Node worker threads: https://nodejs.org/api/worker_threads.html
- Node perf hooks: https://nodejs.org/api/perf_hooks.html
- MDN Intl.Segmenter: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter
- Unicode UAX #29: https://www.unicode.org/reports/tr29/

### LLM latency/cost docs

Key finding: cache-friendly prompt layout, structured outputs where available, explicit retry ownership, and batch/offline modes are the main provider-backed latency/cost levers.

Sources:
- OpenAI prompt caching: https://developers.openai.com/api/docs/guides/prompt-caching
- OpenAI latency optimization: https://developers.openai.com/api/docs/guides/latency-optimization
- OpenAI structured outputs: https://developers.openai.com/api/docs/guides/structured-outputs
- Anthropic prompt caching: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
- Gemini context caching: https://ai.google.dev/gemini-api/docs/caching

### performance benchmark proposal

Key finding: add a sibling deterministic performance lane rather than changing the correctness benchmark. Proposed files: `tests/quality/perf.mjs`, `scripts/perf-report.mjs`, `docs/benchmarks/perf-latest.{md,json}`.

### evaluation benchmark literature

Key finding: modern detector evaluation should use slice dashboards and low-FPR metrics, especially `TPR@1%FPR`, plus robustness slices for adversarial edits, unseen generators, and language/domain shifts.

Sources:
- Practical detector evaluation: https://aclanthology.org/2025.findings-naacl.271/
- RAID: https://arxiv.org/abs/2405.07940
- M4GT-Bench: https://aclanthology.org/2024.acl-long.218/
- SemEval per-language calibration example: https://aclanthology.org/2024.semeval-1.84/
- MultiSocial: https://arxiv.org/abs/2406.12549
- Reliability critique: https://openreview.net/forum?id=NvSwR4IvLO

## Verification

Ran:

```bash
npm run benchmark -- --quiet
```

Result: exit 0.

Ran a local Node microbenchmark for rolling MATTR and precompiled lexicon phrase regexes. Results are recorded in `verify-mattr-lexicon-hotspots.md`.

## Convergence

No unresolved blocker remains for a research answer. Remaining EXPAND leads are implementation-scoping leads rather than research blockers:

- Decide whether to implement report-only performance benchmark first.
- Decide whether to patch MATTR and lexicon precompilation.
- Decide whether provider-specific structured output support should start with OpenAI HTTP only.
