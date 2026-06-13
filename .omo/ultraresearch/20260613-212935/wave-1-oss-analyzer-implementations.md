# Wave 1: OSS Analyzer Implementations

Scope: external OSS references for fast, auditable text analysis and stylometry architecture. Read-only, design-reference only.

## Strongest References

1. `spencermountain/compromise`
   - SHA inspected by subagent: `f653c8216833af331c8f299999b101f0522effc3`.
   - Useful pattern: staged builds (`one`, `two`, `three`, `four`), cache/freeze controls, lazy/tokenize APIs, and plugin partitioning.
   - Applicability: split Patina analysis into cheap baseline views and optional expensive derived metrics; cache document state for repeated UI/CLI analysis.
   - License fit: MIT.

2. `textstat/textstat`
   - SHA inspected: `e398f27543389283e847fc29568b049623c0e243`.
   - Useful pattern: cached language resources and narrow formula helpers.
   - Applicability: cache locale-specific resources and keep readability/diversity measures formula-driven.
   - License fit: MIT.

3. `LSYS/LexicalRichness`
   - SHA inspected: `69e6b8f381d6b86ec826911c3f0bb2fb298aac25`.
   - Useful pattern: explicit lexical-richness formulas and generator-style segmentation.
   - Applicability: add MTLD/MSTTR-style features without heavyweight NLP dependencies.
   - License fit: MIT.

4. `YuchuanTian/AIGC_text_detector`
   - SHA inspected: `c745a14bc522e60e433bb94f2fea535f4824981c`.
   - Useful pattern: separation of augmentation, priors, and training logic.
   - Applicability: evaluation/augmentation design, not runtime code, if Patina adds detector-training experiments.
   - License fit: Apache-2.0.

5. `clips/styloscope`
   - SHA inspected: `58b5640b400bcd266118dd7fabd26c7047d69c55`.
   - Useful pattern: one parsed document feeding readability, lexical diversity, POS/passive, and distributional features.
   - Applicability: architectural reference for single-pass feature extraction.
   - License fit: license unknown in inspected clone; do not copy source.

6. `SupervisedStylometry/SuperStyl`
   - SHA inspected: `0d348cab74a557d3aec3e953e56bacd8ae7d6b2a`.
   - Useful pattern: richer feature-engineering pipeline.
   - License fit: GPL-3.0; design-reference only for Patina's MIT distribution.

## Transferable Ideas

- Build a cached document view once: normalized text, paragraphs, sentences, tokens, lowercased tokens, token counts, char counts.
- Make expensive metrics staged/opt-in when they are not needed for the current command.
- Cache language resources at lexicon-load time, not per paragraph.
- Prefer direct formula implementations for lexical diversity and readability metrics.
- Keep benchmark/evaluation augmentation separate from runtime analyzer code.

