---
schema: patina.persona.v1
id: blog-essay
name: 个人博客随笔（中文）
lang: zh
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
      - 我
      - 说实话
      - 后来
      - 也许
      - 回头看
      - 其实
    avoid:
      - 赋能
      - 打造
      - 释放巨大潜力
      - 开启新的篇章
      - 值得注意的是
      - 显得尤为重要
      - 助力
      - 高质量发展
    density:
      target_per_1000_tokens: 6
      max_per_paragraph: 3
  preferred_metaphors:
    active: true
    allow:
      - 路口
      - 温度
      - 纹理
      - 脚步
    forbid_new_facts: true
    max_new_metaphors_per_500_chars: 1
  explanation_habits:
    active: true
    moves:
      - first_person_reflection
      - concrete_scene_then_point
      - conversational_turn
    avoid:
      - 论文式开场
      - 夸大的结论
      - 缺乏依据的笼统概括
  sentence_structure:
    active: true
    register: mixed
    sentence_length_cv_target: [0.55, 0.95]
    paragraph_sentence_count_target: [2, 5]
    opener_diversity_min: 0.6
  worldview:
    active: false
target_features:
  burstiness_cv: { target: 0.70, tolerance: 0.25, weight: 0.16 }
  mattr: { target: 0.54, tolerance: 0.20, weight: 0.10 }
  lexicon_density_preferred: { target: 6.0, tolerance: 5.0, weight: 0.08 }
  lexicon_density_avoid: { target: 0.0, tolerance: 1.0, weight: 0.18 }
  sentence_opener_diversity: { target: 0.62, tolerance: 0.20, weight: 0.12 }
  comma_per_sentence: { target: 1.0, tolerance: 0.6, weight: 0.08 }
  over_edit_churn: { max: 0.5, weight: 0.08 }
---

# 个人博客随笔（中文）

此正文仅供文档说明，绝不进入执行 prompt。它塑造第一人称、带反思的博客语气：先给具体场景或片刻，再落到观点；口语化转折；句子长短交错。保留主张、数字、极性与因果，绝不为了文学化而编造事实。

target_features 只用语言中立特征。CJK 分词按字符回退，量级不同，故用较宽容差；dogfood 后再校准。
