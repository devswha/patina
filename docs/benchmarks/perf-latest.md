# Performance report (report-only)

Latency of the deterministic offline analyzer (`analyzeText`) over fixed fixtures.
**Report-only — not a release gate and not a latency threshold.** Timing is
machine-dependent; treat this as a local snapshot, not a CI-drift target.

- Generated at: 2026-06-13T17:32:45.884Z
- Node: v22.17.1 · linux/x64
- Passes: 7 measured (+1 warmup) per fixture
- Fixtures: 7
- Full data: [perf-latest.json](./perf-latest.json)

## Per size bucket

| bucket | fixtures | p50 ms | p95 ms | p99 ms | mean ms | texts/sec |
|--------|---------:|-------:|-------:|-------:|--------:|----------:|
| long | 1 | 0.651 | 0.651 | 0.651 | 0.651 | 1536.098 |
| medium | 2 | 0.717 | 1.283 | 1.283 | 1.000 | 1000.000 |
| short | 2 | 0.210 | 0.486 | 0.486 | 0.348 | 2873.563 |
| synthetic-lexicon | 1 | 2.770 | 2.770 | 2.770 | 2.770 | 361.011 |
| synthetic-mattr | 1 | 7.880 | 7.880 | 7.880 | 7.880 | 126.904 |

## Per fixture

| fixture | lang | bucket | chars | paras | p50 ms | p95 ms | p99 ms | mean ms | texts/sec |
|---------|------|--------|------:|------:|-------:|-------:|-------:|--------:|----------:|
| perf-en-medium | en | medium | 316 | 3 | 0.632 | 1.217 | 1.217 | 0.717 | 1394.951 |
| perf-en-short | en | short | 51 | 1 | 0.194 | 0.289 | 0.289 | 0.210 | 4757.031 |
| perf-ko-medium | ko | medium | 135 | 3 | 1.246 | 1.606 | 1.606 | 1.283 | 779.428 |
| perf-ko-short | ko | short | 31 | 1 | 0.455 | 0.692 | 0.692 | 0.486 | 2059.082 |
| perf-mixed-long | en | long | 727 | 6 | 0.602 | 0.928 | 0.928 | 0.651 | 1535.769 |
| perf-synth-lexicon | en | synthetic-lexicon | 10480 | 1 | 2.745 | 2.906 | 2.906 | 2.770 | 361.038 |
| perf-synth-mattr | en | synthetic-mattr | 27200 | 1 | 7.670 | 9.929 | 9.929 | 7.880 | 126.910 |

