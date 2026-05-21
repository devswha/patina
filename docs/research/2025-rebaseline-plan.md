# 2025+ Re-baseline Plan

Status: protocol template, no external detector/vendor claims yet.  
Owner: maintainers.  
Related issues: #155, #157, #160, #303, plus #156/#158/#159 for evaluator follow-up.

Patina's checked-in benchmark is a deterministic regression corpus. It is useful
for catching tokenizer, threshold, lexicon, and fixture drift. It is not enough
to claim performance against current LLM output. This plan defines the evidence
needed before making broader README or launch-page claims.

## Scope

Measure whether Patina flags **AI-like writing signals** and preserves meaning
after rewriting. Do not frame the result as authorship proof.

Minimum matrix:

| axis | minimum coverage |
|---|---:|
| languages | ko, en, zh, ja |
| classes | AI-like, natural/human, lightly edited AI, heavily edited AI |
| registers | blog, academic-summary, product-doc, chat/update, technical how-to |
| generators | at least one GPT-family, Claude-family, Gemini-family, and open-weight model |
| sample size | start at 25 paragraphs per language × class × register cell before publishing claims |

The 25-paragraph matrix is the first intake target for checking coverage holes.
It is not the public benchmark gate. The stricter claim gate remains the
`process/pattern-freshness.md` requirement: at least three generator families
across at least two languages with n≥100 per claim cell and binomial 95%
confidence intervals.


## Execution order

1. Start with Korean calibration (#303/#157): collect natural Korean controls for academic/종결-다, blog, product-doc, and community registers before changing KO thresholds again.
2. Then run the model-era rebaseline (#155): score the fixed manifest across at least three generator families and at least two languages.
3. Only after the paired corpus exists, re-mine lexicon entries (#160) with per-entry provenance and ≥4× hot/cold lift.
4. Use the same manifest for adversarial MPS, cross-judge, and blinded-panel follow-ups (#156/#158/#159) instead of creating separate incompatible samples.

## Data rules

- Use redistributable prompts and generated text; do not check private user text into the repo.
- Store full text only when redistribution is allowed. Otherwise store hashes, metadata, and metrics.
- Keep generation metadata: model, provider, date, prompt id, decoding params, language, register, and any editing pass.
- Separate detector-facing evaluation from rewrite-quality evaluation.

## Metrics

For deterministic suspect-zone detection:

- accuracy, precision, recall, F1
- Wilson 95% confidence interval per language and register
- detector sub-signal breakdown: burstiness, MATTR, lexicon, koDiagnostics
- expected metric ranges for checked-in fixtures

For rewrite quality:

- before/after AI-likeness score
- MPS or manual meaning-preservation notes
- named entity, number, negation, and causality preservation
- human reviewer preference where available

For external detector comparison:

- use `npm run benchmark:compare` for the in-tree analyzer
- add third-party rows manually through `scripts/detector-comparison.mjs --input <json>`
- record detector id, date, plan/version if visible, score, and hot/cold label
- avoid scraping and avoid automated vendor calls unless a service explicitly permits it

## Artifact layout

Recommended local/private layout before publishing sanitized summaries:

```text
artifacts/rebaseline-2025/
├── prompts.jsonl
├── generations.jsonl          # only redistributable text
├── generations.private.jsonl  # gitignored/private text if needed
├── patina-scores.jsonl
├── third-party.manual.json
├── reviewer-notes.jsonl
└── summary.md
```

Checked-in public summaries should live under `docs/benchmarks/` after review.

## Manifest scaffold

Use the checked-in example manifest to validate the metadata contract before
collecting a larger corpus:

```bash
npm run benchmark:rebaseline
npm run benchmark:rebaseline:report
node scripts/rebaseline-summary.mjs --input tests/quality/rebaseline-manifest.example.jsonl --json
```

The manifest row schema is intentionally metadata-first:

- required: `sample_id`, `language`, `class`, `register`, `model_family`,
  `provider`, `model`, `generated_at`, `prompt_id`, `decoding`, `postprocess`,
  `redistribution`, `text_hash`
- optional: `text` only when redistribution permits it, `patina_score`,
  `expected_hot`, `predicted_hot`, `reviewer_notes`

`text_hash` uses the same `sha256:<hex>` style as runtime manifests. If a row
contains `text`, the validator checks that the digest matches. If a row is
`metadata-only`, `private`, or `no-redistribution`, full text must stay out of
the repository.

`npm run benchmark:rebaseline:report` writes the sanitized summary to
`docs/benchmarks/rebaseline-latest.md` and `.json`. The example report is
expected to stay `BLOCKED`; use it to prove the gate is working, not as a public
performance claim.

Use the false-positive form for person-written samples that should feed the
human/natural side of future calibration:
<https://github.com/devswha/patina/issues/new?template=false_positive.yml>.

## Publication gate

Do not publish competitive claims until the report includes:

1. sample sizes by language, class, register, and generator
2. confidence intervals, not just point estimates
3. false-positive notes for human/natural prose
4. clear statement that Patina measures AI-like writing signals, not authorship provenance
5. reproducible commands or a manual collection protocol
6. issue/PR links for corpus additions and threshold changes

## Current baseline

The current checked-in report is `docs/benchmarks/latest.md`. It covers a small
curated suspect-zone corpus across ko/en/zh/ja and pins deterministic feature
ranges in `tests/fixtures/suspect-zones/expected-ranges.json`.
