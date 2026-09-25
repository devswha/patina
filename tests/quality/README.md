# Quality Benchmark

Deterministic measurement of patina's stylometry / lexicon signal layer
against a labeled fixture set. Runs with no LLM calls, no API key, no
network — fast enough to run on every CI build.

> This is one layer of the repo's measurement harness. See
> [docs/HARNESS.md](../../docs/HARNESS.md) for the full tool map (benchmark,
> calibration, signal-impact, LLM-quality, and gates).

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
follows the OR rule from `core/stylometry.md` §6 (core signals shown below; `scripts/signal-impact.mjs` enumerates the current full set of 7 paragraph + 2 document signals, see `docs/HARNESS.md`):

```
paragraph is SUSPECT iff
  burstiness_band == "low"  OR
  MATTR_band == "low"       OR
  (lexicon_density > threshold AND lexicon_min_hits is satisfied) OR
  koDiagnostics.hot == true
```

`burstiness_band` is only assigned when a paragraph has at least three
sentences; two-sentence CV is recorded for diagnostics but is not stable enough
to classify a paragraph by itself. For ko/zh/ja, a single lexicon hit is also
only an audit hint; the default hot threshold requires at least two CJK hits.
to make the paragraph hot by itself.

For `lang=ko`, `analyzeText()` also records Korean diagnostic fields:
`spacing`, `comma`, and `posDiversity` (a suffix-class proxy, not a morphology
analyzer). They only affect the hot/cold decision through the conservative
`koDiagnostics` composite: at least four sentences, at least 20 eojeols, fewer than one comma per sentence, regular eojeol length (`CV <= 0.38`), and low suffix-class diversity (`classDiversity <= 0.26`).

Per-language metrics use `expected_hot=true` as the positive class.

## Opt-in live scoring

The [live scorer report](../../docs/benchmarks/live-scorer-20260905.md) covers
931 observations on 49 curated fixtures. The [private rebaseline report](../../docs/benchmarks/live-rebaseline-20260905.md) adds 85 nullable-label
observations with captured-input replay. Both report language and pattern-pack
distributions; they do not establish human-authorship accuracy or add a CI gate.
See the [collection runbook](../../docs/research/rebaseline-score-collection-20260905.md)
for explicit preparation, approval, execution and receipt-only replay.

## Opt-in live rewrite quality

`npm run quality:live` runs the live-quality runner without calling a model by
default. The default path scores fixture inputs and marks the live rewrite step
as skipped, so it is safe for local smoke checks and CI dry-runs.

```bash
npm run quality:live
npm run quality:live -- --json
```

To run actual rewrites, opt in explicitly with an OpenAI-compatible provider.
Use `PATINA_LIVE_*` so this stays a deliberate local/manual probe rather than a
per-PR network dependency:

```bash
PATINA_LIVE=1 \
PATINA_LIVE_PROVIDER=gemini \
PATINA_LIVE_API_KEY=... \
npm run quality:live -- --language ko --limit 1
```

Supported live settings:

- `PATINA_LIVE_PROVIDER` — provider preset (`openai`, `gemini`, `groq`,
  `kimi`, `moonshot`, `together`).
- `PATINA_LIVE_API_KEY` — live-run key; falls back to the provider key or
  `PATINA_API_KEY`.
- `PATINA_LIVE_MODEL` / `PATINA_LIVE_API_BASE` / `PATINA_LIVE_TIMEOUT_MS`.

### Fixed judge (recommended for cross-model comparisons)

By default the candidate model also grades its own rewrite (`scoreText`,
`scoreMPS`, `scoreFidelity`), so scores are not comparable across candidate
models and are noisy run-to-run. Pin the grading side to one fixed judge with
`--judge-*` flags or `PATINA_LIVE_JUDGE_*` env vars:

**Which judge:** measured on the 44-doc KO calibration corpus
([docs/research/2026-judge-calibration.md](../../docs/research/2026-judge-calibration.md)).

