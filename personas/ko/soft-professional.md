---
schema: patina.persona.v1
id: soft-professional
name: 부드러운 업무 문체
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
    allow: [확인, 요청, 제안, 공유, 검토, 가능하실까요]
    avoid: [송구하오나, 하명, 귀사의 무궁한 발전, 급합니다]
    density:
      target_per_1000_tokens: 7
      max_per_paragraph: 3
  preferred_metaphors:
    active: true
    allow: [정리, 방향, 흐름]
    forbid_new_facts: true
    max_new_metaphors_per_500_chars: 0
  explanation_habits:
    active: true
    moves: [context_briefly, clear_request, polite_next_step]
    avoid: [과한 격식어, 압박성 표현, 모호한 요청]
  sentence_structure:
    active: true
    register: polite_professional
    sentence_length_cv_target: [0.35, 0.75]
    avg_sentence_eojeol_target: [8, 18]
    paragraph_sentence_count_target: [1, 4]
    opener_diversity_min: 0.55
  worldview:
    active: false
    v1_inactive_reason: content-risk; enable only with bounded-stance guard in v2
target_features:
  burstiness_cv: { target: 0.48, tolerance: 0.18, weight: 0.16 }
  mattr: { target: 0.66, tolerance: 0.12, weight: 0.12 }
  lexicon_density_preferred: { target: 7.0, tolerance: 4.0, weight: 0.10 }
  lexicon_density_avoid: { target: 0.0, tolerance: 1.0, weight: 0.14 }
  sentence_opener_diversity: { target: 0.58, tolerance: 0.18, weight: 0.10 }
  ko_register_plain_ratio: { target: 0.10, tolerance: 0.18, weight: 0.08 }
  ko_register_polite_ratio: { target: 0.75, tolerance: 0.18, weight: 0.08 }
  comma_per_sentence: { target: 0.5, tolerance: 0.4, weight: 0.08 }
  suffix_class_diversity: { target: 0.38, tolerance: 0.16, weight: 0.08 }
  over_edit_churn: { max: 0.40, weight: 0.06 }
legacy_profile_bridge:
  profiles: [email, formal]
  restyle_default: voice
---

# 부드러운 업무 문체
이 body는 docs-only다. 실행 prompt에는 포함되지 않는다.
