---
profile: narrative
name: 내러티브/에세이 프로필
version: 1.0.0
scope: 1인칭 에세이, 개인 서사, 회고록, 경험 기반 글쓰기
voice-overrides:
  first-person: amplify        # 1인칭 시점 강화 (화자가 글의 중심)
  scene-detail: amplify        # 장면 묘사, 구체적 감각 디테일 강화
  concrete-emotions: amplify   # 추상적 감정 대신 구체적 상황/장면으로 표현
  opinions: amplify            # 화자의 주관적 반응과 입장 강화
  rhythm-variation: amplify    # 단문과 장문 교차로 호흡감 생성
  hedging: suppress            # 과도한 유보 표현 억제 (서사에서 자신감 있는 목소리)
  structure-heavy: suppress    # 헤딩, 번호 목록 억제 (서사 흐름 우선)
pattern-overrides:
  ko:
    26: reduce                 # 번역체 — 내러티브에서 구어체 허용
    27: reduce                 # 접속사 반복 — 서사 흐름에서 일부 허용
    14: suppress               # 볼드체 — 에세이에서 강조 마크업 불필요
    15: suppress               # 인라인 헤더 목록 — 서사에 어울리지 않음
    25: suppress               # 번호 목록 구조 — 에세이 흐름 방해
  en:
    26: reduce                 # Translation-ism — conversational register allowed
    27: reduce                 # Connector repetition — narrative flow allows it
    14: suppress               # Boldface — unnecessary in essay prose
    15: suppress               # Inline-header lists — breaks narrative continuity
    25: suppress               # Numbered structure — not appropriate for essays
  zh:
    26: reduce                 # 翻译腔 — 叙事里可保留少量口语化/外来节奏
    13: reduce                 # 连接词 — 叙事推进中少量“后来/然后”可自然存在
    14: suppress               # 加粗 — 叙事散文里强调标记通常不需要
    15: suppress               # 内联标题 — 会打断叙事连续性
    25: suppress               # 结构性重复 — 编号/模板段落不适合个人叙事
  ja:
    26: reduce                 # 翻訳調 — 語りの中では少量の会話調を許容
    13: reduce                 # 接続表現 — 時間の流れを示す接続は一部許容
    14: suppress               # 太字 — エッセイ本文では不要
    15: suppress               # インラインヘッダー — 物語の流れを切る
    25: suppress               # 構造的繰り返し — 番号/テンプレ段落は個人叙事に不向き
---

# 내러티브/에세이 프로필

1인칭 서사와 경험 기반 에세이에 맞는 교정을 수행한다. 화자의 목소리와 시간 흐름, 감정적 진실이 글의 핵심이다.

## 범위

이 프로필은 **1인칭 에세이, 개인 서사, 회고록, 경험 기반 글쓰기**에 적합하다. 학술 논문, 기업 보고서, 뉴스 기사는 이 프로필의 범위가 아니다.

## 어조 지침 (한국어)

- **화자가 글의 중심이다.** "내가", "나는", "그때 내가 느낀 건" — 1인칭 시점을 기본으로 유지한다.
- **장면으로 보여준다.** "힘들었다"가 아니라 "새벽 2시에 혼자 형광등 아래 앉아 있었다." 추상적 감정보다 구체적 상황이 독자를 끌어당긴다.
- **시간 흐름을 살린다.** 과거 시제와 회상이 자연스럽게 이어지도록 한다. "그때", "그 다음", "지금 생각하면" — 서사의 시간 감각을 유지한다.
- **감정을 구체적으로 드러낸다.** "불안했다" 대신 "손이 떨렸다", "이유 없이 자꾸 창문을 봤다" 같은 구체적 반응으로 표현한다.
- **마무리를 깔끔하게 닫지 않아도 된다.** 에세이의 끝이 열려 있거나 불확실함으로 끝나도 괜찮다. 억지 결론보다 솔직한 미결이 낫다.

## Tone guidance (English)

- **Stay in first person.** "I", "me", "what I realized" — the narrator is the anchor.
- **Show the scene.** Not "it was difficult" but "I was sitting alone under a flickering light at 2 a.m." Concrete detail pulls readers in more than abstraction.
- **Let time breathe.** Past tense and reflection flow naturally — "back then," "later I found out," "looking back now." Preserve the narrative's sense of time.
- **Name the feeling specifically.** Not "I felt anxious" but "my hands wouldn't stop moving" or "I kept checking the door for no reason."
- **Resist the tidy ending.** Essays can close on uncertainty or open questions. An honest non-resolution beats a forced epiphany.

## 패턴 처리

- **번호 목록(ko #25), 인라인 헤더(ko #15), 볼드체(ko #14):** 서사 에세이에 어울리지 않는다. 나타나면 산문으로 풀어쓴다.
- **번역체(ko #26), 접속사 반복(ko #27):** 구어체 서사에서 일부 허용. 과도할 때만 교정.
- **헤징 표현:** 서사에서의 유보("~일 수도 있다", "어떻게 보면")는 화자의 성찰로 읽힐 수 있다. 과도한 AI식 유보만 제거한다.

## voice.md 오버라이드

| voice.md 지침 | 내러티브 프로필에서 |
|---|---|
| "나를 써라" | **강화** — 1인칭이 서사의 기본값 |
| "감정을 구체적으로" | **강화** — 장면과 신체 반응으로 감정을 드러낸다 |
| "리듬을 바꿔라" | **강화** — 호흡감 있는 단문/장문 교차 |
| "의견을 가져라" | **강화** — 화자의 입장과 성찰이 서사의 동력 |
| "좀 지저분해도 괜찮다" | **강화** — 완벽하게 정리되지 않은 생각이 더 진짜처럼 보인다 |
