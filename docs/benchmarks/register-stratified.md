# Korean register-stratified false-positive plan

Status: 25-row pilot filled; threshold changes still blocked on representative rows.
Related issues: #157, #303, #155.

Korean registers do not share one false-positive profile. This page keeps threshold work blocked until each register has enough reviewed controls.

## Current tracked pilot

`artifacts/rebaseline-2025/human-controls.public.jsonl` currently contains 25 metadata/hash-only Korean human-control rows. The generated snapshot lives at `docs/benchmarks/register-stratified-latest.md`.

| register | current rows | target rows |
|---|---:|---:|
| academic / 종결-다 | 5 | 50 |
| product / technical docs | 5 | 50 |
| policy / notice / chat update | 5 | 50 |
| blog / community | 5 | 50 |
| technical how-to | 5 | 50 |

The current pilot has one predicted-hot row and 24 predicted-cold rows after the CJK lexicon single-hit guard. The same local set had five predicted-hot rows before that guard, all lexicon-only. This is useful false-positive evidence, but still intake evidence.

## Gate before threshold changes

Do not loosen or tighten Korean scoring thresholds until all gates below pass.

| gate | requirement |
|---|---|
| coverage | at least five registers have n≥50 reviewed human-control rows each |
| privacy | no raw private or no-redistribution text is committed |
| review | each row has source review notes or a license field |
| reporting | the report shows false positives by register, not only in aggregate |
| verification | any changed threshold is tested against `npm run benchmark` and `npm run benchmark:rebaseline` |

## Why this matters

The Korean diagnostic layer already adds spacing, comma, and suffix-class proxies. Those signals can help with generated boilerplate, but they can also flag formal Korean if the register mix is wrong. Register splits protect person-written formal prose before a threshold change ships.
