# ZH source-feasibility gate (Wave 3, G009) — GO/NO-GO recommendation

Feasibility assessment for a future Chinese (zh) human-control collection wave.
**This gate does not collect or commit any raw text.** It builds a candidate
source inventory (`artifacts/rebaseline-2025/sources.zh-public.jsonl`,
metadata-only), runs a bounded dry-run, and records a recommendation. The actual
GO/NO-GO decision — and any collection — is reserved for the maintainer.

## Candidate inventory

`artifacts/rebaseline-2025/sources.zh-public.jsonl` — 18 sources, metadata only
(url / language / register / domain / source_type / source_license /
source_review / reviewer_notes / redistribution / constraints; no raw text).

| register | source family | host | sources |
|---|---|---|---:|
| academic-summary | Wikipedia | zh.wikipedia.org | 6 |
| blog | Wikivoyage | zh.wikivoyage.org | 6 |
| technical-how-to | Wikibooks | zh.wikibooks.org | 6 |

All are Wikimedia projects under **CC BY-SA 4.0** — human-authored and
redistributable with attribution. To stay consistent with the KO/EN
metadata-first model, `redistribution` is set to `hash-only` (raw text would stay
in the gitignored private workspace; only hashes/metadata/scores would be
committed), which also avoids per-row CC BY-SA attribution-compliance burden.

## Dry-run evidence (no text written)

`benchmark:rebaseline:web --input sources.zh-public.jsonl --language zh
--target-per-register 5 --max-per-source 3 --dry-run`:

- Inventory validation: 18 rows load, **0 errors**.
- Would-collect: **13 candidates** at small caps across **3 registers**
  (academic-summary 5, blog 5, technical-how-to 3).
- Fetches succeed for zh.wikipedia.org and zh.wikivoyage.org; a few
  zh.wikibooks.org pages 404 or yield no prose (excluded by the script's
  CJK/script filter — zh forbids kana).

At the full default caps (`--target-per-register 50 --max-per-source 8`) the same
6+6 Wikipedia/Wikivoyage sources alone project to **~90–96 candidates** across
2 registers, and the working Wikibooks pages add a third — clearing the
**≥100 across ≥3 registers** bar with margin once the inventory is widened a
little.

## Register coverage

3 of 5 default registers are cleanly covered (academic-summary, blog,
technical-how-to). **Documented exception**: `product-doc` and `chat-update`
have no clean CC-licensed Wikimedia match; zh.wikinews.org (CC BY-SA) is a
candidate for `chat-update` in a follow-up, but its article-slug URLs were not
pinned here. The gate's ≥3-register minimum is met with this exception recorded.

## Recommendation: **GO (conditional)**

ZH collection is **feasible**: a license-clear (CC BY-SA 4.0), human-authored,
script-validated candidate pool across 3 registers exists, the inventory
validates, and the dry-run fetches and extracts correct-script paragraphs. Recommend
**GO** for a measure-only ZH wave that mirrors KO/EN, **conditioned on**:

1. Maintainer ratification of the CC BY-SA + hash-only redistribution choice.
2. A full collection run to confirm the ≥100-candidate yield (the dry-run only
   demonstrates the path, not the final count).
3. Accepting the 3-register scope (product-doc/chat-update deferred or sourced
   separately).

**This is a recommendation, not a decision. STOP for maintainer GO/NO-GO before
any ZH collection runs.**
