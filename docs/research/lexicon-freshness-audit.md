# Lexicon freshness audit

Status: English remine complete; multilingual provenance sidecars complete with honest legacy/null fields.
Related issue: #160.

Patina lexicons are detection hypotheses. They should not be described as fresh model-era evidence unless each entry has a corpus source and a false-positive check.

## Current frontmatter status

| file | entries | current snapshot status | provenance | action |
|---|---:|---|---|---|
| `lexicon/ai-en.md` | 88 | `current` | `lexicon/provenance/ai-en.json` | keep; recheck at the next quarterly HAP-E or 2025+ paired refresh |
| `lexicon/ai-ko.md` | 33 | `current` | `lexicon/provenance/ai-ko.json` | 2026-07 remine 완료 (`docs/benchmarks/lexicon-freshness-ko-2026-07.md`) |
| `lexicon/ai-zh.md` | 60 | `needs-external-calibration` | `lexicon/provenance/ai-zh.json` | calibrate before broad claims |
| `lexicon/ai-ja.md` | 60 | `needs-external-calibration` | `lexicon/provenance/ai-ja.json` | calibrate before broad claims |

English was re-mined on 2026-05-22 against the HAP-E English paired corpus:
8,290 GPT-4o continuations versus 8,290 paired human `chunk_2` controls across
academic, blog, fiction, news, spoken, and TV/movie registers. Raw corpus text
stays in `artifacts/rebaseline-2025/private/`; only the aggregate report is
tracked.

Evidence:

- aggregate report: `docs/benchmarks/lexicon-freshness-en-2026-05-22.md`
- aggregate JSON: `docs/benchmarks/lexicon-freshness-en-2026-05-22.json`
- validation command: `npm run lexicon:freshness`

## English remine result

| decision | entries | rule |
|---|---:|---|
| kept | 88 | ≥4× hot-vs-cold document-frequency lift, at least one hot hit, cold document-frequency ≤5% |
| dropped | 20 | below the lift floor or zero hot hits |

Dropped English entries:

- strict: `state-of-the-art`, `enable`, `workflow`, `framework`, `dimensions`, `unleash`, `elevated`
- phrases: `a wide range of`, `a host of`, `in the age of`, `gain a deeper understanding`, `key drivers`, `driving force`, `play a key role`, `close the gap`, `end-to-end`, `to ensure that`, `it is essential to`, `under the hood`, `on the other hand`

## Per-entry remine gate

A refreshed entry needs:

```yaml
added: YYYY-MM-DD or null when the legacy add date is unknown
source: <snapshot id or corpus manifest path>
last_validated: YYYY-MM-DD or null when not yet externally validated
lift: <hot/cold document-frequency ratio or null>
```

Promotion floor from `process/pattern-freshness.md`:

- ≥4× hot-vs-cold document-frequency lift;
- cold document-frequency ≤5%, unless the entry is register-scoped;
- no severe false positives in matched controls;
- no private text checked into the repo.

## Next action

Do not re-add dropped English entries without a newer paired-corpus lift report.
For KO/ZH/JA, the sidecar fields exist but some `added`, `last_validated`, or
`lift` values remain `null` instead of invented. Treat those languages as
partial or calibration-pending until their own paired hot/cold reports land.
