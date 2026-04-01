---
profile: email
name: 이메일/비즈니스 서신 프로필
version: 1.0.0
scope: 업무 이메일, 전문 서신, 내부 메모, 공식 문의, 회신
voice-overrides:
  first-person: allow           # 이메일에서 1인칭은 자연스러움 ("제가 확인해 보겠습니다")
  opinions: allow               # 업무적 의견 표명은 허용하되 지나친 주관은 자제
  rhythm-variation: allow       # 자연스러운 변화는 허용, 극단적 변주는 불필요
  humor: suppress               # 업무 이메일에서 유머는 맥락 의존적이라 기본 억제
  messiness: suppress           # 이메일은 구조적 명확성이 중요
  concrete-emotions: suppress   # 감정 서술보다 사실 기반 커뮤니케이션
  formality: allow              # 격식과 비격식 사이 — 상대와 맥락에 따라 조절
pattern-overrides:
  ko:
    4: amplify                  # 홍보성 표현 — 업무 이메일에서 "업계 최고의" 같은 표현은 신뢰를 떨어뜨림
    6: amplify                  # 도전과 전망 — 이메일은 구체적 요청/답변이 목적, 에세이식 결론 불필요
    7: amplify                  # AI 어휘 남발 — "다각적 접근", "선도하다"는 이메일에서도 부자연스러움
    8: reduce                   # ~적 접미사 — "효과적", "구체적"은 업무 어휘로 일부 허용; "혁신적"은 교정
    18: reduce                  # 한자어/공식어 — "검토하다", "요청드리다"는 이메일 표준; "강구하다", "도모하다"는 교정
    19: suppress                # 협력적 소통 — "궁금한 점 있으시면 연락 주세요"는 이메일 관례
    21: suppress                # 아첨조 — "메일 감사드립니다", "좋은 의견 감사합니다"는 이메일 예절
    22: suppress                # 필러 표현 — "참고로", "말씀드리자면"은 이메일에서 자연스러운 전환
    23: reduce                  # 헤징 — "~일 수 있을 것 같습니다"는 외교적 표현; 3개 이상 중첩 시만 교정
    25: amplify                 # 구조적 반복 — 모든 문단이 같은 패턴이면 템플릿 느낌
  en:
    4: amplify                  # Promotional language — "revolutionary", "game-changing" erode credibility in email
    6: amplify                  # Formulaic challenges/prospects — emails should be direct, not essay-like
    7: amplify                  # AI vocabulary — "delve", "tapestry", "landscape" are jarring even in formal email
    8: reduce                   # Copula avoidance — "serves as" occasionally appropriate in formal email; "functions as a testament" is not
    19: suppress                # Collaborative communication — "Please let me know if you have questions" is standard email
    21: suppress                # Sycophantic tone — "Thank you for your email", "Great point" are email convention
    22: suppress                # Filler phrases — "I hope this finds you well", "Just wanted to follow up" are email etiquette
    23: reduce                  # Excessive hedging — diplomatic hedging expected; only correct when qualifiers pile up
    25: amplify                 # Metronomic paragraphs — emails should flow naturally, not read like form letters
---

# 이메일/비즈니스 서신 프로필

업무 이메일, 전문 서신, 내부 메모에 맞는 교정을 수행한다. 이메일 예절과 관례를 존중하면서 AI 패턴을 제거한다.

## 범위

이 프로필은 **업무 이메일, 전문 서신, 내부 메모, 공식 문의, 회신**에 한정된다. 마케팅 이메일, 뉴스레터, 콜드 아웃리치, 자동 발송 메일은 이 프로필의 범위가 아니다.

## 어조 지침

- **목적을 먼저 밝힌다.** 이메일의 핵심은 첫 두 문장에 있어야 한다. "~건으로 메일 드립니다", "Following up on our call regarding X."
- **예의 바르되 공허하지 않게.** "감사합니다"는 좋다. "귀하의 탁월한 리더십에 깊은 감사를 드리며"는 AI 서신체다.
- **구체적으로 요청한다.** "검토 부탁드립니다"보다 "3/15까지 2페이지의 예산 항목을 확인해 주시면 감사하겠습니다."
- **외교적 헤징은 허용한다.** "~일 수 있을 것 같습니다", "I believe this might work" — 업무 맥락에서 단정보다 완화가 적절한 경우가 많다. 단, 한 문장에 3개 이상 중첩하면 교정.
- **이메일 관례를 존중한다.** 인사말, 감사 표현, 마무리 인사("궁금한 점 있으시면 연락 주세요")는 사회적 규약이다. 이것을 교정하면 무례해진다.
- **1인칭은 자연스럽게 사용한다.** "제가 확인해 보겠습니다", "I'll look into this" — 이메일은 사람 사이의 대화다.