| judge | AUC | repeat SD | s/call | what it spends |
|---|---:|---:|---:|---|
| `PATINA_LIVE_JUDGE_MODEL=gpt-5.3-chat-latest` (OpenAI HTTP) | **0.99** | 2.9 | **2.3** | ~$0.02/fixture; no seat quota, no training — but a moving alias |
| `PATINA_LIVE_JUDGE_MODEL=gemini-3.6-flash` (HTTP) | 0.96 | 2.2 | 4.6 | near-free tier — but it may train on submitted text |
| `--judge-backend codex-cli --judge-model gpt-5.5` | **1.00** | 2.2 | 14 | **your ChatGPT seat quota** (~12k tok/call incl. agent scaffolding) |
| non-reasoning lower-tier (grok-4.20-nr, deepseek thinking-off) | 0.70–0.71 | — | 0.2–0.7 | **unusable** — missed 20–23 of 24 AI docs |

Those AUC numbers measure telling AI prose from human prose — not grading
meaning, which is what the product actually gates on. Run
`scripts/research/judge-rubric-check.mjs` before adopting a judge; it puts ten
constructed cases with known-correct verdicts in front of it. Measured
2026-07-27: `gpt-5.5` on a codex seat 10/10, `gemini-3.6-flash` 9/10 with the
dangerous kind of miss — it accepted a rewrite that changed 120ms to 12ms at
MPS 80, where gpt-5.5 caught it at 66.7. Prefer the codex seat for grading.

Default to **gpt-5.3-chat-latest** for routine work: highest measured AUC per
second, no seat quota, no training clause (the only cheap judge allowed on
customer text), ~$0.02 per fixture. Its one flaw is that `-latest` is a moving
alias with no dated 5.3 snapshot, so for numbers that must stay comparable
across weeks use a pinnable judge instead. Use **gemini-3.6-flash** when the
run must cost nothing and the text is repo-owned (free tier may train on
submissions). Reserve the **gpt-5.5 seat** for final gates and published
numbers — a subscription seat is not free, it is your own coding quota
(~12k tok/call, ~1.7M for a 36-fixture sweep).

Reasoning traces are not what makes a judge work: a strong non-reasoning model
(gpt-5.3-chat-latest) reached 0.99, while lower-tier non-reasoning models
missed nearly every AI document. Pick on measured discrimination, not on
whether the model "thinks".

```bash
PATINA_LIVE=1 \
PATINA_LIVE_API_BASE=https://token-plan.example/compatible-mode/v1 \
PATINA_LIVE_API_KEY=... \
PATINA_LIVE_MODEL=candidate-model \
PATINA_LIVE_JUDGE_API_BASE=https://api.anthropic.com/v1 \
PATINA_LIVE_JUDGE_MODEL=claude-sonnet-5 \
PATINA_LIVE_JUDGE_API_KEY=... \
npm run quality:live -- --language ko --limit 3
```

- `PATINA_LIVE_JUDGE_MODEL` / `--judge-model` — judge model id. With only this
  set, the judge reuses the primary endpoint and credential.
- `PATINA_LIVE_JUDGE_PROVIDER` / `PATINA_LIVE_JUDGE_API_BASE` — judge endpoint.
  A judge on a different host never reuses the primary key; supply
  `PATINA_LIVE_JUDGE_API_KEY` or the run fails closed.
- `PATINA_LIVE_JUDGE_TIMEOUT_MS` / `--judge-timeout-ms` — scoring budget
  (defaults to the primary timeout).
- `PATINA_LIVE_JUDGE_BACKEND` / `--judge-backend` — run the judge on a local
  **subscription CLI seat** (`codex-cli`, `claude-cli`, `gemini-cli`,
  `kimi-cli`) instead of a paid HTTP API; no judge API key required. Pair
  with `--judge-model` or let the backend use its documented default. CLI
  backends report no token usage, so cost accounting shows calls and wall
  time only.
  A seat is the cheapest bulk option: `--judge-backend gemini-cli
  --judge-model gemini-3.6-flash` scores through a logged-in Gemini CLI with
  no API key and no per-token billing. Measured 2026-07-27: 58.7s for one
  fixture's four scoring calls (~15s each) versus ~9s on the API, so it suits
  overnight or large sweeps and not iteration. Always pass `--judge-model`;
  without it the backend uses the frozen CLI default `gemini-2.5-pro`, about
  twice as slow.
