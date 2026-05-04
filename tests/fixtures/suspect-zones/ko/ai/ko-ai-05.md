---
fixture_id: ko-ai-05
language: ko
class: ai
expected_hot: true
why_designed_this_way: |
  MATTR only. Heavy lexical cycling on a small content-word set: 등산/산행, 사람들/등산객,
  산/산길, 인기/관심 — each sentence restates the same conceptual ground with minor wording
  variation. Estimated MATTR ~0.44 (low band, well under 0.55). Sentence lengths show mild
  variation: 13, 15, 12, 14, 16 → CV ≈ 0.11 (not flagged by burstiness). Only MATTR fires.
  No catalogued patterns: no chatbot phrases, no excessive connectors, no 다양한 stacking,
  no hype vocabulary, no structural repetition markers.
topic: 등산 문화
---

최근 몇 년 사이 등산에 관심을 갖는 사람들이 많아졌다. 주말이 되면 산을 찾는 등산객들로 산길이 붐비는 모습을 볼 수 있다. 등산 인기가 오르면서 사람들 사이에서 산행 장비에 대한 관심도 함께 높아지고 있다. 산을 즐기는 등산객이 늘어날수록 산길 관리에 대한 필요성도 커지고 있다. 등산 문화가 확산되면서 산을 찾는 사람들의 연령대도 점점 넓어지고 있다.
