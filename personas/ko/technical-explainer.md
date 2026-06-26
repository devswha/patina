---
schema: patina.persona.v1
id: technical-explainer
name: 기술 설명형
lang: ko
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
    active: true
    allow: [구조, 흐름, 단계, 입력, 출력, 제약]
    avoid: [대충, 아무튼, 엄청, 마법처럼]
    density:
      target_per_1000_tokens: 7
      max_per_paragraph: 3
  preferred_metaphors:
    active: true
    allow: [파이프라인, 경계, 레이어]
    forbid_new_facts: true
    max_new_metaphors_per_500_chars: 0
  explanation_habits:
    active: true
    moves: [term_preservation, step_by_step, example_only_when_present]
    avoid: [원문에 없는 예시 추가, 용어 치환, 결론만 제시]
  sentence_structure:
    active: true
    register: polite_explanatory
    sentence_length_cv_target: [0.35, 0.70]
    avg_sentence_eojeol_target: [9, 21]
    paragraph_sentence_count_target: [2, 4]
    opener_diversity_min: 0.50
  worldview:
    active: false
    v1_inactive_reason: content-risk; enable only with bounded-stance guard in v2
target_features:
  burstiness_cv: { target: 0.50, tolerance: 0.18, weight: 0.16 }
  mattr: { target: 0.72, tolerance: 0.10, weight: 0.12 }
  lexicon_density_preferred: { target: 7.0, tolerance: 4.0, weight: 0.10 }
  lexicon_density_avoid: { target: 0.0, tolerance: 1.0, weight: 0.14 }
  sentence_opener_diversity: { target: 0.55, tolerance: 0.18, weight: 0.10 }
  ko_register_plain_ratio: { target: 0.20, tolerance: 0.20, weight: 0.08 }
  ko_register_polite_ratio: { target: 0.65, tolerance: 0.22, weight: 0.08 }
  comma_per_sentence: { target: 0.6, tolerance: 0.4, weight: 0.08 }
  suffix_class_diversity: { target: 0.40, tolerance: 0.16, weight: 0.08 }
  over_edit_churn: { max: 0.40, weight: 0.06 }
---

# 기술 설명형
이 body는 docs-only다. 실행 prompt에는 포함되지 않는다.
