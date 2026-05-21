# Korean register-stratified false-positive plan

Status: KO diagnostic bands calibrated; public performance claims still blocked on the wider rebaseline gate.
Related issues: #157, #303, #155.

Korean registers do not share one false-positive profile. This page keeps threshold work tied to both register false positives and positive AI-like catch rates.

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
| positive controls | threshold change is checked against AI-like and edited-AI rows | met for KO diagnostics via private KatFish aggregate; edited-AI still belongs to #155 |
| verification | any changed threshold is tested against `npm run benchmark` and `npm run benchmark:rebaseline` | met for the KO diagnostic band update |

## Recommendation

The KO diagnostic band update uses the KatFish aggregate report, not a public headline claim. It improves KatFish catch rate by +15.9 pp versus Patina without KO diagnostics while keeping the 250-row public-web human-control FP count unchanged at 42/250. Keep broader 2025+ public claims under #155 until multilingual, multi-family claim cells exist.

## Why this matters

The Korean diagnostic layer already adds spacing, comma, and suffix-class proxies. Those signals can help with generated boilerplate, but they can also flag formal Korean if the register mix is wrong. Register splits protect person-written formal prose before a threshold change ships.
