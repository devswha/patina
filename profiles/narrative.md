---
profile: narrative
name: 내러티브/에세이 프로필
version: 2.0.0
scope: 1인칭 에세이, 개인 서사, 회고록, 경험 기반 글쓰기
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

## 패턴 처리

- **번호 목록(ko #25), 인라인 헤더(ko #15), 볼드체(ko #14):** 서사 에세이에 어울리지 않는다. 나타나면 산문으로 풀어쓴다.
- **번역체(ko #26), 접속사 반복(ko #27):** 구어체 서사에서 일부 허용. 과도할 때만 교정.
- **헤징 표현:** 서사에서의 유보("~일 수도 있다", "어떻게 보면")는 화자의 성찰로 읽힐 수 있다. 과도한 AI식 유보만 제거한다.
