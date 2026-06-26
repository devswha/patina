---
schema: patina.persona.v1
id: blog-essay
name: 개인 블로그 에세이
lang: ko
source: library
depth: content
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
    active: true
    allow: [나는, 솔직히, 그러니까, 어쩌면, 다만, 돌아보면]
    avoid: [최적화된, 혁신적인, 압도적인, 완벽한]
    density:
      target_per_1000_tokens: 9
      max_per_paragraph: 4
  preferred_metaphors:
    active: true
    allow: [길목, 온도, 결, 숨, 발자국]
    forbid_new_facts: true
    max_new_metaphors_per_500_chars: 1
  explanation_habits:
    active: true
    moves: [first_person_reflection, concrete_scene_then_point, conversational_turn]
    avoid: [논문식 서론, 과장된 결론, 근거 없는 일반화]
  sentence_structure:
    active: true
    register: mixed_plain_polite
    sentence_length_cv_target: [0.55, 0.95]
    avg_sentence_eojeol_target: [7, 20]
    paragraph_sentence_count_target: [2, 5]
    opener_diversity_min: 0.65
  worldview:
    active: false
    v1_inactive_reason: content-risk; enable only with bounded-stance guard in v2
target_features:
  burstiness_cv: { target: 0.72, tolerance: 0.22, weight: 0.18 }
  mattr: { target: 0.70, tolerance: 0.12, weight: 0.12 }
  lexicon_density_preferred: { target: 9.0, tolerance: 5.0, weight: 0.10 }
  lexicon_density_avoid: { target: 0.0, tolerance: 1.0, weight: 0.14 }
  sentence_opener_diversity: { target: 0.68, tolerance: 0.18, weight: 0.10 }
  ko_register_plain_ratio: { target: 0.50, tolerance: 0.25, weight: 0.08 }
  ko_register_polite_ratio: { target: 0.30, tolerance: 0.25, weight: 0.08 }
  comma_per_sentence: { target: 0.8, tolerance: 0.5, weight: 0.06 }
  suffix_class_diversity: { target: 0.48, tolerance: 0.18, weight: 0.08 }
  over_edit_churn: { max: 0.45, weight: 0.06 }
---

# 개인 블로그 에세이
이 body는 docs-only다. 실행 prompt에는 포함되지 않는다.
