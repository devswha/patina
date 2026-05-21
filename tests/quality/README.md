# Quality Benchmark

Deterministic measurement of patina's stylometry / lexicon signal layer
against a labeled fixture set. Runs with no LLM calls, no API key, no
network — fast enough to run on every CI build.

## Run it

```bash
npm run benchmark
```

Outputs:
- A markdown table per language (accuracy, precision, recall, F1, confusion matrix)
- A list of any misclassified fixtures with their feature values
- `tests/quality/results.json` — full per-fixture log (gitignored)
- `docs/benchmarks/README.md` — report index, refresh commands, and public-claim rules
- `docs/benchmarks/latest.md` / `latest.json` when run via `npm run benchmark:report`
- `docs/benchmarks/detector-comparison.md` / `.json` when run via `npm run benchmark:compare`

## What it measures

Every fixture under `tests/fixtures/suspect-zones/{lang}/{ai|natural}/*.md`
carries an `expected_hot` label in its frontmatter. The benchmark runs
`analyzeText()` (defined in `src/features/index.js`) on the body and
compares the predicted hot/cold decision against that label. The decision
follows the 3-signal OR rule from `core/stylometry.md` §16:

```
paragraph is SUSPECT iff
  burstiness_band == "low"  OR
  MATTR_band == "low"       OR
  lexicon_density > threshold
```

Per-language metrics use `expected_hot=true` as the positive class.

## Opt-in live rewrite quality

`npm run quality:live` runs the live-quality scaffold without calling a model by
default. The default path scores fixture inputs and marks the live rewrite step
as skipped, so it is safe for local smoke checks and CI dry-runs.

```bash
npm run quality:live
```

To run actual rewrites, opt in explicitly after installing and authenticating
the OpenCode CLI:

```bash
OPENCODE_AVAILABLE=1 npm run quality:live -- --limit 1
OPENCODE_AVAILABLE=1 OPENCODE_MODEL=opencode/hy3-preview-free npm run quality:live -- --language ko --limit 1
```

The scaffold fixture set lives in `tests/quality/live-fixtures.jsonl`. Each
fixture records `fixture_id`, `language`, `register`, `source_type`,
`model_family`, `prompt_id`, `redistribution`, `facts`, and `text`. Live results
report:

- `before_score` / `after_score` from the deterministic prose score.
- `humanization_gain = before_score - after_score`.
- `meaning_safety`, a deterministic proxy using fact preservation and length
  sanity. This is not a full MPS score.
- `safe_gain = max(0, humanization_gain) * (meaning_safety / 100)`.
- `pass`, `warn`, or `fail` for evaluated rewrites; `skipped` when live mode is
  not enabled.

Passing evaluated rewrites should reach `after_score <= 30`,
`meaning_safety >= 70`, and `safe_gain > 0`. Keep this out of mandatory CI
unless the live model path is deliberately allowed, because LLM output is
non-deterministic.

## 2025+ rebaseline manifest

`npm run benchmark:rebaseline` validates the public JSONL manifest scaffold and
prints matrix coverage. It does not collect text from vendors, call external
detectors, or turn a small sample into a headline claim.

```bash
npm run benchmark:rebaseline
npm run benchmark:rebaseline:report
node scripts/rebaseline-summary.mjs --input tests/quality/rebaseline-manifest.example.jsonl --json
```

Each row records the source metadata needed by
`docs/research/2025-rebaseline-plan.md`: `sample_id`, `language`, `class`,
`register`, `model_family`, `provider`, `model`, `generated_at`, `prompt_id`,
`decoding`, `postprocess`, `redistribution`, and `text_hash`. Full `text` is
allowed only for redistributable rows (`repo-ok`, `redistributable`, public
license values). Private or vendor-copied rows must stay metadata-only and use
hashes.

The report keeps public performance claims blocked until the process gate in
`process/pattern-freshness.md` is satisfied: scored outcome rows, at least three
generator families across at least two languages, n≥100 per claim cell, and
confidence intervals.

`npm run benchmark:rebaseline:report` refreshes
`docs/benchmarks/rebaseline-latest.md` and `.json`. The checked-in example
report should stay blocked; a READY report requires a real scored manifest.

## Score vs signal strength

The pre-commit prose gate keeps the older, conservative score semantics:

```text
score = hot_paragraphs / total_paragraphs * 100
```

That binary ratio decides pass/fail because it is stable for CI. The report also
prints two diagnostics:

