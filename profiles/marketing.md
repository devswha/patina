---
profile: marketing
name: 마케팅/광고 프로필
version: 1.0.0
scope: 광고 카피, 마케팅 콘텐츠, 제품 소개, 랜딩 페이지, 프레스 릴리즈
voice-overrides:
  first-person: normal          # 1인칭 브랜드 목소리에 따라
  opinions: amplify             # 의견/포지셔닝 강화
  rhythm-variation: amplify     # 리듬 변화 강화
  humor: allow                  # 유머 허용 (브랜드에 따라)
  messiness: reduce             # 불완전 구조 절제 (전문성 유지)
  concrete-emotions: amplify    # 구체적 감정 호소 강화
pattern-overrides:
  ko:
    4: reduce                   # 홍보성 언어 — 마케팅에서는 일부 허용, 과도한 것만 교정
    17: reduce                  # 이모지 — 마케팅 자료에서 일부 허용
    14: reduce                  # 볼드체 — 마케팅 자료에서 강조 요소로 허용
    1: reduce                   # 중요성 부여 — 마케팅에서 일정 수준 허용, 과장만 교정
  en:
    4: reduce                   # Promotional — some promotional language allowed in marketing
    17: reduce                  # Emojis — allowed in marketing materials
    14: reduce                  # Boldface — emphasis element in marketing
    1: reduce                   # Significance — some allowed, only over-inflation corrected
  zh:
    4: reduce                   # 宣传性语言 — 마케팅에서 허용
    17: reduce                  # 表情符号 — 허용
    14: reduce                  # 加粗 — 허용
  ja:
    4: reduce                   # 宣伝的言語 — 마케팅에서 허용
    17: reduce                  # 絵文字 — 허용
    14: reduce                  # 太字 — 허용
---

# 마케팅/광고 프로필

마케팅 콘텐츠의 설득력을 유지하면서 AI가 생성한 뻔한 패턴을 제거한다. 홍보성 언어는 마케팅의 본질이므로 일정 수준 허용하되, AI가 찍어낸 듯한 제네릭 카피는 교정한다.

## 범위

광고 카피, 마케팅 콘텐츠, 제품 소개, 랜딩 페이지, 프레스 릴리즈. 기업 블로그는 `blog` 프로필이 더 적합.

## 어조 지침

- **브랜드 목소리를 반영한다.** 원문의 톤이 활기차면 활기차게, 고급스러우면 고급스럽게.
- **구체적으로 쓴다.** "최고의 솔루션" 대신 "응답 시간 3초 이내". 마케팅도 구체적일 때 설득력이 있다.
- **CTA(Call to Action)는 직접적으로.** 돌려 말하지 않는다.
- **경쟁사 비교 시 구체적 수치로.** "뛰어난 성능" 대신 "경쟁 제품 대비 40% 빠른 로딩".

## 적극 교정 대상

- **AI 고빈도 어휘 (#7):** "혁신적인 솔루션", "체계적인 접근" → 제품이 뭘 하는지 구체적으로.
- **과제와 전망 공식 (#6):** 마케팅 결론이 "밝은 미래가 기대된다"이면 실패. 구체적 CTA로 대체.
- **모호한 출처 (#5):** "업계 전문가 추천" → 누가, 어디서, 무슨 맥락에서?
- **유의어 순환 (#11):** 제품명을 일관되게. "우리 솔루션", "이 플랫폼", "해당 서비스" 혼재 금지.
- **표면적 분석 (#3):** "고객 경험을 혁신하며 비즈니스 가치를 극대화하고" → 어떻게?
- **챗봇 표현 (#19):** 마케팅 자료에 "궁금한 점이 있으시면" 포함 금지.
