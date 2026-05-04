---
fixture_id: en-ai-02
language: en
class: ai
expected_hot: true
why_designed_this_way: |
  MATTR only. Heavy lexical cycling on a tight cluster: cycling/bike/bicycle,
  city/urban/cities, lane/infrastructure/path, rider/commuter — four semantic pairs
  reused across all five sentences with minimal lexical variation. Estimated MATTR ~0.47
  (low band, under 0.55). Sentence lengths: 15, 12, 16, 11, 14 → CV ≈ 0.14 (mid-low,
  not flagged by burstiness). Only MATTR fires. No catalogued patterns: no "robust",
  no "leverage", no connector overload, no chatbot closings, no 3-of-3 list structures.
topic: urban cycling
---

Cities around the world are investing in cycling infrastructure to make urban bike travel safer. Dedicated bike lanes help riders navigate city streets without competing with car traffic. Expanding cycling infrastructure gives urban commuters a reliable alternative to driving or transit. When a city builds more bike paths, rider numbers tend to rise across all age groups. Cycling infrastructure improvements make cities more accessible and reduce urban congestion over time.
