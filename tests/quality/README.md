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

## What it does NOT measure

- LLM-based scoring (`src/scoring.js`). The LLM is non-deterministic by
  design and adds API cost / latency, so it stays out of this layer.
  A separate live-mode benchmark would be its own follow-up.
- Rewrite quality (does the rewritten text read better?). That requires
  human or LLM grading and lives in `tests/e2e/quality-test.js`.
- AUROC against a ranked score — the current decision is binary
  (hot/cold), so we report accuracy + F1 instead.

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

4. Re-run `npm run benchmark` and confirm it classifies as expected.

## Tuning the thresholds

If a real-world corpus produces too many misclassifications, the bands
in `.patina.default.yaml` (`stylometry.burstiness.bands`,
`stylometry.ttr.bands`, `lexicon.density_threshold`) drive the
classification. Sweep against this benchmark + your own corpus and
update thresholds; the shipped values come from the v3.5.1 / v3.7
calibration documented in `core/stylometry.md` §13 §16.

## Languages

Currently runs on `ko` and `en` fixtures. `zh` and `ja` are tracked in
[issue #104](https://github.com/devswha/patina/issues/104) — they
require lexicon curation and tokenization-policy decisions before the
benchmark can be extended.
