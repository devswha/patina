# Wave 1 Codebase: API And Backends

## Key Findings

- HTTP calls have bounded retry/backoff/timeout/deadline/abort handling, but no active response cache.
- Local CLI backends have conservative cross-process concurrency caps enforced by filesystem slot directories under temp.
- Worst-case model latency can multiply through transport retries plus `scoreText` schema retry.
- Fallback is conservative: backend-chain fallback only happens for 429/503 and first-backend AbortError.

## Sources

- `/home/devswha/workspace/patina/src/api.js` lines 169-290: HTTP LLM path.
- `/home/devswha/workspace/patina/src/backends/contract.js` lines 6-41, 85-90, 114-180: timeouts, safety defaults, retry classification, slotting.
- `/home/devswha/workspace/patina/src/backends/index.js` lines 192-257: backend-chain invocation.
- `/home/devswha/workspace/patina/src/scoring.js` lines 81-123 and 196-223: score JSON retry behavior.
- `/home/devswha/workspace/patina/src/ouroboros.js` lines 108-188: sequential rewrite plus parallel scorers.
- Tests: `tests/unit/api.test.js`, `tests/e2e/backends.test.js`, `tests/unit/backend-cancellation.test.js`, `tests/unit/batch.test.js`, `tests/unit/ouroboros.test.js`.
- History: `3a674a7` removed cache/save-run surface; `7ec439f` introduced backend safety/slot defaults; `34b580b` fixed codex stdout deadlock.

## EXPAND

- LEAD: layered retry multiplication across `src/api.js` + `src/scoring.js` — WHY: a single score/rewrite can trigger transport retries plus schema retry, inflating latency unexpectedly — ANGLE: search for worst-case call trees and add a timing budget test.
- LEAD: filesystem slot contention in `src/backends/contract.js` — WHY: cross-process polling can dominate throughput under batch/OCR loads — ANGLE: inspect whether slot acquisition should be event-driven or reduced for local-only runs.
- LEAD: removed cache surface in `3a674a7` — WHY: confirms the repo intentionally dropped response caching, so repeated requests are always cold — ANGLE: trace whether any new memoization or artifact reuse is desirable in batch/preview.
- LEAD: backend fallback conservatism in `src/backends/contract.js` and `src/backends/index.js` — WHY: only 429/503 and first-attempt aborts fall through, which may be too narrow for real provider outages — ANGLE: compare with provider-specific failure modes and tests.
- LEAD: OCR fan-out path in `src/cli/run.js` and `src/ocr.js` — WHY: this is the only single-command path that can multiply backend calls for one input — ANGLE: inspect per-image limits, staging cost, and whether OCR should inherit separate concurrency caps.
