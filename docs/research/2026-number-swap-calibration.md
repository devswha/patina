# Number-safety role-swap calibration — 2026-09-17

Scope: calibration round for #872 ("number-safety bag equality allows swapped
numeric roles"), run on `dev` after the #870/#901 CLI numeric-claim overlay.
The issue requires calibration before any implementation and forbids folding
a fix into the CLI overlay; nothing here is wired into the product.

## Question

Can a numeric claim be bound to its local predicate / entity / unit with
**high precision** — enough to reject role swaps like "shipped **3** features
and fixed **12** bugs" → "shipped **12** features and fixed **3** bugs" —
without false-firing on faithfully reordered lists?

## Method

- Fixture: `tests/fixtures/number-swap-calibration/number-swap-50.jsonl` —
  50 labeled pairs: 20 swaps (the issue's five classes plus ko/en variants:
  percent pairs, unit crossings 2024년/30명, clock times, prices, version
  years), 20 faithful reorders (clause/sentence/list reorders, active↔passive,
  Korean clause fronting), 8 drift rows (predicate swap, unit spelling,
  collapsed duplicates, hedges), and 2 documented polarity misses
  (increased↔decreased — antonym lists are a recorded non-goal).
- Harness: `scripts/number-swap-candidate-eval.mjs` (measurement only).
  A candidate fires when a context word shared by both sides carries a
  different value multiset — the signature of crossed bindings. Contexts
  present on one side only are drift and never fire.
- Four binding variants, all deterministic, LLM-free:
  - v1 — nearest content word (stopword-skipping, right-first)
  - v2 — v1 plus a `per/당` window (same-noun rate limits)
  - v3 — two nearest content words each side, Korean particles stripped
  - v4 — v3 scoped to the number's own clause

## Result (2026-09-17, 50-pair fixture)

| Variant | TP | FP | TN | FN | Precision | Recall |
|---|---:|---:|---:|---:|---:|---:|
| v1 nearest word | 9 | 3 | 25 | 11 | 0.75 | 0.45 |
| v2 + per/당 | 10 | 4 | 24 | 10 | 0.71 | 0.50 |
| v3 two-slot | 17 | 12 | 16 | 3 | 0.59 | 0.85 |
| v4 clause-scoped | 16 | 6 | 22 | 4 | 0.73 | 0.80 |

Both documented polarity misses stayed silent on every variant — the non-goal
held; nothing here reaches for antonym lists.

## Why no variant clears the bar

The two failure forces pull in opposite directions:

1. **Too narrow misses real swaps.** Shared unit nouns hide the binder one
   slot out ("Plan A costs **29** dollars", "버전 **2**는 **2021**년에"),
   so a nearest-word rule sees an unchanged value multiset.
2. **Too wide breaks faithful reorders.** The second slot crosses clause
   boundaries or lands on conjugated verbs ("확보했"↔"확보", "grew"↔
   "increased"), and reorders/passives legitimately rearrange those words —
   producing false swaps. Clause scoping (v4) removes half of them but not
   active↔passive or Korean verb-conjugation drift.

Separating the classes needs lemma-stable context and syntactic role
information — beyond a rule-class local binding, and beyond what 50 pairs
could calibrate even if the rules were right.

## Conclusion

**Not feasible at high precision with local-context binding.** Consistent
with #872's Expected: swapped-role cases stay the responsibility of MPS
HARD_FAIL plus the non-empty-anchor verify path (already shipped). Reopening
this question requires a larger labeled corpus and either lemma/syntax-aware
binding or model-assisted role tagging, measured before any product wiring.

Reproduce: `node scripts/number-swap-candidate-eval.mjs` (or `--json`).