- `PATINA_LIVE_BACKEND` / `--backend` — run the **rewrite** on a subscription
  CLI seat too. With both sides on seats a sweep spends nothing:

  ```bash
  node tests/quality/live-quality.mjs --live --language ko --limit 11 \
    --backend gemini-cli --model gemini-3.6-flash \
    --judge-backend codex-cli --judge-model gpt-5.5
  ```

  This is the default for bulk and overnight work. The codex seat also carries
  the only judge measured at AUC 1.00, so it is more accurate than the paid
  HTTP judges, not a downgrade.
- `--repeat <n>` — sample each fixture n times. Reported scores are medians,
  `result.repeat` carries every sample with its spread, and the status is the
  **worst** sample, so repeating can only expose instability, never hide it.
  Measured 2026-07-27: identical configurations swing ±20 MPS per fixture —
  `ko-blog-01` scored 45 in one sweep and 100 in three consecutive reruns — so a
  single sample cannot validate any change smaller than that. Use `--repeat 3`
  for a comparison you intend to act on, and pair it with the seats above so the
  extra samples cost nothing.
- `PATINA_LIVE_JUDGE_EXTRA_BODY` / `--judge-extra-body` — JSON object of
  provider-specific request fields for the scoring calls (candidate side:
  `PATINA_LIVE_EXTRA_BODY` / `--extra-body`). Main use is reasoning control,
  the dominant judge cost/latency distortion (93–95% of output tokens on
  reasoning-default models): DeepSeek `{"thinking":{"type":"disabled"}}`,
  Gemini `{"reasoning_effort":"low"}`, Alibaba `{"enable_thinking":false}`.

The report records the judge under `settings.judge`, and the Markdown header
prints `judge: <model>` (or `self` when unset).

### Usage & latency capture (judge cost accounting)

Every live call records wall time, paid attempt count, and normalized token
usage (`prompt_tokens`, `completion_tokens`, `reasoning_tokens`,
`cached_read_tokens`, `cache_write_tokens` — OpenAI-compat and native
Anthropic shapes both map in). Per-fixture results carry
`usage.candidate` / `usage.judge` aggregates and the JSON report sums them
under `summary.usage`. Failed paid retries are billed into the totals via
per-attempt usage, so schema-retry doubling and hidden reasoning tokens are
visible instead of silently distorting judge cost comparisons.

The fixture set lives in `tests/fixtures/live-quality/{en,ko}/*.md` with YAML
frontmatter (`fixture_id`, `language`, optional `documentType`, `anchors`,
`expected_focus`) plus the body text. The legacy
`tests/quality/live-fixtures.jsonl` remains loadable via `--fixtures`.

Live reports are structured JSON or Markdown with:

- `schema_version`, redacted settings, and policy floors.
- `before_score` / `after_score` from model-graded `scoreText`.
- `mps` from `scoreMPS`.
- `fidelity` from `scoreFidelity`.
- `pass`, `warn`, `error`, or `skipped` per fixture.

A live rewrite passes when `after_score <= 30`, MPS is at least 70, fidelity is
at least 70, and the AI score improved. Missing credentials, provider failures,
schema failures, and MPS/fidelity floor violations are `error` and exit
nonzero; AI-score target misses remain `warn` so the report is still usable.
Keep this out of mandatory CI unless the live model path is deliberately
allowed, because LLM output is non-deterministic and may incur provider cost.

## Rewrite A/B (default vs iterative-baseline)

`npm run quality:rewrite-ab` compares two rewrite configurations on the same
fixtures so multi-pass / pipeline questions are answered with data. This is
packaged, unsupported research. The module remains technically deep-importable
because the package has no `exports` map, but it is not a product API. The
default comparison is `single` (one-shot rewrite) vs `iterative-baseline` (the
baseline comparison arm with verification floors for MPS and fidelity).

