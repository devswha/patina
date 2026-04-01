---
profile: academic
name: 학술 논문/연구 보고서 프로필
version: 1.0.0
scope: 학술 논문, 연구 보고서, 학회 발표 자료, 석/박사 논문
voice-overrides:
  first-person: reduce          # 1인칭 사용 억제 (학술 관행)
  opinions: reduce              # 주관적 의견 억제, 근거 기반 서술
  rhythm-variation: normal      # 리듬 변화는 유지하되 과하지 않게
  humor: suppress               # 유머 억제
  messiness: suppress           # 불완전 구조 억제, 정돈된 서술 유지
  concrete-emotions: reduce     # 감정 표현 억제
pattern-overrides:
  ko:
    18: reduce                  # 한자어/공식어 — 학술에서는 자연스러운 수준 허용
    23: reduce                  # 헤징 — 학술적 불확실성 표현 ("~일 수 있다") 허용
    27: reduce                  # 수동태 — 방법론 기술에서 수동태 허용
  en:
    23: reduce                  # Hedging — academic convention allows "may suggest", "could indicate"
    26: reduce                  # Passive nominalization — standard in methods sections
    18: suppress                # Curly quotes — irrelevant in academic context
  zh:
    18: reduce                  # 公文体 — 학술 중국어에서 일정 수준 허용
    23: reduce                  # 过度弱化 — 학술적 헤징 허용
    27: reduce                  # 被字句 — 학술 문체에서 수동태 허용
  ja:
    18: reduce                  # である調 — 학술 일본어의 표준 문체
    23: reduce                  # ヘッジング — 학술적 완화 표현 허용
    16: reduce                  # 敬語 — 학술 문체에서는 비해당
---

# 학술 논문/연구 보고서 프로필

학술 문서의 관행을 존중하면서 AI 패턴을 제거한다. 헤징, 수동태, 격식체 등 학술 글쓰기에서 정당한 요소는 보존한다.

## 범위

학술 논문, 연구 보고서, 학회 발표 자료, 석/박사 논문. 과학 커뮤니케이션이나 대중 과학 글은 `default` 프로필 사용.

## 어조 지침

- **격식체를 유지한다.** 학술 문서의 격식 수준은 낮추지 않는다.
- **1인칭은 신중하게.** "We found that ~" 정도는 허용하되, 과도한 개인적 표현은 억제.
- **헤징은 허용한다.** "이 결과는 ~를 시사한다"는 학술에서 정당한 표현. 단, 헤지 3개 이상 중첩은 여전히 교정.
- **수동태는 맥락에 따라.** 방법론 섹션의 수동태는 허용. 결과/논의에서 불필요한 수동태는 교정.
- **유머, 감정, 여담은 억제.** 학술 문서에서는 부적절.

## 적극 교정 대상

- **AI 고빈도 어휘 (#7):** "혁신적인", "다양한" 등은 학술에서도 AI 신호. 구체적 서술로 교체.
- **과도한 중요성 부여 (#1):** "획기적인 성과"는 학술 문서에서도 남발됨. 데이터로 대체.
- **모호한 출처 (#5):** 학술 문서에서 "전문가에 따르면"은 더더욱 부적절. 구체적 인용 필수.
- **과제와 전망 공식 (#6):** 학술 논문 결론도 이 공식에 빠지기 쉬움. 구체적 후속 연구 방향으로 교체.
