# Korean register-stratified false-positive plan

Status: KO human-control coverage gate met; threshold changes still blocked on positive controls.
Related issues: #157, #303, #155.

Korean registers do not share one false-positive profile. This page keeps threshold work blocked until register false positives and positive AI-like catch rates are both visible.

## Current tracked pilot

`artifacts/rebaseline-2025/human-controls.public.jsonl` currently contains 250 metadata/hash-only Korean human-control rows. The generated snapshot lives at `docs/benchmarks/register-stratified-latest.md`.

| register | current rows | target rows |
|---|---:|---:|
| academic / 종결-다 | 50 | 50 |
| product / technical docs | 50 | 50 |
| policy / notice / chat update | 50 | 50 |
| blog / community | 50 | 50 |
| technical how-to | 50 | 50 |

The current pilot has 42 predicted-hot rows and 208 predicted-cold rows, for a 16.8% point false-positive rate on the hash-only human-control sample. The split is uneven by register: chat/update is 4.0%, product-doc is 12.0%, academic-summary is 14.0%, blog is 20.0%, and technical-how-to is 34.0%.

That register spread is the main threshold-drift finding: a single Korean threshold would mostly be tuned by technical how-to false positives, while chat/update already looks conservative. Treat this as false-positive evidence for #157, not as a public performance claim.

## Gate before threshold changes

Do not loosen or tighten Korean scoring thresholds until all gates below pass.

| gate | requirement | status |
|---|---|---|
| coverage | at least five registers have n≥50 reviewed human-control rows each | met: 5/5 registers have n=50 |
| privacy | no raw private or no-redistribution text is committed | met: public rows are hash-only |
| review | each row has source review notes or a license field | met: rows carry source/license notes |
| reporting | the report shows false positives by register, not only in aggregate | met: see `register-stratified-latest.md` |
| positive controls | threshold change is checked against AI-like and edited-AI rows | blocked: no positive corpus yet |
| verification | any changed threshold is tested against `npm run benchmark` and `npm run benchmark:rebaseline` | blocked until a threshold changes |

## Recommendation

Close the register-coverage part of #157 from this evidence, but do not change Korean thresholds yet. The next calibration pass should add positive AI-like rows, then compare two options: register-aware reporting/dampening for technical documents, or a small global threshold adjustment only if recall does not regress.

## Why this matters

The Korean diagnostic layer already adds spacing, comma, and suffix-class proxies. Those signals can help with generated boilerplate, but they can also flag formal Korean if the register mix is wrong. Register splits protect person-written formal prose before a threshold change ships.
