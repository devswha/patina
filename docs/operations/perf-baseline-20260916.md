# Performance variance baseline — 2026-09-16 (warning-first, no gate)

Maintenance plan §11: before any perf budget can block, establish the same-
host repeat variance of the existing `npm run benchmark:perf -- --costmetrics`
tool. This record is that baseline. **Warning-only: nothing in CI blocks on
these numbers, and no threshold below may be turned into a blocking gate
without its own owner-approved change.**

- Tree: `origin/dev` `ef0b880e445ff6d9d591cb5d73173f77e9d82c4d`
- Environment: linux x64, AMD Ryzen 9 5950X (32 threads), Node v24.18.0,
  npm 11.16.0, otherwise-idle host, 5 consecutive passes of the unmodified
  tool (its own protocol: analyzer warm-in-process 1 warmup + 7 measured
  passes; CLI cold start 3 fresh processes per run). Generated
  `perf-latest.{md,json}` files were snapshotted per pass and restored —
  no generated drift is part of this PR.
- Raw per-pass JSON stays local (5 snapshots); this document records the
  aggregate only, per the no-long-logs rule.

## Observed baseline and repeat variance (n=5 passes)

| Metric | Mean | Min–max | SD | Spread (max−min)/mean |
|---|---:|---:|---:|---:|
| CLI cold start, mean ms (3 procs/pass) | 73.6 | 71.4–79.9 | 3.6 | 11.6% |
| CLI cold start, p95 ms | 77.3 | 72.8–92.6 | 8.6 | 25.7% |
| npm tarball bytes | 1,521,793 | identical ×5 | 0 | 0% |
| RSS delta bytes (report process) | 14.2 MB | 13.5–14.9 MB | 0.6 MB | 10.0% |

Analyzer per-fixture p50 (warm, ms):

| Fixture | Mean | Min–max | Spread |
|---|---:|---:|---:|
| perf-en-short | 0.198 | 0.193–0.207 | 7.1% |
| perf-ko-short | 0.202 | 0.196–0.206 | 4.9% |
| perf-en-medium | 0.358 | 0.345–0.367 | 6.2% |
| perf-mixed-long | 0.352 | 0.321–0.451 | 36.9% |
| perf-synth-lexicon | 0.666 | 0.655–0.678 | 3.5% |
| perf-ko-medium | 0.757 | 0.734–0.817 | 11.0% |
| perf-synth-mattr | 2.030 | 1.932–2.157 | 11.1% |

## Warning thresholds derived from the variance (advisory only)

A future same-host measurement is *worth a look* (not a failure) when it
falls outside roughly 3× the observed same-host noise:

- **Tarball bytes:** deterministic (0% spread) — any change is real; flag
  growth > 5% versus the recorded release baseline for comment in the PR
  that caused it.
- **CLI cold start (mean of ≥3 fresh processes):** flag beyond ±35% of
  73.6 ms (≈ outside 48–99 ms). Sub-±35% moves are inside plausible noise
  for a single run on this host.
- **Analyzer per-fixture p50:** flag beyond ±50% of the fixture's baseline
  mean. `perf-mixed-long` alone showed 37% pure repeat noise, so smaller
  per-fixture moves must not be read as regressions from one run.
- **p95-style figures:** the cold-start p95 varied 26% across identical
  passes at n=3 processes; per §11, do not quote single-run p95 values as
  precise, and never gate on them at this sample size.

## Contract notes (§11 honored)

- Shared CI runners are noisier than this host; these numbers are a
  same-host baseline, not a CI gate. A CI-side budget would need its own
  runner-population baseline first.
- Model/backends latency is out of scope here (local deterministic analysis
  and process startup only); rewrite-path call/token budgets stay a separate
  §11 line with their own unknown/null reporting rules.
- Baseline refresh: rerun the same 5-pass procedure, record SHA + environment
  + reason next to the new numbers; do not overwrite this record.
