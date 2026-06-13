# Performance report (report-only)

Latency of the deterministic offline analyzer (`analyzeText`) over fixed fixtures.
**Report-only — not a release gate and not a latency threshold.** Timing is
machine-dependent; treat this as a local snapshot, not a CI-drift target.

- Generated at: 2026-06-13T18:19:14.885Z
- Node: v22.17.1 · linux/x64
- Passes: 7 measured (+1 warmup) per fixture
- Fixtures: 7
- Full data: [perf-latest.json](./perf-latest.json)

## Per size bucket

| bucket | fixtures | p50 ms | p95 ms | p99 ms | mean ms | texts/sec |
|--------|---------:|-------:|-------:|-------:|--------:|----------:|
| long | 1 | 0.518 | 0.518 | 0.518 | 0.518 | 1930.502 |
| medium | 2 | 0.622 | 1.218 | 1.218 | 0.920 | 1086.957 |
| short | 2 | 0.245 | 0.490 | 0.490 | 0.368 | 2721.088 |
| synthetic-lexicon | 1 | 1.216 | 1.216 | 1.216 | 1.216 | 822.368 |
| synthetic-mattr | 1 | 3.347 | 3.347 | 3.347 | 3.347 | 298.775 |

## Per fixture

| fixture | lang | bucket | chars | paras | p50 ms | p95 ms | p99 ms | mean ms | texts/sec |
|---------|------|--------|------:|------:|-------:|-------:|-------:|--------:|----------:|
| perf-en-medium | en | medium | 316 | 3 | 0.398 | 1.559 | 1.559 | 0.622 | 1608.104 |
| perf-en-short | en | short | 51 | 1 | 0.241 | 0.302 | 0.302 | 0.245 | 4073.498 |
| perf-ko-medium | ko | medium | 135 | 3 | 1.257 | 1.438 | 1.438 | 1.218 | 820.682 |
| perf-ko-short | ko | short | 31 | 1 | 0.489 | 0.618 | 0.618 | 0.490 | 2041.142 |
| perf-mixed-long | en | long | 727 | 6 | 0.445 | 0.886 | 0.886 | 0.518 | 1928.951 |
| perf-synth-lexicon | en | synthetic-lexicon | 10480 | 1 | 1.117 | 1.478 | 1.478 | 1.216 | 822.696 |
| perf-synth-mattr | en | synthetic-mattr | 27200 | 1 | 3.394 | 4.341 | 4.341 | 3.347 | 298.820 |

