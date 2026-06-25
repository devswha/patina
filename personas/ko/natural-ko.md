---
schema: patina.persona.v1
id: natural-ko
name: 담백한 한국어 (AI 티 제거)
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
    allow:
      - 담백하게
      - 사실
      - 실제로
      - 구체적으로
      - 그래서
    avoid:
      - 영양가
      - 독소
      - 정화
      - 주권
      - 웰니스
      - 비즈니스 웰니스
      - 대변혁
      - 획기적
      - 압도적
      - 혁신적
      - 패러다임
      - 시너지
    density:
      target_per_1000_tokens: 0
      max_per_paragraph: 0
  preferred_metaphors:
    active: true
    allow: []
    forbid_new_facts: true
    max_new_metaphors_per_500_chars: 0
  explanation_habits:
    active: true
    moves:
      - claim_first
      - plain_statement
    avoid:
      - 자기계발식 affirmation(독자 내면·소명·존재 치켜세우기)
      - 아첨/추임새(예리하십니다·정확한 통찰·핵심을 찔렀 같은 칭송)
      - 과장된 긍정과 응원조
      - 억지 비유(원문에 없던 비유로 포장)
      - 기계적 첫째·둘째·셋째 나열
      - 결산 상투구(결론적으로·시사하는 바가 크다·주목할 만하다)
      - 권고형 남발(~하시기 바랍니다·~해야 합니다 반복)
  sentence_structure:
    active: true
    register: plain
    sentence_length_cv_target: [0.5, 0.9]
    avg_sentence_eojeol_target: [8, 20]
    paragraph_sentence_count_target: [2, 5]
    opener_diversity_min: 0.55
  worldview:
    active: false
target_features:
  burstiness_cv: { target: 0.65, tolerance: 0.20, weight: 0.20 }
  mattr: { target: 0.68, tolerance: 0.12, weight: 0.14 }
  lexicon_density_avoid: { target: 0.0, tolerance: 1.0, weight: 0.20 }
  sentence_opener_diversity: { target: 0.60, tolerance: 0.20, weight: 0.12 }
  ko_register_plain_ratio: { target: 0.6, tolerance: 0.25, weight: 0.1 }
  comma_per_sentence: { target: 0.7, tolerance: 0.5, weight: 0.08 }
  suffix_class_diversity: { target: 0.42, tolerance: 0.18, weight: 0.08 }
  over_edit_churn: { max: 0.6, weight: 0.08 }
legacy_profile_bridge:
  profiles: [default]
  restyle_default: voice
---

# 담백한 한국어 (AI 티 제거)

이 body는 docs-only다. 사람들이 "AI가 쓴 것 같다"고 싫어하는 웰니스 직역체·아첨·hype 과장·억지 비유·기계적 나열을 걷어내고 담백한 평서체로 되돌리는 페르소나. 사실·주장·수치는 보존한다.