- `signal` — average paragraph intensity of the strongest deterministic trigger:
  how far burstiness or MATTR is inside its low band, or how far lexicon density
  is over the threshold.
- `pattern hits` — count of pattern-pack watch terms found in the stripped prose.
  This is diagnostic only; it helps reviewers see pattern-level cleanup that may
  not change the binary hot-paragraph ratio.

Treat both as editing diagnostics, not separate authorship verdicts or CI gates.
The prose gate uses the default deterministic thresholds and the current
Markdown pattern packs. Runtime scoring may use project config thresholds, so
compare `signal` values within the same entrypoint rather than across tools.

Report person-written paragraphs that cross the gate through the false-positive
form: <https://github.com/devswha/patina/issues/new?template=false_positive.yml>.
Include the exact paragraph, language/register, score output, and whether the
sample can become a public fixture.

## What it does NOT measure

- LLM-based scoring (`src/scoring.js`). The LLM is non-deterministic by
  design and adds API cost / latency, so it stays out of this layer.
  A separate live-mode benchmark would be its own follow-up.
- Mandatory rewrite quality gates. Live rewrite quality lives in
  `tests/quality/live-quality.mjs` and remains opt-in because it can shell out
  to OpenCode:

  ```bash
  OPENCODE_AVAILABLE=1 npm run quality:live -- --limit 1
  ```

  The scaffold uses `opencode/hy3-preview-free` by default. Override it with
  `OPENCODE_MODEL=<provider/model>` when testing another OpenCode model.
- Generalized model-era detector claims. The report now includes
  `signal_score` ranking diagnostics (ROC-AUC, PR-AUC, best-F1 threshold), but
  those numbers are still limited to the checked-in fixture corpus.

## Extending the corpus

1. Add a new fixture markdown with frontmatter:

   ```yaml
   ---
   fixture_id: ko-ai-06
   language: ko
   class: ai
   expected_hot: true
   expected_metrics:
     cv_band: low              # optional regression pin
     mattr_band: high          # optional regression pin
     lexicon_density_min: 0    # optional regression pin
     lexicon_density_max: 80   # optional regression pin
   why_designed_this_way: |
     Brief note on which signals you expect to fire.
   topic: <subject>
   ---

   <one paragraph of text>
   ```

2. Drop it under `tests/fixtures/suspect-zones/{lang}/{ai|natural}/`.

3. Add `expected_metrics` when a fixture is meant to pin a specific deterministic signal. This is useful for real-world chat-register fixtures where a future tokenizer or threshold change should fail loudly instead of silently changing the benchmark meaning.

4. Refresh the central per-fixture regression ranges after reviewing the new fixture:

   ```bash
   npm run benchmark:ranges
   ```

   This updates `tests/fixtures/suspect-zones/expected-ranges.json`, which pins CV, MATTR, lexicon density, and detector sub-signal expectations for every fixture.

5. Re-run `npm run benchmark` and confirm it classifies as expected.

## Third-party detector comparison

Patina does not scrape detector websites or send fixture text to vendors. For
manual comparisons:

```bash
cp tests/quality/detectors.manual.example.json /tmp/detectors.manual.json
$EDITOR /tmp/detectors.manual.json
node scripts/detector-comparison.mjs --input /tmp/detectors.manual.json
```

The checked-in report always includes Patina's own deterministic analyzer. Any
third-party rows are manual, timestamped, and opt-in.

## Tuning the thresholds

If a real-world corpus produces too many misclassifications, the bands
in `.patina.default.yaml` (`stylometry.burstiness.bands`,
`stylometry.ttr.bands`, `lexicon.density_threshold`) drive the
classification. Sweep against this benchmark + your own corpus and
update thresholds; the shipped values come from the v3.5.1 / v3.7
calibration documented in `core/stylometry.md` §13 §16.

`npm run benchmark:report` also records a diagnostic `signal_score` sweep. The
prediction rule is `signal_score >= threshold`, and the PR-AUC value is average
precision over descending score groups. Use it to compare tuning candidates, not
as an authorship verdict.

## Languages

Currently runs on all supported pattern-pack languages: `ko`, `en`, `zh`, and
`ja`. Chinese and Japanese use a deterministic character-token fallback because
normal prose often has no whitespace; ko/en keep whitespace tokenization.
zh/ja now include high-precision AI-lexicon fixtures as well as
burstiness/MATTR regression coverage.
