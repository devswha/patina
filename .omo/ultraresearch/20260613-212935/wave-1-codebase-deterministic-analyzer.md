# Wave 1: Deterministic Analyzer Hot Path

Scope: read-only inspection of `src/features/*`, quality tests, and benchmark constraints for performance-improvement candidates.

## Digest

Patina's deterministic hot path is `analyzeText()` in `src/features/index.js`. It normalizes text, splits paragraphs, runs document-level leakage/discourse/translationese/structural checks, then computes paragraph-level burstiness, MATTR, lexicon density, Korean diagnostics, and detector flags.

High-leverage local targets:

1. `mattr()` allocation and complexity
   - `src/features/stylometry.js` lines 120-136 lowercases tokens, slices every moving window, and creates a new `Set` for every window.
   - This is `O(n * window)` with high allocation churn.
   - Called from `src/features/index.js` lines 117-119 and again by `src/features/structural-features.js` lines 71-111.

2. Lexicon phrase regex compilation
   - `src/features/lexicon-core.js` lines 50-78 lowercases the paragraph, builds a token set, loops strict and phrase entries, and calls `phraseToRegex()` per phrase per paragraph.
   - The repeated `RegExp` construction and full-text scans scale with lexicon size and paragraph count.

3. Korean diagnostics repeated tokenization
   - `src/features/index.js` lines 212-230 calls Korean spacing, comma density, POS proxy, and classifier helpers.
   - `src/features/stylometry.js` lines 414-468 repeats eojeol/token/length work across helpers.

4. Structural feature extraction duplicates analyzer work
   - `src/features/structural-features.js` lines 71-111 re-splits/re-tokenizes the document and recomputes burstiness/MATTR when the structural model path is enabled.

5. Translationese regex/overlap scans
   - `src/features/translationese.js` lines 111-173 scans each rule and deduplicates overlaps with a sorted pass plus `some()` checks.
   - Probably secondary today, but grows with rule count and Korean match density.

## Guardrails

- `tests/quality/benchmark.mjs` lines 151-260: fixture-level expected hot/cold behavior and regression ranges.
- `tests/quality/README.md` lines 23-46: hot decision rule.
- `tests/unit/stylometry.test.js`: split/token/burstiness/MATTR coverage.
- `tests/unit/lexicon.test.js`: CJK lexicon fallback and analyzeText lexicon behavior.
- `tests/unit/stylometry-ko.test.js`: Korean diagnostics.
- `tests/unit/translationese.test.js`: translationese catalog and overlap/advisory behavior.

## EXPAND Closed By Verification

- Rolling MATTR: verified in `verify-mattr-lexicon-hotspots.md`.
- Precompiled phrase regexes: verified in `verify-mattr-lexicon-hotspots.md`.
- Korean single-pass diagnostics: not benchmarked in this session; still a plausible second-phase optimization.
- Structural feature reuse: not benchmarked in this session; depends on whether structural models are active in production paths.

