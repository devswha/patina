---
profile: legal
name: 법률 문서 프로필
version: 1.0.0
scope: 계약서, 법률 의견서, 판결문, 약관, 법률 보고서
voice-overrides:
  first-person: suppress        # 1인칭 억제
  opinions: suppress            # 의견 억제
  rhythm-variation: reduce      # 리듬 변화 절제 (법률 문서는 균일한 문체)
  humor: suppress               # 유머 억제
  messiness: suppress           # 불완전 구조 억제
  concrete-emotions: suppress   # 감정 표현 억제
pattern-overrides:
  ko:
    18: suppress                # 한자어/공식어 — 법률 문서의 표준 어휘
    27: suppress                # 수동태 — 법률 문서에서 "~에 의하여 정해진다" 등 관례
    12: suppress                # ~에 있어서 — 법률 문서에서 관례적 표현
    22: reduce                  # 채움 표현 — "~하는 경우에 한하여" 등 법률적 정밀성
    23: reduce                  # 헤징 — 법적 불확실성 표현 허용
    8: reduce                   # ~적 접미사 — 법률 용어에서 일부 허용 ("실질적", "법적")
  en:
    26: suppress                # Passive nominalization — standard legal form
    22: reduce                  # Filler — "in order to" sometimes needed in legal precision
    23: reduce                  # Hedging — legal uncertainty language allowed
    27: suppress                # Zombie nouns — legal definitions use nominalized forms
  zh:
    18: suppress                # 公文体 — 법률 중국어의 표준
    27: suppress                # 被字句 — 법률 문서에서 관례
    12: suppress                # 冗长介词 — 법률 문서에서 정밀성 위해 필요
  ja:
    18: suppress                # である調 — 법률 일본어의 표준
    16: suppress                # 敬語 — 법률 문서에서는 비해당
    27: reduce                  # ている — 법률 문서에서 일부 허용
---

# 법률 문서 프로필

법률 문서의 관행적 표현을 보존하면서 AI 패턴을 제거한다. 수동태, 명사화, 격식체 등 법률 글쓰기의 표준 요소는 건드리지 않는다.

## 범위

계약서, 법률 의견서, 판결문, 약관, 법률 보고서. 법률 블로그나 법률 뉴스 기사는 `default` 또는 `blog` 프로필 사용.

## 어조 지침

- **법률 문서의 격식과 정밀성을 유지한다.** 구어체로 바꾸지 않는다.
- **관례적 법률 용어를 보존한다.** "전술한", "상기", "본 계약" 등은 교정 대상이 아니다.
- **수동태와 명사화를 허용한다.** "~에 의하여 정해진다", "~에 관한 사항" 등은 법률 문체.
- **"~에 있어서"를 허용한다.** 법률에서는 정밀성을 위해 필요한 경우가 많다.

## 적극 교정 대상

- **AI 고빈도 어휘 (#7):** "혁신적인 법률 서비스", "체계적인 법적 프레임워크" 등은 AI 냄새. 교정.
- **과도한 중요성 부여 (#1):** 법률 문서에서 "획기적인 판결"은 사실 판단이지 수식이 아니다. 교정.
- **모호한 출처 (#5):** 법률 문서에서 출처 불명은 더더욱 부적절.
- **유의어 순환 (#11):** 법률 문서에서 같은 개체를 다른 이름으로 부르면 법적 모호성 유발. 적극 교정.
- **과제와 전망 공식 (#6):** 법률 의견서 결론에서도 빠지기 쉬움. 구체적 법적 분석으로 대체.
