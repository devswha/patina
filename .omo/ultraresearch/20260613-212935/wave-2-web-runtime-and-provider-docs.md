# Wave 2: Runtime and Provider Docs

Scope: primary runtime/provider docs relevant to deterministic analyzer performance, playground responsiveness, and LLM-backed command latency.

## Browser / Node Runtime

1. Web Workers
   - Source: MDN, `Using Web Workers`, https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers
   - Key evidence: workers run scripts in background threads and can perform tasks without interfering with the UI; workers cannot directly manipulate the DOM, so messages cross via `postMessage()`.
   - Patina fit: `playground/app.js` currently calls `analyzePlaygroundText()` synchronously on each input. A thin worker wrapper around the pure analyzer can preserve audit-only behavior while moving long-paste analysis off the main thread.

2. Node `worker_threads`
   - Source: Node.js docs, https://nodejs.org/api/worker_threads.html
   - Key evidence: Node documents workers as useful for CPU-intensive JavaScript operations, not I/O-intensive work.
   - Patina fit: CLI deterministic analysis can remain single-threaded unless batch/large-corpus CPU time becomes measurable; worker threads are more appropriate for a future batch-performance mode than for normal short CLI calls.

3. Measurement APIs
   - Source: Node `perf_hooks` docs, https://nodejs.org/api/perf_hooks.html
   - Patina fit: a local `tests/quality/performance.mjs` should use `node:perf_hooks` and stable synthetic workloads plus checked-in fixture workloads. The benchmark should report p50/p95/mean rather than enforce strict single-run thresholds.

## OpenAI-Compatible LLM Latency

1. Prompt caching
   - Source: OpenAI prompt caching guide, https://developers.openai.com/api/docs/guides/prompt-caching
   - Key evidence: OpenAI says prompt caching can reduce latency and cost, works automatically on recent models, requires exact prefix matches, starts at prompts of 1024+ tokens, and exposes `cached_tokens` in usage.
   - Patina fit: put static system/profile/rubric instructions at the beginning of prompts and variable text at the end. Log `cached_tokens` when available through existing `onResponse` metadata in `src/api.js`.
   - Caveat: Patina also supports local CLI backends and OpenAI-compatible providers; not every backend exposes the same cache or usage fields.

2. Latency optimization
   - Source: OpenAI latency optimization guide, https://developers.openai.com/api/docs/guides/latency-optimization
   - Key evidence: the guide recommends streaming/chunking for user-perceived latency and also says not to default to an LLM when classical methods are faster.
   - Patina fit: keep deterministic audit/score paths deterministic and LLM-free; only route rewrite/score/fidelity tasks to LLMs when required. Streaming is more relevant to UI/interactive rewrite than batch quality gates.

3. Structured outputs
   - Source: OpenAI structured outputs guide, https://developers.openai.com/api/docs/guides/structured-outputs
   - Patina fit: `src/scoring.js` retries once when JSON parse/schema validation fails. Provider-supported structured outputs could reduce schema-retry latency for OpenAI HTTP mode, but must be optional because local CLI backends and compatible providers may not support the same parameter surface.

## EXPAND

- LEAD: provider-specific usage metadata normalization — WHY: prompt-cache and token metrics are only useful if surfaced consistently — ANGLE: inspect `src/api.js` and backend response metadata shape before implementing.
- LEAD: playground worker split — WHY: most direct browser responsiveness improvement — ANGLE: design worker test harness that proves no LLM/rewrite capability is introduced.

