# JA source-feasibility gate (Wave 4, G010) — GO/NO-GO recommendation

Feasibility assessment for a future Japanese (ja) human-control collection wave.
**This gate does not collect or commit any raw text.** It builds a candidate
source inventory (`artifacts/rebaseline-2025/sources.ja-public.jsonl`,
metadata-only), runs a bounded dry-run, and records a recommendation. The actual
GO/NO-GO decision — and any collection — is reserved for the maintainer.

## Candidate inventory

`artifacts/rebaseline-2025/sources.ja-public.jsonl` — 18 sources, metadata only
(url / language / register / domain / source_type / source_license /
source_review / reviewer_notes / redistribution / constraints; no raw text).

| register | source family | host | sources |
|---|---|---|---:|
| academic-summary | Wikipedia | ja.wikipedia.org | 6 |
| blog | Wikivoyage | ja.wikivoyage.org | 6 |
| technical-how-to | Wikibooks | ja.wikibooks.org | 6 |

All are Wikimedia projects under **CC BY-SA 4.0** — human-authored and
redistributable with attribution. Consistent with KO/EN, `redistribution` is set
to `hash-only` (raw text would stay in the gitignored private workspace; only
hashes/metadata/scores would be committed), which also avoids per-row CC BY-SA
attribution-compliance burden. The collector's `ja` script filter **requires
kana** (≥5 kana chars), so Han-only Chinese text is rejected — the JA/ZH
disambiguation holds.

## Dry-run evidence (no text written)

`benchmark:rebaseline:web --input sources.ja-public.jsonl --language ja
--target-per-register 5 --max-per-source 3 --dry-run`:

- Inventory validation: 18 rows load, **0 errors**.
- Would-collect: **15 candidates** at small caps across **3 registers**
  (academic-summary 5, blog 5, technical-how-to 5) — only 1 warning.
- ja.wikipedia.org, ja.wikivoyage.org, and ja.wikibooks.org all fetch and yield
  kana-validated Japanese paragraphs.

At the full default caps (`--target-per-register 50 --max-per-source 8`) the 6+6+6
sources project to **well over 100 candidates** across 3 registers (JA Wikibooks
yields better than its ZH counterpart).

## Register coverage

3 of 5 default registers are cleanly covered (academic-summary, blog,
technical-how-to). **Documented exception**: `product-doc` and `chat-update`
have no clean CC-licensed Wikimedia match; ja.wikinews.org (CC BY-SA) is a
candidate for `chat-update` in a follow-up. The gate's ≥3-register minimum is
met with this exception recorded.

## Recommendation: **GO (conditional)**

JA collection is **feasible** — arguably stronger than ZH (better Wikibooks
yield, clean kana validation). A license-clear (CC BY-SA 4.0), human-authored,
script-validated candidate pool across 3 registers exists, the inventory
validates, and the dry-run fetches and extracts kana-validated paragraphs.
Recommend **GO** for a measure-only JA wave mirroring KO/EN, **conditioned on**:

1. Maintainer ratification of the CC BY-SA + hash-only redistribution choice.
2. A full collection run to confirm the ≥100-candidate yield.
3. Accepting the 3-register scope (product-doc/chat-update deferred or sourced
   separately).

**This is a recommendation, not a decision. STOP for maintainer GO/NO-GO before
any JA collection runs.**