```bash
PATINA_LIVE=1 PATINA_LIVE_PROVIDER=gemini PATINA_LIVE_API_KEY=... \
  npm run quality:rewrite-ab -- --configs single,iterative-baseline --language ko --limit 3
npm run quality:rewrite-ab -- --json
```

For each fixture it produces a rewrite per config, model-grades both
(before/after AI score, MPS, fidelity via `scoreText`/`scoreMPS`/`scoreFidelity`),
measures edit churn (word-level change ratio), and picks a per-fixture winner:
the lowest after-AI-score among configs that meet `verification.mps-floor` and
`verification.fidelity-floor`, with ties
broken on lower churn. The summary reports per-config means and head-to-head
wins. Like `quality:live` it is LLM-backed and opt-in (non-deterministic, may
incur cost); the comparison/aggregation core is unit-tested with injected
producers. Use this to decide whether a multi-pass/multi-agent pipeline earns
its cost before keeping it.

## Adversarial MPS fixtures

`npm run quality:adversarial-mps` validates a small, repo-owned fixture set
where explicit meaning anchors are preserved but AI-like wording remains. This
guards against treating MPS as a humanness score.

```bash
npm run quality:adversarial-mps
node scripts/adversarial-mps-report.mjs --check --json
```

Inputs live in `tests/quality/adversarial-mps/fixtures.jsonl`; the report is
written to `docs/research/adversarial-mps.md`. The gate is:

- anchor-MPS proxy ≥90;
- deterministic AI score ≥60;
- no private or scraped source text.

If this gate passes, the case is intentionally adversarial: meaning survived,
the iterative-baseline arm should prefer candidates that pass MPS and lower the AI
score, rather than letting high MPS hide recurring AI markers.

## 2025+ rebaseline manifest

`npm run benchmark:rebaseline` validates the public JSONL manifest scaffold and
prints matrix coverage. It does not collect text from vendors, call external
detectors, or turn a small sample into a headline claim.

```bash
npm run benchmark:rebaseline
npm run benchmark:rebaseline:report
node scripts/rebaseline-summary.mjs --input tests/quality/rebaseline-manifest.example.jsonl --json
npm run benchmark:rebaseline:intake -- --input artifacts/rebaseline-2025/intake.example.jsonl --dry-run
npm run benchmark:rebaseline:intake -- --input artifacts/rebaseline-2025/intake.local.example.jsonl --dry-run --require-source-review
npm run benchmark:rebaseline:web -- --target-per-register 50 --max-per-source 12 --collected-at 2026-05-22
npm run benchmark:rebaseline:score -- --input artifacts/rebaseline-2025/private/web-human-controls.generated.private.jsonl --output artifacts/rebaseline-2025/human-controls.public.jsonl --scored-at 2026-05-22
node scripts/rebaseline-summary.mjs --input artifacts/rebaseline-2025/human-controls.public.jsonl --json
```

Each row records the source metadata needed by
`docs/research/2025-rebaseline-plan.md`: `sample_id`, `language`, `class`,
`register`, `model_family`, `provider`, `model`, `generated_at`, `prompt_id`,
`decoding`, `postprocess`, `redistribution`, and `text_hash`. Full `text` is
allowed only for redistributable rows (`repo-ok`, `redistributable`, public
license values). Private or vendor-copied rows must stay metadata-only and use
hashes.

For local/private corpus intake, use `npm run benchmark:rebaseline:intake`.
It computes missing `text_hash` values and writes a public manifest that strips
full text from non-redistributable rows while preserving the full row in the
gitignored private output. Use `--require-source-review` before pilot reports so
non-public rows must explain their redistribution status through `source_review`
or `reviewer_notes`. The tracked `artifacts/rebaseline-2025/intake.example.jsonl`
fixture and `artifacts/rebaseline-2025/intake.local.example.jsonl` 25-row
template are smoke checks only; real corpus rows stay local until a license
review says otherwise.

