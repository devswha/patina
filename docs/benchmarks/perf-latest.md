# Performance report (report-only)

Latency of the deterministic offline analyzer (`analyzeText`) over fixed fixtures.
**Report-only — not a release gate and not a latency threshold.** Timing is
machine-dependent; treat this as a local snapshot, not a CI-drift target.

- Generated at: 2026-06-13T18:08:30.447Z
- Node: v22.17.1 · linux/x64
- Passes: 7 measured (+1 warmup) per fixture
- Fixtures: 7
- Full data: [perf-latest.json](./perf-latest.json)

## Per size bucket

| bucket | fixtures | p50 ms | p95 ms | p99 ms | mean ms | texts/sec |
|--------|---------:|-------:|-------:|-------:|--------:|----------:|
| long | 1 | 0.931 | 0.931 | 0.931 | 0.931 | 1074.114 |
| medium | 2 | 0.611 | 1.523 | 1.523 | 1.067 | 937.207 |
| short | 2 | 0.214 | 0.637 | 0.637 | 0.426 | 2350.176 |
| synthetic-lexicon | 1 | 1.623 | 1.623 | 1.623 | 1.623 | 616.143 |
| synthetic-mattr | 1 | 4.367 | 4.367 | 4.367 | 4.367 | 228.990 |

## Per fixture

| fixture | lang | bucket | chars | paras | p50 ms | p95 ms | p99 ms | mean ms | texts/sec |
|---------|------|--------|------:|------:|-------:|-------:|-------:|--------:|----------:|
| perf-en-medium | en | medium | 316 | 3 | 0.532 | 0.939 | 0.939 | 0.611 | 1636.965 |
| perf-en-short | en | short | 51 | 1 | 0.208 | 0.257 | 0.257 | 0.214 | 4667.049 |
| perf-ko-medium | ko | medium | 135 | 3 | 1.544 | 1.846 | 1.846 | 1.523 | 656.405 |
| perf-ko-short | ko | short | 31 | 1 | 0.640 | 0.687 | 0.687 | 0.637 | 1570.875 |
| perf-mixed-long | en | long | 727 | 6 | 0.859 | 1.209 | 1.209 | 0.931 | 1073.790 |
| perf-synth-lexicon | en | synthetic-lexicon | 10480 | 1 | 1.582 | 1.869 | 1.869 | 1.623 | 615.987 |
| perf-synth-mattr | en | synthetic-mattr | 27200 | 1 | 4.265 | 5.468 | 5.468 | 4.367 | 228.993 |

