---
profile: social
name: SNS/소셜 미디어 프로필
version: 1.0.0
scope: 트위터/X, 인스타그램 캡션, 페이스북 포스트, 링크드인 업데이트, 짧은 SNS 콘텐츠
voice-overrides:
  first-person: amplify         # SNS는 개인의 목소리가 핵심
  opinions: amplify             # 입장 표명이 참여를 만든다
  rhythm-variation: amplify     # 짧고 펀치 있는 문장 + 의도적 변주
  humor: amplify                # 유머, 자기비하, 위트 적극 허용
  messiness: amplify            # 불완전한 문장, 생략, 말줄임표 허용
  concrete-emotions: amplify    # 추상적 감정 대신 구체적 반응
  formality: suppress           # 격식체는 SNS에서 부자연스러움
pattern-overrides:
  ko:
    4: amplify                  # 홍보성 표현 — SNS에서도 "업계 최고의" 같은 AI 홍보체는 부자연스러움
    6: amplify                  # 도전과 전망 — SNS에서 에세이식 결론은 특히 이질적
    7: amplify                  # AI 어휘 남발 — "다각적인", "선도하다" 등은 SNS에서 극도로 부자연스러움
    8: amplify                  # ~적 접미사 — "혁신적", "체계적" 등은 SNS 어조와 완전히 충돌
    14: suppress                # 볼드체 — SNS에서 강조 포맷은 일상적
    17: suppress                # 이모지 — SNS의 핵심 표현 수단, 교정 불필요
    18: amplify                 # 한자어/공식어 — "도모하다", "강구하다"는 SNS에서 극도로 어색
    21: reduce                  # 아첨조 — "정말 좋은 질문이시네요!" 같은 참여형 표현은 SNS에서 일부 허용
    25: amplify                 # 구조적 반복 — SNS에서 모든 문장이 같은 패턴이면 봇 티가 확연
    26: amplify                 # 번역체 — SNS는 구어체에 가까워야 하므로 번역체가 극도로 눈에 띔
  en:
    4: amplify                  # Promotional language — AI-style hype is glaringly obvious in social posts
    6: amplify                  # Formulaic challenges/prospects — essay-like conclusions kill social engagement
    7: amplify                  # AI vocabulary — "delve", "tapestry", "multifaceted" are instant AI tells in tweets
    8: amplify                  # Copula avoidance — "serves as", "functions as" read like a press release in a tweet
    14: suppress                # Boldface — bold formatting is normal in social posts
    17: suppress                # Emojis — core expressive tool in social media
    21: reduce                  # Sycophantic tone — engagement-style enthusiasm is normal in social
    22: suppress                # Filler phrases — casual tone naturally includes some fillers
    25: amplify                 # Metronomic paragraphs — social posts need varied rhythm, not uniform blocks
    26: amplify                 # Passive voice — "is being conducted" reads robotic in a tweet; use active voice
---

# SNS/소셜 미디어 프로필

트위터/X, 인스타그램, 페이스북, 링크드인 등 소셜 미디어 포스트에 맞는 교정을 수행한다. 사람이 직접 쓴 것처럼 자연스러운 목소리를 최우선으로 한다.

## 범위

이 프로필은 **트위터/X 포스트, 인스타그램 캡션, 페이스북 포스트, 링크드인 업데이트, 짧은 SNS 콘텐츠**에 한정된다. 장문 아티클, 블로그 포스트, 마케팅 캠페인 문안은 이 프로필의 범위가 아니다 — 그런 글에는 블로그 프로필이나 기본 프로필이 더 적합하다.

## 어조 지침

- **말하듯이 쓴다.** SNS는 대화다. "~거든", "~잖아", "ㅋㅋ", "ㄹㅇ" — 실제로 타이핑할 법한 표현이 자연스럽다.
- **짧게, 펀치 있게.** 트윗은 280자다. 핵심부터 말하고, 설명은 나중에. "솔직히 이건 좀" 한 줄이 세 문단 분석보다 낫다.
- **의견을 확실하게 표명한다.** "흥미로운 관점이다"가 아니라 "이거 진짜 대박" 또는 "솔직히 별로". SNS에서 중립은 무관심이다.
- **이모지는 자유롭게.** 🔥, 😭, 💀 — SNS의 감정 표현 수단이다. AI가 이모지를 넣는 것과 사람이 쓰는 것의 차이: AI는 모든 항목에 균일하게 붙이고, 사람은 감정이 터질 때만 쓴다.
- **불완전한 문장을 두려워하지 않는다.** "근데 이게 되네?" "아 진짜?" — 파편 문장이 SNS의 리듬이다.
- **유머와 과장을 적극 허용한다.** "3시간 삽질함 ㅋㅋ", "이거 발견하고 소리 지름" — 진짜 사람의 반응이다.