`artifacts/rebaseline-2025/human-controls.public.jsonl` is the first tracked
web-sourced Korean human-control candidate manifest. It is metadata/hash-only:
no raw source text is committed. Its deterministic outcome fields are register-stratified false-positive
evidence; public catch-rate claims require positive AI-like rows and claim-cell coverage, now provided by `rebaseline-2026.scored.public.jsonl` for KO+EN.

The #155 report is claim-ready only when the process gate is satisfied: scored outcome rows, at least three generator families across at least two languages, n≥100 per claim cell, and confidence intervals. The checked-in 2026 manifest now satisfies that gate for KO+EN.

`npm run benchmark:rebaseline:report` refreshes
`docs/benchmarks/rebaseline-latest.md` and `.json`. Use `tests/quality/rebaseline-manifest.example.jsonl` for a BLOCKED smoke fixture; use `artifacts/rebaseline-2025/rebaseline-2026.scored.public.jsonl` for the current READY public report.

## Score vs signal strength

The pre-commit prose gate keeps the older, conservative score semantics:

```text
score = hot_paragraphs / total_paragraphs * 100
```

That binary ratio decides pass/fail because it is stable for CI. The report also
prints two diagnostics:

- `signal` — average paragraph intensity of the strongest deterministic trigger:
  how far burstiness or MATTR is inside its low band, how far lexicon density
  is over the threshold, or how strong the Korean diagnostic composite is.
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
  The opt-in `npm run benchmark:scorer:live` exercises that path separately
  (#412); see [live scorer evaluation](#live-scorer-evaluation).
- Mandatory rewrite quality gates. Live rewrite quality lives in
  `tests/quality/live-quality.mjs` and remains opt-in because it can shell out
  to a model backend. It is configured through `PATINA_LIVE_*` variables
  (`PATINA_LIVE_BACKEND`, `PATINA_LIVE_PROVIDER`, `PATINA_LIVE_MODEL`, the
  `PATINA_LIVE_JUDGE_*` family); see the header of
  `tests/quality/live-quality.mjs`.
- Generalized model-era detector claims. The report now includes
  `signal_score` ranking diagnostics (ROC-AUC, PR-AUC, best-F1 threshold), but
  those numbers are still limited to the checked-in fixture corpus.

## Live scorer evaluation

`live-scorer-benchmark.mjs` runs the production LLM scorer on the 49 regression
fixtures across all four languages. Its reports include distributions by
language and pattern pack, requested/effective models, transport, token usage,
latency, and schema or transport failures. Invalid scores remain missing rather
than being counted as zero. These are opt-in diagnostics, not CI gates or
authorship claims.

```bash
npm run benchmark:scorer:live -- --live \
  --candidates docs/research/model-evaluation-20260904.json \
  --provider gemini --output artifacts/model-evaluation-20260904/scorer-gemini
```

The recorded comparison uses the local OpenCodex proxy for Gemini, without a
Gemini API key. Configure candidate IDs and transports explicitly in a separate
JSON file for another environment. `--manifest FILE --texts FILE` scores a
hash-bound rebaseline manifest against its local source texts; neither source
texts nor raw model responses enter the scorer report.

Manifest `text_hash` values accept SHA-256 hex with or without the `sha256:`
prefix and must match the exact supplied text. Declare `documentType` explicitly
for social or marketing diagnostics; dataset genre does not override the
configured delivery register or imply a document type. An absent or null
`expected_hot` remains unknown, participates in score distributions, and is
excluded from labeled comparisons and ranking metrics. These labels describe
editing hotspots, not authenticated authorship or human preference.

Automation-only short-form diagnostics do not require human ratings. Use inputs
whose intended processing is permitted; unknown rights are not permission.
Exact-zero counts and punctuation-pair deltas are descriptive observations,
not false-negative rates, human false-positive rates, or validated CI gates.

Completed rows are appended to `scorer-rows.jsonl`. Re-running the exact command
continues from the first unrecorded row. Changes to the corpus, candidate set,
or repeat count require a new output directory. Keep each worker's output
directory separate.

For the paired rewrite study, see
[`model-evaluation-20260904.md`](../../docs/research/model-evaluation-20260904.md).
The Linux-only `scripts/research/study-job.mjs` supervisor can retain process and
terminal receipts across an interrupted agent turn. Its `status` command checks
the current PID, process start time and boot identity; a stale file is not a
running job.

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
`stylometry.ko_diagnostics.bands` controls the ko-only composite. The private
KatFish calibration command below reports aggregate catch-rate and FP deltas
without committing external raw text:

```bash
npm run benchmark:katfish-ko -- --write --basename katfish-ko-latest
```

Treat that report as a KO diagnostic calibration artifact, not as a broad public
performance claim.

`npm run benchmark:report` also records a diagnostic `signal_score` sweep. The
prediction rule is `signal_score >= threshold`, and the PR-AUC value is average
precision over descending score groups. Use it to compare tuning candidates, not
as an authorship verdict.

## Languages

Currently runs on all supported pattern-pack languages: `ko`, `en`, `zh`, and
`ja`. Chinese and Japanese use a deterministic character-token fallback because
normal prose often has no whitespace; ko/en keep whitespace tokenization.
Korean additionally emits dependency-free spacing/comma/suffix-diversity
diagnostics and a conservative ko-only composite detector.
zh/ja now include high-precision AI-lexicon fixtures as well as
burstiness/MATTR regression coverage.

## AI-tells corpus baseline (deterministic, measurement-only)

`node scripts/ai-tells-corpus-baseline.mjs [--json] [--no-timestamp] [--strict]`

Measures the in-tree `analyzeText()` detector against the persona-calibration
evidence corpus (`artifacts/persona-calibration-2026/`): sycophancy (298),
lexical+structural tells (85), and human-controls (7). Emits per-category
confusion (`tp/fp/fn/tn`, recall, precision, fpr), Wilson 95% intervals, a
detector-signal-fire breakdown, and `term_family_coverage` (measurement only,
NOT a detector signal). `--strict` asserts exact counts 298/85/7 as a drift
guard and fails on any drift. `--json --no-timestamp` is byte-stable across runs.
Output carries only row hashes/ids and aggregates — never raw corpus text.

Human-control bodies live under `human-controls/raw/` (gitignored); when absent
(e.g. CI) their FP is reported as not-evaluated **smoke only**. n=7 cannot bound
FPR (0/7 still ~35% Wilson upper), so it is never a hard FP gate or public claim.
Test: `node --test tests/unit/ai-tells-corpus-baseline.test.js`.

## Scorer benchmark (end-to-end scoring path)

`npm run benchmark` above is an **analyzer-only** harness: it grades
`analyzeText().hot` and never runs the production scoring path. The scorer
benchmark closes that blind spot.

```bash
node tests/quality/scorer-benchmark.mjs
```

It runs the real scoring path — `scoreDeterministicSignals()` +
`reconcileScoreOverall()` (both in `src/scoring.js`) — over a small labeled
fixture set, with the **LLM mocked to overall 0** (worst case). Any non-zero
final score therefore comes from deterministic hard evidence alone, and any
clean control that turns non-zero is a deterministic false positive. No LLM
calls, no API key — CI-safe.

Gates (non-zero exit on any violation, even under `--quiet`):

- `positive_zero_score_rate` — hard-evidence positives (near-proof markup
  leakage) whose final score is 0. Must be 0. This catches the
  regression where a short AI-leaked snippet scored 0 because `skipped=true`
  discarded the hard evidence floor.
- `false_positive_rate` — clean controls whose final score is > 0 at LLM 0.
  Must be 0.
- `skipped_evidence_discarded` — fixtures marked `skipped` that carry an
  `evidenceFloor > 0` yet whose final dropped below it. Must be 0.
- Per-fixture `skipped` / `evidenceFloor` / `final` expectations are pinned.

`stylometry-hot-no-floor` fixtures pin the inverse guard: a paragraph that is
analyzer-hot via a probabilistic signal (e.g. Korean ending-monotony) but has
no hard floor must NOT be promoted — the coarse per-paragraph hot ratio is not
an evidence floor, so the LLM's verdict stands.

Outputs `tests/quality/scorer-results.json` (gitignored).
