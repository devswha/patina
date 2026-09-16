---
document-type: formal
name: 정형 문서
version: 3.1.0
scope: 사업 제안서, 공식 보고서, 기업 소개서
purpose: "Present proposals or official findings in a structured, reviewable document."
audience:
  - "Decision-makers, reviewers, or official stakeholders"
structure:
  - "Use stable sections, labels, evidence-bearing bullets, and document-specific metadata"
  - "Keep parallel structure where it supports scanning and comparison"
style:
  - "Use precise role, outcome, scope, and evidence language"
  - "Prefer verifiable statements over broad self-description"
avoid:
  - "Using this Document Type as a formality control; Register owns casual/professional delivery"
  - "Inventing achievements, metrics, responsibilities, endorsements, or institutional claims"
  - "Applying this type to resumes, cover letters, or project writeups; use resume, personal-statement, or project-writeup"
pattern-overrides:
  ko:
    25: suppress               # 구조적 반복 — 제안서/공식 보고서의 반복 항목은 정상
    15: reduce                 # 인라인 헤더 — 볼드 레이블이 관례
    14: reduce                 # 볼드체 — 직함/기관명 볼드는 관례
    18: reduce                 # 한자어/공식어 — 공식 문서에서는 격식체가 적절
    8: reduce                  # ~적 접미사 — 과도한 경우만 교정
  en:
    25: suppress               # Structural repetition — proposals/reports have uniform sections
    15: reduce                 # Inline-header lists — bold labels are standard
    14: reduce                 # Boldface — titles and institution names
    16: suppress               # Title Case — official headings conventionally use title case
  zh:
    25: suppress               # 结构性重复 — 建议书/报告条目可有统一结构
    15: reduce                 # 内联标题 — 标签是正式文档惯例
    14: reduce                 # 加粗 — 职位/机构名加粗可接受
    18: reduce                 # 书面/公文体 — 正式文档允许适度正式
    8: reduce                  # 四字格 — 正式文档中少量四字格可接受
  ja:
    25: suppress               # 構造的繰り返し — 提案書や公式報告では統一構造が自然
    15: reduce                 # インラインヘッダー — 役割/成果ラベルは正式文書の慣例
    14: reduce                 # 太字 — 役職名・機関名の強調は許容
    18: reduce                 # 硬質文体 — 正式文書では適度な硬さを許容
    8: reduce                  # 〜的 — 正式文書では一部許容
---

# 정형 문서

사업 제안서와 공식 보고서처럼 정해진 섹션과 비교 가능한 항목이 필요한 문서에 사용한다.
`--document-type formal`은 기존 CLI 식별자로 유지된다. 이력서·자소서·프로젝트 기록은
`resume`, `personal-statement`, `project-writeup`을 쓴다. casual/professional 전달
방식은 `--register`가 정한다.

## 범위

이 문서 유형은 **제안·공식 보고**에 한정된다:
- 사업 제안서
- 공식 보고서
- 기업 소개서

이력서, 자기소개서, 커버레터, 포트폴리오 프로젝트 글은 이 유형의 범위가 아니다.

## 핵심 원칙

정형 문서의 항목 구조, 레이블, 증거 배치, 병렬성은 Document Type이 정한다.
문장 종결과 casual/professional 전달 방식은 Register가 정하고, 고유한 어휘·리듬은
명시적 Persona가 정한다.

## 패턴 처리 (한국어)

- **구조적 반복(ko #25):** 제안서 항목, 보고서 불릿은 동일 구조가 정상이다. 교정하지 않는다.
- **인라인 헤더(ko #15), 볼드체(ko #14):** 레이블 포맷은 관례다. 과도한 경우만 교정.
- **한자어/공식어(ko #18), ~적 접미사(ko #8):** 격식체는 맥락에 따라 적절하다. 과도한 경우만 교정.

## Pattern Handling (English)

- **Structural repetition (en #25):** Proposal and report bullets follow uniform structure by design. Do not correct.
- **Inline-header lists (en #15), Boldface (en #14):** Labeled fields are standard. Only correct excessive use.
- **Title Case (en #16):** Official headings conventionally use title case. Do not correct.
