---
document-type: project-writeup
name: 프로젝트 기록
version: 3.0.0
scope: 포트폴리오, 가장 의미 있었던 프로젝트, 경력 서술형 프로젝트 글
purpose: "Keep a project writeup in its source shape: headings, methods, and results without melting them into an essay."
audience:
  - "Portfolio readers and interviewers checking what was built and what changed"
structure:
  - "Preserve 문제/방법/결과 or equivalent headings; do not merge them into continuous prose"
  - "If a heading body is empty, a phrase, or bullets, keep that shape"
style:
  - "Keep Latin-letter tech terms, API names, task names, and exam names as-is"
  - "Prefer mechanisms, decisions, and measured outcomes already in the source"
avoid:
  - "Synonym-swapping classification/segmentation/loss/CXR into 분류/분할/손실"
  - "Inventing why, evaluation, or a lesson closer the source does not have"
  - "Expanding heading-only notes into an introduction–body–lesson essay"
pattern-overrides:
  ko:
    25: amplify                # 구조적 반복 — 포트폴리오 완결 에세이의 병렬은 교정 대상
    15: reduce                 # 인라인 헤더 — 문제/방법/결과 레이블은 구조
    11: reduce                 # 유의어 순환 — 기술 용어를 번역 동의어로 돌리지 않음
  en:
    25: amplify                # Structural repetition — complete-arc project essays are in scope
    15: reduce                 # Inline-header lists — Problem/Method/Result labels stay
    11: reduce                 # Elegant variation — do not rotate API/task names
  zh:
    25: amplify                # 结构性重复 — 完整项目叙事的并列是校正对象
    15: reduce                 # 内联标题 — 问题/方法/结果标签是结构
    11: reduce                 # 同义词循环 — 不要改写技术专名
  ja:
    25: amplify                # 構造的繰り返し — 完成されたプロジェクト叙述の並列は対象
    15: reduce                 # インラインヘッダー — 問題/方法/結果ラベルは構造
    11: reduce                 # 類義語循環 — 技術用語を言い換えない
---

# 프로젝트 기록

포트폴리오와 “가장 의미 있었던 프로젝트” 글에 쓴다. `#25`는 `formal`과 반대로 **강화**한다.
영어 기술 용어는 유지하고, 문제/방법/결과 제목을 에세이로 녹이지 않는다.

## 범위

- 포트폴리오 프로젝트 글
- 경력 서술형 프로젝트 회고 (자소서 STAR는 `personal-statement`)

## 핵심 제약

- `classification`, `segmentation`, `loss`, `chest X-ray`, `CXR` 같은 라틴 문자 용어는 그대로 둔다.
- 제목 아래가 비어 있거나 불릿이면 그 형태를 유지한다.
- 원문에 없는 교훈이나 “그래서 중요한 점”을 붙이지 않는다.
