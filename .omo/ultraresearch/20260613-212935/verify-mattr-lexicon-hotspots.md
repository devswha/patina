# Verification: MATTR and Lexicon Hotspots

Date: 2026-06-13.

Purpose: empirically check whether the two clearest local analyzer hotspots are worth optimizing before recommending implementation work.

## Commands Run

1. Existing quality gate smoke:

```bash
npm run benchmark -- --quiet
```

Result: exit 0.

2. Node microbenchmark:

- Used `node --input-type=module`.
- Imported `mattr`, `analyzeText`, `parseLexiconMarkdown`, and `computeDensity`.
- Compared current `mattr()` with an inline rolling-unique-count implementation on synthetic token arrays.
- Compared current `computeDensity()` with an inline precompiled phrase-regex variant on synthetic English paragraphs.
- Measured `analyzeText()` on a 200-paragraph synthetic English document with preloaded lexicon.

## Output

```text
mattr equivalence n=1000: delta=0
mattr current n=1000: mean=2.98ms p50=2.63ms p95=5.63ms
mattr sliding n=1000: mean=0.56ms p50=0.29ms p95=4.20ms
mattr equivalence n=10000: delta=0
mattr current n=10000: mean=25.34ms p50=25.98ms p95=28.00ms
mattr sliding n=10000: mean=1.18ms p50=1.12ms p95=1.49ms
mattr equivalence n=100000: delta=0
mattr current n=100000: mean=247.11ms p50=251.75ms p95=254.56ms
mattr sliding n=100000: mean=13.65ms p50=13.85ms p95=14.22ms
computeDensity current 1000 paragraphs: mean=45.68ms p50=43.46ms p95=63.91ms
computeDensity compiled phrase regex 1000 paragraphs: mean=7.16ms p50=7.06ms p95=10.17ms
analyzeText en 200 paragraphs: mean=17.46ms p50=17.26ms p95=20.12ms
```

## Interpretation

- Rolling MATTR matched current output exactly on the synthetic cases tested (`delta=0`) and was about 18x faster on the 100k-token case.
- Precompiled phrase regexes were about 6x faster on the 1000-paragraph synthetic lexicon-density case.
- Whole `analyzeText()` on a 200-paragraph synthetic English document was already around 17ms mean on this machine, so these improvements matter most for playground long-paste responsiveness, batch/corpus runs, structural reanalysis, and future larger lexicons.

## Caveats

- Synthetic data is not a substitute for the benchmark corpus.
- Before implementation, add unit tests for rolling MATTR equivalence and lexicon-density equality across EN/KO/ZH/JA edge cases.
- A future performance benchmark should include checked-in fixtures and synthetic worst cases, with report-only p50/p95 numbers before adding CI gates.

