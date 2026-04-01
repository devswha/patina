---
profile: medical
name: 의료/의학 문서 프로필
version: 1.0.0
scope: 임상 보고서, 의학 논문, 진료 가이드라인, 약물 정보, 환자 교육 자료
voice-overrides:
  first-person: reduce          # 1인칭 절제
  opinions: suppress            # 의견 억제, 근거 기반
  rhythm-variation: normal      # 리듬 변화 유지
  humor: suppress               # 유머 억제
  messiness: suppress           # 불완전 구조 억제
  concrete-emotions: reduce     # 감정 표현 절제
pattern-overrides:
  ko:
    23: reduce                  # 헤징 — 의학적 불확실성 ("~일 수 있다") 허용
    27: reduce                  # 수동태 — 방법론에서 수동태 허용
    18: reduce                  # 한자어/공식어 — 의학 용어에서 일부 허용
  en:
    23: reduce                  # Hedging — medical uncertainty ("may suggest") allowed
    26: reduce                  # Passive — standard in methods sections
    27: reduce                  # Zombie nouns — some nominalization acceptable in medical text
  zh:
    23: reduce                  # 过度弱化 — 의학적 불확실성 허용
    27: reduce                  # 被字句 — 방법론에서 수동태 허용
    18: reduce                  # 公文体 — 의학 문서 격식 허용
  ja:
    23: reduce                  # ヘッジング — 의학적 불확실성 허용
    18: reduce                  # である調 — 의학 문서 문체 허용
    16: reduce                  # 敬語 — 환자 교육 자료에서 일부 허용
---

# 의료/의학 문서 프로필

의학 문서의 엄밀성과 불확실성 표현을 보존하면서 AI 패턴을 제거한다. 의학적 헤징, 수동태, 전문 용어는 건드리지 않는다.

## 범위

임상 보고서, 의학 논문, 진료 가이드라인, 약물 정보, 환자 교육 자료. 건강 블로그나 대중 건강 기사는 `default` 프로필 사용.

## 어조 지침

- **의학적 정확성이 최우선이다.** 간결하게 만들더라도 의미를 바꾸지 않는다.
- **헤징은 허용한다.** "이 결과는 ~를 시사한다", "~와 관련이 있을 수 있다"는 의학에서 정당한 불확실성 표현.
- **수동태는 방법론에서 허용.** "환자는 무작위로 배정되었다"는 임상시험의 표준 표현.
- **전문 용어를 보존한다.** 의학 용어를 쉬운 말로 바꾸지 않는다 (환자 교육 자료 제외).

## 적극 교정 대상

- **과도한 중요성 부여 (#1):** "획기적인 치료법"은 임상 데이터가 뒷받침하지 않으면 위험. 적극 교정.
- **모호한 출처 (#5):** 의학에서 "연구에 따르면"은 어떤 연구인지 반드시 밝혀야. 적극 교정.
- **홍보성 언어 (#4):** 약물/치료법에 대한 과장 표현은 의학에서 특히 위험. 적극 교정.
- **과제와 전망 공식 (#6):** "더 많은 연구가 필요하다"로 끝나는 것은 AI 공식. 어떤 연구가 왜 필요한지 구체화.
- **AI 고빈도 어휘 (#7):** "혁신적인 치료 접근법", "체계적인 관리" 등은 AI 신호. 교정.
