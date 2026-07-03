---
schema: patina.persona.v1
id: preserve
name: 保留原意默认
lang: zh
source: library
depth: style-only
persona_depth_directive:
  content_scope: emphasis-and-coverage-only
  mps_advisory: false
  fidelity_advisory: false
mps:
  enforce: true
  floor: 70
fidelity:
  enforce: true
  floor: 70
blocks:
  preferred_words:
    active: false
    allow: []
    avoid: []
    density:
      target_per_1000_tokens: 0
      max_per_paragraph: 0
  preferred_metaphors:
    active: false
    allow: []
    forbid_new_facts: true
    max_new_metaphors_per_500_chars: 0
  explanation_habits:
    active: false
    moves: []
    avoid: []
  sentence_structure:
    active: false
  worldview:
    active: false
target_features: {}
---

# 保留原意默认

此正文仅供文档说明，描述保留原意的默认人格，不会包含在执行提示中。
