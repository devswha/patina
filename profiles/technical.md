---
profile: technical
name: 기술 문서/API 문서 프로필
version: 1.0.0
scope: 기술 문서, API 문서, README, 가이드, 튜토리얼, 사양서
voice-overrides:
  first-person: suppress        # 1인칭 억제
  opinions: suppress            # 의견 억제, 사실 기반 서술
  rhythm-variation: normal      # 리듬 변화 유지
  humor: suppress               # 유머 억제
  messiness: suppress           # 불완전 구조 억제
  concrete-emotions: suppress   # 감정 표현 억제
pattern-overrides:
  ko:
    14: suppress                # 볼드체 — 기술 문서에서 키워드/파라미터 볼드 표준
    15: suppress                # 인라인 헤더 — API 문서의 표준 형식
    27: reduce                  # 수동태 — 사양서에서 허용
  en:
    14: suppress                # Boldface — standard in technical docs for keywords
    15: suppress                # Inline-header lists — standard API doc format
    18: suppress                # Curly quotes — actively fix in code/config contexts
    26: reduce                  # Passive — acceptable in specifications
  zh:
    14: suppress                # 加粗 — 기술 문서 표준
    15: suppress                # 内联标题列表 — API 문서 표준
    27: reduce                  # 被字句 — 사양서에서 허용
  ja:
    14: suppress                # 太字 — 기술 문서 표준
    15: suppress                # インラインヘッダー — API 문서 표준
    16: suppress                # 敬語 — 기술 문서에서는 비해당 (である調 기본)
---

# 기술 문서/API 문서 프로필

기술 문서의 형식적 관행을 존중하면서 AI 패턴을 제거한다. 볼드 키워드, 파라미터 테이블, 인라인 헤더 리스트 등 기술 문서의 표준 요소는 건드리지 않는다.

## 범위

API 문서, README, 가이드, 튜토리얼, 기술 사양서. 기술 블로그 글은 `blog` 프로필이 더 적합.

## 어조 지침

- **명확하고 직접적으로 쓴다.** 기술 문서의 목표는 정확한 정보 전달.
- **1인칭은 쓰지 않는다.** "Set the variable" (O), "I set the variable" (X).
- **의견이나 유머는 넣지 않는다.** 사실과 절차만.
- **일관된 용어를 유지한다.** 같은 개념을 같은 단어로 부른다 (유의어 순환 금지).

## 적극 교정 대상

- **AI 고빈도 어휘 (#7):** "활용하여", "체계적으로" 등 → "사용하여", "순서대로" 등으로 교체.
- **채움 표현 (#22):** "주목할 만한 점은 ~라는 것이다" → 직접 서술.
- **과도한 중요성 부여 (#1):** 기술 문서에서 "획기적인 기능"은 부적절. 기능 설명으로 대체.
- **유의어 순환 (#11):** 기술 문서에서 같은 것을 다른 이름으로 부르면 혼란. 적극 교정.
