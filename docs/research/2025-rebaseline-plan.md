# 2025+ Re-baseline Plan

Status: protocol template, no external detector/vendor claims yet.  
Owner: maintainers.  
Related issues: #155, #163, #170, #172, #213.

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

## Data rules

- Use redistributable prompts and generated text; do not check private user text into the repo.
- Store full text only when redistribution is allowed. Otherwise store hashes, metadata, and metrics.
- Keep generation metadata: model, provider, date, prompt id, decoding params, language, register, and any editing pass.
- Separate detector-facing evaluation from rewrite-quality evaluation.

## Metrics

For deterministic suspect-zone detection:

- accuracy, precision, recall, F1
- Wilson 95% confidence interval per language and register
- detector sub-signal breakdown: burstiness, MATTR, lexicon
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
