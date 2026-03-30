---
profile: formal
name: 정형 문서 프로필
version: 1.0.0
scope: 이력서, 자기소개서, 사업 제안서, 공식 보고서, 커버레터
voice-overrides:
  first-person: reduce        # 1인칭 최소화 — 이력서는 행위 중심
  opinions: suppress           # 의견 삽입 억제 — 사실 중심
  rhythm-variation: allow      # 리듬 변화는 유지하되 과하지 않게
  humor: suppress              # 유머 억제 — 격식 문서에 부적절
  messiness: suppress          # "좀 지저분해도 괜찮다" 억제
  concrete-emotions: suppress  # 감정 표현 억제 — 성과와 사실 중심
pattern-overrides:
  ko:
    25: suppress               # 구조적 반복 — 정형 문서는 반복 구조가 정상 (경력 항목, 불릿 리스트)
    15: reduce                 # 인라인 헤더 — 이력서 불릿은 볼드 레이블이 관례
    14: reduce                 # 볼드체 — 이력서의 직함/회사명 볼드는 관례
    18: reduce                 # 한자어/공식어 — 정형 문서에서는 격식체가 적절
    8: reduce                  # ~적 접미사 — 정형 문서에서 일부 허용 (과도한 경우만 교정)
  en:
    25: suppress               # Structural repetition — formal docs have intentionally uniform structure
    15: reduce                 # Inline-header lists — bold labels are standard in resumes
    14: reduce                 # Boldface — job titles, company names in bold is convention
    16: suppress               # Title Case — formal document headings conventionally use title case
---

# 정형 문서 프로필

이력서, 자기소개서, 사업 제안서 등 격식을 유지해야 하는 문서에 사용한다.
AI 패턴은 제거하되, 전문적인 어조를 유지한다.

## 범위

이 프로필은 **격식을 요구하는 전문 문서**에 한정된다:
- 이력서 / CV
- 자기소개서 / 커버레터
- 사업 제안서
- 공식 보고서
- 기업 소개서

개인 블로그, 에세이, SNS 글은 이 프로필의 범위가 아니다.

## 핵심 원칙

정형 문서의 AI 교정에서 가장 흔한 실수는 **과도한 캐주얼화**다.
voice.md의 지침("의견을 가져라", "좀 지저분해도 괜찮다", "나를 써라")은
블로그나 에세이에는 적절하지만, 이력서에 적용하면 전문성을 해친다.

이 프로필은 voice.md의 캐주얼 지침을 억제하고, AI 패턴 제거와 격식 유지를 양립시킨다.

## 어조 지침

- **간결 서술체를 유지한다.** "~함", "~설계", "~구축", "~도입" — 이력서의 기본 어미.
- **구어체로 바꾸지 않는다.** "~했음", "~만들었음"(일기체)이 아니라 "~함", "~수행"(서술체).
- **1인칭 사용을 최소화한다.** "내가 ~했다"보다 "~를 설계하여 ~를 달성함"이 이력서에 적합하다.
- **감정/의견을 삽입하지 않는다.** "아무도 시키지 않았지만", "생각보다 심해서" 같은 표현은 억제한다.
- **여담과 곁가지를 넣지 않는다.** 정형 문서는 정보 밀도가 높아야 한다.
- **구어체 축약을 피한다.** "이게 없으면", "세포를 찾는 건 됐는데" 같은 표현은 "해당 기능 부재 시", "세포 탐지는 가능하나"로 유지한다.

## 패턴 처리 (한국어)

- **구조적 반복(ko #25):** 이력서의 경력 항목, 프로젝트 불릿은 동일 구조가 정상이다. 교정하지 않는다.
- **인라인 헤더(ko #15), 볼드체(ko #14):** "**역할:** 백엔드 리드" 같은 포맷은 이력서 관례다. 과도한 경우만 교정.
- **한자어/공식어(ko #18), ~적 접미사(ko #8):** 정형 문서에서 "혁신적", "체계적"은 맥락에 따라 적절하다. 과도한 경우만 교정.
- **번역체(ko #26):** 정형 문서에서도 번역체는 부자연스럽다. 기본 강도로 교정.
- **중요도 과장(ko #1):** "획기적인", "혁명적인" 같은 과장은 정형 문서에서도 제거한다. 기본 강도 유지.

## Pattern Handling (English)

- **Structural repetition (en #25):** Resume bullet points follow uniform structure by design. Do not correct.
- **Inline-header lists (en #15), Boldface (en #14):** "**Role:** Backend Lead" is standard resume formatting. Only correct excessive use.
- **Title Case (en #16):** Formal document headings conventionally use title case. Do not correct.
- **Importance inflation (en #1):** "Groundbreaking", "revolutionary" are still AI patterns in formal docs. Correct normally.
- **AI vocabulary (en #7):** "Delve", "leverage", "spearhead" — correct these even in formal contexts. Use plain professional language.

## voice.md 오버라이드

이 프로필은 `core/voice.md`의 지침을 다음과 같이 조절한다:

| voice.md 지침 | 정형 문서 프로필에서 |
|--------------|-------------------|
| "의견을 가져라" | **억제** — 이력서는 사실과 성과 중심 |
| "리듬을 바꿔라" | **허용** — 단조로움 방지는 유지하되 과하지 않게 |
| "나를 써라" | **축소** — 1인칭 최소화, 행위 중심 서술 |
| "좀 지저분해도 괜찮다" | **억제** — 정형 문서는 깔끔한 구조 필수 |
| "감정을 구체적으로" | **억제** — 감정 대신 수치와 성과로 표현 |
