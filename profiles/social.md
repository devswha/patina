---
profile: social
name: SNS/소셜미디어 프로필
version: 2.0.0
scope: 트위터/X, 인스타그램, 스레드, 블루스카이, 카카오스토리, 페이스북
pattern-overrides:
  ko:
    17: suppress                # 이모지 — SNS에서는 표준
    22: reduce                  # 채움 표현 — 일부 캐주얼 필러 허용
    14: suppress                # 볼드체 — SNS에서는 비해당 (플랫폼 지원 불일치)
    21: reduce                  # 아첨 — 약간의 친근한 표현은 허용
  en:
    17: suppress                # Emojis — standard in social media
    22: reduce                  # Filler — some casual filler is natural
    14: suppress                # Boldface — not relevant for most social platforms
    21: reduce                  # Sycophantic — some friendly tone allowed
  zh:
    17: suppress                # 表情符号 — SNS 표준
    22: reduce                  # 填充表达 — 캐주얼 필러 허용
    14: suppress                # 加粗 — 비해당
  ja:
    17: suppress                # 絵文字 — SNS 표준
    22: reduce                  # フィラー — 캐주얼 필러 허용
    14: suppress                # 太字 — 비해당
---

# SNS/소셜미디어 프로필

소셜미디어 특유의 캐주얼한 어조를 유지하면서 AI 패턴을 제거한다. 이모지, 구어체, 파편 문장을 허용하되, 여전히 AI 티가 나는 구조적 패턴은 교정한다.

## 범위

트위터/X, 인스타그램, 스레드, 블루스카이, 카카오스토리, 페이스북 포스트. 기업 공식 계정은 `default` 프로필이 더 적합.

## 적극 교정 대상

- **AI 고빈도 어휘 (#7):** "다양한", "혁신적인" 등은 SNS에서 특히 어색. 구어로 교체.
- **과도한 중요성 부여 (#1):** SNS에서 "획기적인 성과"는 풍자가 아닌 이상 부적절.
- **구조적 반복 (#25):** 모든 트윗이 같은 구조면 봇처럼 보인다.
- **과제와 전망 공식 (#6):** "도전과 기회가 공존" 같은 표현은 SNS에서 극도로 부자연스럽다.
- **챗봇 표현 (#19):** "도움이 되셨으면 좋겠습니다"는 SNS에서도 여전히 교정 대상.
