---
profile: instructional
name: 인스트럭셔널/하우투 프로필
version: 1.0.0
scope: 튜토리얼, 하우투 가이드, 단계별 설명, 기술 문서, 교육 콘텐츠
voice-overrides:
  imperative-verbs: amplify    # 명령형 동사 강화 (설치하라, 실행하라, 확인하라)
  numbered-structure: amplify  # 번호 기반 단계 구조 허용/강화
  hedging: suppress            # 유보 표현 억제 ("~할 수도 있습니다" → "~합니다")
  first-person: reduce         # 1인칭 최소화 (독자 중심 지시문)
  opinions: reduce             # 주관적 의견 최소화 (지시 명확성 우선)
  scene-detail: suppress       # 장면 묘사 억제 (지시에 집중)
pattern-overrides:
  ko:
    25: allow                  # 번호 목록 구조 — 인스트럭셔널에서는 필수 허용
    22: reduce                 # 필러 관용구 — 지시문에서 불필요한 완충 표현 제거
    28: suppress               # 과도한 한정 표현 — 지시문에서 명확성 저해
    15: allow                  # 인라인 헤더 — 단계 구분에 유용
    14: reduce                 # 볼드체 — 핵심 명령어에만 허용, 과도한 볼드 교정
  en:
    25: allow                  # Numbered structure — essential for instructional content
    22: reduce                 # Filler idioms — reduce padding in instructional prose
    28: suppress               # Over-qualifying — clarity requires commitment
    15: allow                  # Inline-header lists — useful for step delineation
    14: reduce                 # Boldface — allow for key terms/commands, correct overuse
---

# 인스트럭셔널/하우투 프로필

튜토리얼과 단계별 가이드에 맞는 교정을 수행한다. 독자가 지시를 따를 수 있도록 명확하고 행동 지향적인 문장을 만드는 것이 핵심이다.

## 범위

이 프로필은 **튜토리얼, 하우투 가이드, 단계별 설명, 기술 문서, 교육 콘텐츠**에 적합하다. 개인 에세이, 뉴스 기사, 마케팅 카피는 이 프로필의 범위가 아니다.

## 어조 지침 (한국어)

- **명령형으로 시작한다.** "설치합니다" → "설치하세요" 또는 "설치하라." 독자에게 직접 행동을 지시한다.
- **번호 구조를 유지한다.** 단계는 번호로 구분되어야 한다. AI가 쓴 것처럼 보이는 번호 목록이라도, 인스트럭셔널 맥락에서는 구조 자체가 목적이다.
- **유보 표현을 제거한다.** "~할 수도 있습니다", "~인 것 같습니다" → "~합니다", "~하세요." 독자는 명확한 지시가 필요하다.
- **짧고 행동 중심으로.** 각 단계는 단일 행동을 담아야 한다. 하나의 문장이 두 가지 행동을 포함하면 쪼갠다.
- **독자를 주어로.** "사용자는 ~을 입력한다" 대신 "~을 입력하세요." 독자가 직접 행동하는 주체임을 명확히 한다.

## Tone guidance (English)

- **Lead with imperative verbs.** "Install," "Run," "Check" — not "You should install" or "It is recommended to run." Direct commands reduce cognitive load.
- **Keep numbered structure.** Steps need numbers. Even if a numbered list pattern fires, instructional content depends on clear sequencing — structure wins here.
- **Cut the hedging.** "You may want to consider" → "Do." "This might help" → "This fixes it." Readers following instructions need certainty.
- **One action per step.** If a sentence contains two actions, split it into two steps.
- **Address the reader directly.** "The user enters" → "Enter." Active second-person keeps instructions scannable.

## 패턴 처리

- **번호 목록(ko #25):** 인스트럭셔널 맥락에서는 번호 구조가 핵심이다. 이 패턴은 허용(allow)으로 설정되어 교정 대상에서 제외한다.
- **필러 관용구(ko #22):** 지시문에서 "우선", "먼저 확인해야 할 것은", "중요한 점은" 같은 완충 표현은 불필요하다. 축소 교정.
- **과도한 한정(ko #28):** "어느 정도", "일반적으로는", "보통의 경우" — 지시문에서 이런 표현은 독자를 혼란하게 한다. 억제.
- **인라인 헤더(ko #15):** 단계 구분 헤더는 허용.
- **볼드체(ko #14):** 명령어, 파일명, 핵심 용어에만 허용. 모든 문장에 볼드를 뿌리는 패턴만 교정.

## voice.md 오버라이드

| voice.md 지침 | 인스트럭셔널 프로필에서 |
|---|---|
| "나를 써라" | **축소** — 독자 중심 지시문이 우선 |
| "의견을 가져라" | **축소** — 명확한 지시가 의견보다 중요 |
| "좀 지저분해도 괜찮다" | **억제** — 인스트럭셔널은 구조와 명확성이 핵심 |
| "리듬을 바꿔라" | **유지** — 단문 지시가 기본이므로 리듬은 자연히 형성됨 |
| "감정을 구체적으로" | **억제** — 지시문에서 감정 표현은 불필요 |
