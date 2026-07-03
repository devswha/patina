---
profile: instructional
name: 인스트럭셔널/하우투 프로필
version: 2.0.0
scope: 튜토리얼, 하우투 가이드, 단계별 설명, 기술 문서, 교육 콘텐츠
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
  zh:
    25: allow                  # 结构/编号 — 教程需要清晰步骤，编号结构必须保留
    22: reduce                 # 填充表达 — 指令文里减少铺垫和寒暄
    23: amplify                # 过度弱化 — 步骤说明需要明确，不要层层对冲
    15: allow                  # 内联标题 — 可用于步骤/参数分区
    14: reduce                 # 加粗 — 命令、文件名、关键提醒可加粗，滥用才纠正
  ja:
    25: allow                  # 構造/番号 — 手順説明では番号構造が必要
    22: reduce                 # フィラー — 手順では前置きや緩衝表現を減らす
    23: amplify                # 過剰ヘッジ — 手順は明確さを優先する
    15: allow                  # インラインヘッダー — 手順やパラメータ整理に有用
    14: reduce                 # 太字 — コマンド/ファイル名/注意点の強調は許容
---

# 인스트럭셔널/하우투 프로필

튜토리얼과 단계별 가이드에 맞는 교정을 수행한다. 독자가 지시를 따를 수 있도록 명확하고 행동 지향적인 문장을 만드는 것이 핵심이다.

## 범위

이 프로필은 **튜토리얼, 하우투 가이드, 단계별 설명, 기술 문서, 교육 콘텐츠**에 적합하다. 개인 에세이, 뉴스 기사, 마케팅 카피는 이 프로필의 범위가 아니다.

## 패턴 처리

- **번호 목록(ko #25):** 인스트럭셔널 맥락에서는 번호 구조가 핵심이다. 이 패턴은 허용(allow)으로 설정되어 교정 대상에서 제외한다.
- **필러 관용구(ko #22):** 지시문에서 "우선", "먼저 확인해야 할 것은", "중요한 점은" 같은 완충 표현은 불필요하다. 축소 교정.
- **과도한 한정(ko #28):** "어느 정도", "일반적으로는", "보통의 경우" — 지시문에서 이런 표현은 독자를 혼란하게 한다. 억제.
- **인라인 헤더(ko #15):** 단계 구분 헤더는 허용.
- **볼드체(ko #14):** 명령어, 파일명, 핵심 용어에만 허용. 모든 문장에 볼드를 뿌리는 패턴만 교정.
