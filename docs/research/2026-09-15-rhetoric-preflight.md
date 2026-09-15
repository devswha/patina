# H-RHETORIC §7.B pre-flight check (2026-09-15)

Status: pre-flight evidence for the pilot decided in
[`2026-09-15-rhetoric-confirmation-decision.md`](2026-09-15-rhetoric-confirmation-decision.md).
Seven minimal live calls were made for this record (one per probe below plus
two discarded mis-routed attempts). No pilot case was run; this is not
experiment data.

## Backend reachability and one-call latency

Probe: `echo "<one short KO sentence>" | node bin/patina.js --model <id>
--lang ko --format text --quiet` on `dev` @ `b508c92`, Linux, Node 24.

| Backend | Selector used | Result | Wall clock |
|---|---|---|---|
| claude-cli | `claude-sonnet-4-6` | ok | 6.6 s |
| codex-cli | `codex` (default `gpt-5.5`) | ok | 18.7 s |
| gemini-cli | `gemini-3-pro-preview` | ok | 8.7 s |
| kimi-cli | `kimi-code/kimi-for-coding` | ok | 10.3 s |
| agy-cli | `agy` (default `gemini-3.7-flash-medium`) | ok | 14.6 s |

Notes:

- Model-id guesses route wrong: `gpt-5.5` hit `openai-http` ("no API key"),
  `kimi-k2.5` exited 1, `gemini-3.7-flash-medium` collided with the
  gemini-cli pattern. The working selectors above come from
  `src/model-defaults.js`. The pilot must pin selectors from that file, not
  from habit.
- The `gemini-3-pro-preview` probe may have been served by the HTTP Gemini
  provider (GEMINI_API_KEY is set on this machine) rather than gemini-cli;
  routing is ambiguous for `gemini-*` ids and should be pinned explicitly in
  the pilot manifest.
- All five probes removed the content-free intensifier from the probe
  sentence; this is a reachability observation, not a quality measurement.
- These are one-sentence latencies — a floor. Pilot inputs are longer, and
  `--verify` adds a second call per case.

## Quota / cap evidence

**Not queryable.** None of the five CLIs exposes a quota or headroom query
(`codex --help`, `claude --help` checked; no usage/limits subcommand).
Actual subscription caps and current usage are visible only on each
vendor's account page — owner action outside repository reach. Treat quota
as `unknown` until the owner records it.

## Wall-clock estimate for §7.B

288 calls (72 generation + 216 judge) at the observed one-sentence floor:

- Serial, floor: 288 × ~12 s ≈ 58 min.
- Realistic (longer inputs, judge prompts, verify calls, retries-within-
  policy): expect several hours serial; bounded parallelism is possible but
  must respect each backend's rate behaviour (`--no-stop-on-retryable-storm`
  exists for batch storms; pilot should keep conservative concurrency).

## Pre-flight verdict

- Reachability: five of five CLI backends ok — the pilot's generation and
  two-judge-family requirement is satisfiable from this machine.
- Budget: call count is fixed by the plan (288 + verify calls); monetary
  cost rides subscriptions (no per-call price). The remaining unverified
  prerequisite is **quota headroom**, owner-visible only.
- Next step: owner records quota headroom per backend, then the pilot
  executes per PLAN §7.B with selectors pinned from `src/model-defaults.js`.

## What this record is not

- Not pilot results; no T/C/N case was run.
- Not a quota clearance — quota stays `unknown`.
- Not a quality claim about any backend.