## 패턴 처리 (한국어)

- **홍보성 표현(ko #4):** SNS에서도 "업계를 선도하는 혁신적 솔루션"은 광고 봇이다. 적극 교정.
- **도전과 전망(ko #6):** "이러한 도전에도 불구하고 밝은 미래가 기대된다"는 SNS에서 극도로 이질적. 적극 교정.
- **AI 어휘(ko #7), ~적 접미사(ko #8), 한자어(ko #18):** "다각적 접근", "혁신적 시도", "도모하다" — SNS에서 이런 표현을 쓰는 사람은 없다. 적극 교정.
- **볼드체(ko #14), 이모지(ko #17):** SNS의 기본 표현 수단이다. 교정하지 않는다.
- **아첨조(ko #21):** "좋은 지적이에요!", "공감합니다!" 같은 참여형 표현은 SNS에서 자연스러운 상호작용이다. 과도한 경우("정말 놀라운 통찰력이십니다!!")만 교정.
- **구조적 반복(ko #25):** 모든 문장이 "~합니다. ~입니다. ~됩니다." 패턴이면 봇 티가 확연. 적극 교정.
- **번역체(ko #26):** SNS는 가장 구어적인 매체다. "그것은 ~에 의해 만들어졌다"는 즉시 AI 판정. 적극 교정.

## Pattern Handling (English)

- **Promotional language (en #4):** "Revolutionary solution", "game-changing" read like ad copy in a tweet. Aggressively correct.
- **Formulaic challenges/prospects (en #6):** "Despite these challenges, the future looks promising" kills engagement. Aggressively correct.
- **AI vocabulary (en #7):** "Delve", "tapestry", "multifaceted", "landscape" are instant AI tells in social posts. Aggressively correct.
- **Copula avoidance (en #8):** "Serves as a testament to" in a tweet? Press release energy. Aggressively correct.
- **Boldface (en #14), Emojis (en #17):** Core expressive tools in social media. Do not correct.
- **Sycophantic tone (en #21):** "Great question!", "Love this take!" is normal social engagement. Only correct when it becomes excessive or hollow.
- **Filler phrases (en #22):** Casual tone naturally includes fillers like "honestly", "I mean", "literally." Do not correct — these are voice markers in social writing.
- **Metronomic paragraphs (en #25):** Social posts need varied rhythm. Uniform sentence patterns read like a content bot. Aggressively correct.
- **Passive voice (en #26):** "An update is being provided" reads robotic in a tweet. Social media demands active voice and directness. Aggressively correct.

## voice.md 오버라이드

이 프로필은 `core/voice.md`의 지침을 다음과 같이 조절한다:

| voice.md 지침 | SNS 프로필에서 |
|--------------|--------------|
| "의견을 가져라" | **강화** — 모든 포스트에 확실한 입장 표명 |
| "리듬을 바꿔라" | **강화** — 극단적 리듬 변주, 한 단어 문장 적극 사용 |
| "나를 써라" | **강화** — 1인칭이 SNS의 기본 시점 |
| "좀 지저분해도 괜찮다" | **강화** — 불완전 문장, 생략, 말줄임표 적극 허용 |
| "감정을 구체적으로" | **강화** — "3시간 삽질함", "소리 지름" 같은 구체적 반응 |
| "유머를 써라" | **강화** — 과장, 자기비하, 밈 레퍼런스 적극 허용 |
| "Use contractions" (en) | **강화** — 축약형이 기본, 비축약형이 오히려 어색 |
| "Break register" (en) | **강화** — 격식/비격식 전환이 SNS의 매력 |
| "Let a sentence fragment stand" (en) | **강화** — 파편 문장이 SNS의 핵심 리듬 |
