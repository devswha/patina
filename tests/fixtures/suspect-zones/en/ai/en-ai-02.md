---
fixture_id: en-ai-02
language: en
class: ai
expected_hot: true
expected_metrics:
  detectors:
    burstiness: true
    koDiagnostics: false
    mattr: false
    lexicon: false
    endingMonotony: false
    candor: false
    thematicBreak: false
why_designed_this_way: |
  Burstiness-only fixture. The current analyzer measures the sentence-length
  pattern as low-CV while MATTR stays high, so the expected detector attribution
  is burstiness=true and MATTR/lexicon/diagnostic discourse signals stay cold.
  No catalogued patterns: no "robust", no "leverage", no connector overload, no
  chatbot closings, no 3-of-3 list structures.
topic: urban cycling
---

Cities around the world are investing in cycling infrastructure to make urban bike travel safer. Dedicated bike lanes help riders navigate city streets without competing with car traffic. Expanding cycling infrastructure gives urban commuters a reliable alternative to driving or transit. When a city builds more bike paths, rider numbers tend to rise across all age groups. Cycling infrastructure improvements make cities more accessible and reduce urban congestion over time.
