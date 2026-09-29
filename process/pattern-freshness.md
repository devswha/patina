# Pattern freshness

Patterns and lexicons describe writing habits that can change as models and
usage change. This page maps the available evaluation tools and metadata.
Historical tracking includes issues #155, #160, and #165.

## Evaluating a candidate

Useful comparisons include examples where a candidate fires, matched human
controls, register-specific false positives, and before/after rewrites.
Precision, recall, document-frequency lift, and meaning changes answer different
questions. Sample size and uncertainty help describe how far a result generalizes.

A refresh can revise, replace, or remove a pattern or lexicon entry. Collection
size and experiment design depend on the question being investigated.

```bash
npm run benchmark
npm run benchmark:report
npm run benchmark:signal-impact
npm run lexicon:freshness
```

The optional [pattern proposal form](../.github/ISSUE_TEMPLATE/pattern_proposal.yml)
can collect examples and measurements. Existing corpus reports are in
[`docs/benchmarks/`](../docs/benchmarks/).

## Corpus metadata

Corpus manifests commonly record a snapshot ID, collection date, languages,
registers, classes, generator models, human-control sources, redistribution
status, and scoring command/revision. A public manifest can contain hashes and
aggregates when source text is private.

## Frontmatter and provenance

Pattern packs and lexicons use `corpus-snapshot:` frontmatter. Existing values
include `current`, `partial`, `needs-quarterly-refresh`, `needs-re-mine`, and
`needs-external-calibration`. These describe the recorded evidence state.

Per-entry lexicon provenance includes:

```yaml
added: YYYY-MM-DD
source: <snapshot_id or corpus manifest path>
last_validated: YYYY-MM-DD
lift: "hot/cold document-frequency ratio, e.g. 5.2x"
```

English entries include the 2026-05-22 HAP-E paired-corpus evidence in
`lexicon/provenance/ai-en.json`. Korean, Chinese, and Japanese also have sidecars;
legacy or starter entries use `null` where entry-level source/lift evidence is
unavailable. `npm run lexicon:freshness` checks sidecars against shipped entries.

An entry's validation history and an overall detector-performance study measure
different things. Dated reports retain their corpus, model, and revision context.
