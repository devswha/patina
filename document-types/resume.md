---
document-type: resume
name: 이력서
version: 3.0.0
scope: 이력서, CV, 경력 기술서 불릿
purpose: "Present roles, scope, and evidence as scannable resume bullets."
audience:
  - "Recruiters and hiring reviewers scanning for role fit"
structure:
  - "Keep short bullets, dates, titles, and parallel verb phrases"
  - "Do not expand bullets into paragraphs or add a lesson closer"
style:
  - "Use concrete verbs, scope, and measurable outcomes already in the source"
  - "Keep Latin-letter product, API, and stack names as written"
avoid:
  - "Inventing achievements, metrics, titles, or employers"
  - "Melting bullets into an essay or adding why/evaluation the source does not state"
pattern-overrides:
  ko:
    25: suppress               # 구조적 반복 — 경력 불릿의 동일 구조는 정상
    15: reduce                 # 인라인 헤더 — 이력서 레이블 관례
    14: reduce                 # 볼드체 — 직함/회사명 볼드는 관례
    18: reduce                 # 한자어 — 이력서 격식 허용
  en:
    25: suppress               # Structural repetition — resume bullets are uniform by design
    15: reduce                 # Inline-header lists — bold labels are standard
    14: reduce                 # Boldface — titles and company names
    16: suppress               # Title Case — resume headings
  zh:
    25: suppress               # 结构性重复 — 简历条目可有统一结构
    15: reduce                 # 内联标题 — 职责/成果标签是惯例
    14: reduce                 # 加粗 — 职位/公司名加粗可接受
    18: reduce                 # 书面体 — 简历允许适度正式
  ja:
    25: suppress               # 構造的繰り返し — 職務経歴の統一構造は自然
    15: reduce                 # インラインヘッダー — 役割/成果ラベルは慣例
    14: reduce                 # 太字 — 役職名・会社名の強調は許容
    18: reduce                 # 硬質文体 — 履歴書では適度な硬さを許容
---

# 이력서

경력 항목과 불릿만 다루는 문서 유형이다. 자기소개서나 STAR 이야기는
`personal-statement`를 쓰고, 포트폴리오 프로젝트 글은 `project-writeup`을 쓴다.

## 범위

- 이력서 / CV
- 경력 기술서 불릿

## 패턴 처리

- **구조적 반복(#25):** 경력 불릿의 동일 구조는 정상이다. 억제한다.
- 불릿을 서론-본론-교훈 문단으로 늘리지 않는다.
