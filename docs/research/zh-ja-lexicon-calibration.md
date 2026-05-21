# zh/ja AI-Lexicon Calibration Notes

This note documents the first checked-in zh/ja AI-lexicon pass for issue #104.
The goal is high precision: the lexicon should add signal when AI-style
scaffolding is dense, without turning ordinary Chinese or Japanese prose hot on
one phrase.

## Shipped packs

| file | entries | shape | matching note |
|---|---:|---|---|
| `lexicon/ai-zh.md` | 60 | phrase-only | substring + `~` wildcard |
| `lexicon/ai-ja.md` | 60 | phrase-only | substring + `~` wildcard |

Both packs avoid strict entries by default because zh/ja tokenization uses the
character fallback. Custom strict entries still work through the CJK substring
fallback added in `src/features/lexicon.js`.

## Regression corpus

The committed regression corpus now has 39 fixtures overall. The zh/ja slice in
this note remains:

| language | AI | natural | expected FP |
|---|---:|---:|---:|
| zh | 4 | 4 | 0 |
| ja | 4 | 4 | 0 |

The new lexicon-specific fixtures are:

- `tests/fixtures/suspect-zones/zh/ai/zh-ai-04-lexicon.md`
- `tests/fixtures/suspect-zones/zh/natural/zh-nat-04-lexicon-cold.md`
- `tests/fixtures/suspect-zones/ja/ai/ja-ai-04-lexicon.md`
- `tests/fixtures/suspect-zones/ja/natural/ja-nat-04-lexicon-cold.md`

`npm run benchmark` reports 100% fixture accuracy with zh/ja precision and
recall at 4/4 each. The lexicon-specific AI fixtures are lexicon-only hot: their
burstiness and MATTR detectors stay cold while lexicon density crosses the
threshold.

## Expansion rule

Before adding more entries, test candidates against at least these classes:

1. AI/guidance prose that uses broad summary scaffolds.
2. Wikipedia/news-style human prose.
3. Personal narrative or sensory prose.
4. Domain-heavy technical prose where repeated nouns are normal.

Drop any candidate that appears at similar frequency in class 2 or 4. A phrase
that is common in human explanatory writing should move to the pattern catalog
only if it has a rewrite strategy; otherwise it should stay out of the lexicon.

## Remaining calibration risk

The committed fixture set is a regression gate, not a full 200-paragraph external
corpus. The original #104 acceptance target called for HC3 zh and curated ja
AI-vs-human calibration. This PR adds the lexicon packs and local gates so the
feature can be exercised safely, but future expansion should still run the larger
external corpus before raising entry counts or lowering the density threshold.