## 패턴 처리 (한국어)

- **홍보성 표현(ko #4):** 업무 이메일에서 "혁신적 솔루션을 제안드립니다"는 신뢰를 떨어뜨린다. 적극 교정.
- **도전과 전망(ko #6):** "이러한 도전에도 불구하고 밝은 미래가 기대됩니다"는 이메일에서 불필요. 구체적 다음 단계로 대체.
- **AI 어휘(ko #7):** "다각적 접근", "선도하다"는 이메일에서도 부자연스럽다. 적극 교정.
- **~적 접미사(ko #8):** "효과적", "구체적"은 업무 어휘로 허용. "혁신적", "선도적"은 교정.
- **한자어(ko #18):** "검토하다", "요청드리다", "회신 드리다"는 이메일 표준 어휘. "강구하다", "도모하다", "이행하다"는 과도한 격식.
- **협력적 소통(ko #19):** "궁금한 점 있으시면 연락 주세요", "의견 부탁드립니다"는 이메일 관례. 교정하지 않는다.
- **아첨조(ko #21):** "메일 감사드립니다", "좋은 의견 감사합니다"는 이메일 예절. 교정하지 않는다.
- **필러 표현(ko #22):** "참고로", "말씀드리자면", "덧붙이자면"은 이메일에서 자연스러운 단락 전환. 교정하지 않는다.
- **헤징(ko #23):** 단일 완화 표현은 외교적 관례. 3개 이상 중첩 시만 교정.
- **구조적 반복(ko #25):** 모든 문단이 "~드립니다. ~입니다. ~바랍니다."이면 템플릿처럼 읽힌다. 적극 교정.

## Pattern Handling (English)

- **Promotional language (en #4):** "Revolutionary approach", "industry-leading" erode credibility in professional correspondence. Aggressively correct.
- **Formulaic challenges/prospects (en #6):** Email should state next steps, not conclude with "the future looks bright." Aggressively correct.
- **AI vocabulary (en #7):** "Delve into the nuances", "navigate the landscape" are AI tells even in formal email. Aggressively correct.
- **Copula avoidance (en #8):** "Serves as a reminder" is acceptable in formal email. "Functions as a testament to our collaborative synergy" is not. Correct only decorative instances.
- **Collaborative communication (en #19):** "Please let me know if you have questions", "Happy to discuss further" are standard closings. Do not correct.
- **Sycophantic tone (en #21):** "Thank you for your email", "Great point", "Appreciate your input" are email convention. Do not correct.
- **Filler phrases (en #22):** "I hope this finds you well", "Just wanted to follow up", "Circling back on this" are email etiquette. Do not correct.
- **Excessive hedging (en #23):** "I think this might work" is diplomatic. "I was wondering if perhaps it might be possible to maybe consider" is not. Correct only stacked qualifiers.
- **Metronomic paragraphs (en #25):** Form-letter structure is an AI tell. Emails should vary paragraph length and structure. Aggressively correct.

## voice.md 오버라이드

이 프로필은 `core/voice.md`의 지침을 다음과 같이 조절한다:

| voice.md 지침 | 이메일 프로필에서 |
|--------------|-----------------|
| "의견을 가져라" | **허용** — 업무적 의견 표명은 허용, 지나친 주관은 자제 |
| "리듬을 바꿔라" | **허용** — 자연스러운 변화는 허용, 극단적 변주는 불필요 |
| "나를 써라" | **허용** — 이메일은 사람 사이의 대화, 1인칭 자연스러움 |
| "좀 지저분해도 괜찮다" | **억제** — 이메일은 구조적 명확성이 중요 |
| "감정을 구체적으로" | **억제** — 사실 기반 커뮤니케이션이 기본 |
| "유머를 써라" | **억제** — 업무 이메일에서 유머는 맥락 의존적, 기본 억제 |
| "Use contractions" (en) | **허용** — 내부 메모/동료 간 이메일에서 축약형 자연스러움 |
| "Break register" (en) | **억제** — 일관된 전문적 어조 유지 |
| "Let a sentence fragment stand" (en) | **억제** — 업무 이메일에서 불완전 문장은 부적절 |
