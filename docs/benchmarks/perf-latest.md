# Performance report (report-only)

Latency of the deterministic offline analyzer (`analyzeText`) over fixed fixtures.
**Report-only — not a release gate and not a latency threshold.** Timing is
machine-dependent; treat this as a local snapshot, not a CI-drift target.

- Generated at: 2026-06-13T19:25:18.992Z
- Node: v22.17.1 · linux/x64
- Passes: 7 measured (+1 warmup) per fixture
- Fixtures: 7
- Full data: [perf-latest.json](./perf-latest.json)

## Per size bucket

| bucket | fixtures | p50 ms | p95 ms | p99 ms | mean ms | texts/sec |
|--------|---------:|-------:|-------:|-------:|--------:|----------:|
| long | 1 | 0.489 | 0.489 | 0.489 | 0.489 | 2044.990 |
| medium | 2 | 0.592 | 1.113 | 1.113 | 0.853 | 1173.021 |
| short | 2 | 0.214 | 0.451 | 0.451 | 0.333 | 3007.519 |
| synthetic-lexicon | 1 | 1.241 | 1.241 | 1.241 | 1.241 | 805.802 |
| synthetic-mattr | 1 | 3.146 | 3.146 | 3.146 | 3.146 | 317.864 |

## Per fixture

| fixture | lang | bucket | chars | paras | p50 ms | p95 ms | p99 ms | mean ms | texts/sec |
|---------|------|--------|------:|------:|-------:|-------:|-------:|--------:|----------:|
| perf-en-medium | en | medium | 316 | 3 | 0.374 | 1.445 | 1.445 | 0.592 | 1688.793 |
| perf-en-short | en | short | 51 | 1 | 0.206 | 0.263 | 0.263 | 0.214 | 4680.850 |
| perf-ko-medium | ko | medium | 135 | 3 | 1.053 | 1.347 | 1.347 | 1.113 | 898.417 |
| perf-ko-short | ko | short | 31 | 1 | 0.415 | 0.641 | 0.641 | 0.451 | 2218.921 |
| perf-mixed-long | en | long | 727 | 6 | 0.440 | 0.783 | 0.783 | 0.489 | 2043.645 |
| perf-synth-lexicon | en | synthetic-lexicon | 10480 | 1 | 1.110 | 1.768 | 1.768 | 1.241 | 805.666 |
| perf-synth-mattr | en | synthetic-mattr | 27200 | 1 | 3.241 | 3.640 | 3.640 | 3.146 | 317.883 |

