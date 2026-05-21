# Korean register-stratified false-positive plan

Status: blocked on representative rows.
Related issues: #157, #303, #155.

Korean technical docs, encyclopedic prose, policy notices, and community posts do not share one false-positive profile. This page keeps threshold work blocked until each register has enough reviewed controls.

## Current tracked pilot

`artifacts/rebaseline-2025/human-controls.public.jsonl` currently contains 10 metadata/hash-only Korean human-control rows.

| register | current rows | target rows |
|---|---:|---:|
| academic / 종결-다 | 0 | 50 |
| encyclopedic | 0 | 50 |
| product / technical docs | partial | 50 |
| policy / notice | partial | 50 |
| blog / community | partial | 50 |

The current pilot has one predicted-hot row and nine predicted-cold rows. That is intake evidence, not a register benchmark.

## Gate before threshold changes

Do not loosen or tighten Korean scoring thresholds until:

1. at least five registers have n≥50 reviewed human-control rows each;
2. no raw private or no-redistribution text is committed;
3. each row has source review notes or a license field;
4. the report shows false positives by register, not only in aggregate;
5. any changed threshold is tested against `npm run benchmark` and `npm run benchmark:rebaseline`.

## Why this matters

The Korean diagnostic layer already adds spacing, comma, and suffix-class proxies. Those proxies can help with generated boilerplate, but they can also flag formal Korean if the register mix is wrong. Register splits protect person-written formal prose before a threshold change ships.
