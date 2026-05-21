# Pattern Freshness Process

Status: quarterly review process. This is not a 2025+ benchmark report and must not be cited as evidence for catch-rate claims.
Related issues: #155, #160, #165.

Patina's patterns and AI lexicons are maintained as falsifiable detection hypotheses, not permanent truths. Every refresh has to preserve two constraints:

1. do not publish model-era performance claims without corpus evidence and confidence intervals;
2. do not add or keep a pattern/lexicon entry without a false-positive check against matched human controls.

## Cadence

Run a freshness review once per quarter, in the first maintenance window after quarter close:

| Quarter | Corpus freeze | Review target | Publish target |
|---|---|---|---|
| Q1 | Mar 31 | Apr week 2 | Apr week 4 |
| Q2 | Jun 30 | Jul week 2 | Jul week 4 |
| Q3 | Sep 30 | Oct week 2 | Oct week 4 |
| Q4 | Dec 31 | Jan week 2 | Jan week 4 |

A release can skip a quarter only when the maintainer records an issue comment with the reason, the next scheduled window, and whether README performance claims remain safe to display.

## Corpus refresh source

Each refresh builds a redistributable or privately auditable corpus snapshot. Public text goes under `artifacts/` or `tests/fixtures/` only when redistribution is allowed; otherwise commit metadata, hashes, metrics, and reviewer notes.

Minimum snapshot metadata:

- `snapshot_id`: stable id such as `2026-q2-ko-en-register-refresh`
- `collected_at`: ISO date or date range
- `languages`: one or more of `ko`, `en`, `zh`, `ja`
- `registers`: blog, academic-summary, product-doc, chat/update, technical how-to, or a documented addition
- `classes`: AI-like, natural/human, lightly edited AI, heavily edited AI
- `generators`: at least GPT-family, Claude-family, Gemini-family for benchmark claims; open-weight models are encouraged but do not replace the three-family minimum
- `human_controls`: source, license, and matching rule by language/register
- `redistribution`: `public`, `private`, or `summary-only`
- `commands`: exact Patina commands and commit SHA used for scoring

## Promotion criteria

An emerging pattern or lexicon entry can move from candidate to shipped only when its tracking issue includes a 50-document evaluation fixture or manifest:

- 25 hot documents where the candidate is expected to fire;
- 25 cold matched human/control documents where it should not fire;
- at least two registers unless the candidate is explicitly register-specific;
- no private text checked in without redistribution rights;
- `npm run benchmark` or a documented manual scoring command with the candidate enabled.

Promotion thresholds:

| Change type | Precision floor | Recall floor | False-positive gate | Extra rule |
|---|---:|---:|---:|---|
| new rewrite pattern | ≥0.80 on the 50-doc fixture | ≥0.50 | no severe false positives | before/after examples and semantic-risk note required |
| new score-only pattern | ≥0.70 | ≥0.40 | no severe false positives | must not alter rewrite output |
| lexicon entry | ≥4× hot-vs-cold document-frequency lift | n/a | cold document-frequency ≤5% unless register-scoped | needs per-entry provenance |
| threshold change | improves F1 or fixes documented FP/FN | n/a | must not regress protected fixtures | update expected ranges and benchmark report |

If a candidate misses the floor, keep the issue open as `research`/`benchmark` or close it as not actionable; do not ship by lowering the gate after the fact.

## Tracking issue requirements

Use `.github/ISSUE_TEMPLATE/pattern_proposal.yml` for each emerging candidate. The issue must include:

1. language and register scope;
2. the candidate signal and why existing patterns/lexicon do not already cover it;
3. a 50-doc fixture path, manifest path, or collection plan;
4. precision/recall or hot/cold firing evidence before merge;
5. false-positive risk and exclusion rule;
6. before/after rewrite examples when the candidate can rewrite prose.

One issue can group closely related phrase variants only when they share the same trigger, false-positive risk, and fixture.

## Frontmatter metadata

All shipped pattern packs and AI lexicons carry `corpus-snapshot:` frontmatter.

Current allowed statuses:

- `current`: validated in the latest quarterly snapshot.
- `partial`: some evidence exists, but not enough for broad benchmark claims.
- `needs-quarterly-refresh`: legacy pattern pack awaiting its next quarterly snapshot.
- `needs-re-mine`: legacy lexicon awaiting per-entry corpus provenance and a 2025+ paired corpus remine.
- `needs-external-calibration`: seeded entry set that requires an external or larger-language corpus before public accuracy claims.

For newly mined or re-mined lexicon entries, add per-entry provenance before changing shipped behavior:

```yaml
added: YYYY-MM-DD
source: <snapshot_id or corpus manifest path>
last_validated: YYYY-MM-DD
lift: "hot/cold document-frequency ratio, e.g. 5.2x"
```

Legacy lexicons can stay grouped under `corpus-snapshot:` until a remine lands, but they must not be described as fresh or 2025+ validated.

Current lexicon provenance state:

- English was re-mined on 2026-05-22 against the HAP-E English paired corpus and now stores per-entry lift evidence in `lexicon/provenance/ai-en.json`.
- Korean, Mandarin Chinese, and Japanese carry per-entry sidecars too, but legacy or starter entries keep `null` fields where the repository does not have entry-level source/lift evidence yet.

Run the provenance guard before changing lexicon behavior:

```bash
npm run lexicon:freshness
```

## Re-baseline claim gate

Issue #155 remains blocked until an executed report measures catch rate and false-positive rate on at least three model families across at least two languages with n≥100 per cell and binomial 95% confidence intervals. Until that report lands, README claims should point to the checked-in deterministic benchmark and label it as such.

Issue #160's English remine is complete, but issue #155 remains the broader public-claim gate. Do not cite lexicon remine results as overall detector catch-rate claims.
