---
pattern: 37
type: failure
name: 콜론 반전 연출
pack: ko-style
language: ko
---

# Pattern 37: 콜론 반전 연출 — Failure (False Positive)

## Input Text

> 보고서는 세 가지 리스크를 다룬다: 환율 노출, 공급사 집중, 규제 변동. 정의: 공급사 집중은 단일 공급사 조달 비중이 40%를 넘는 상태를 뜻한다. 참고 자료: 2022년 OECD 공급망 리뷰.

## Expected Output

> (수정 없음 — 이 텍스트는 Pattern 37을 발화시키지 않아야 한다)

## Applied Pattern

- Pattern 37 (콜론 반전 연출): 연속된 세 문장에 콜론이 세 번 등장한다.

## Judgment

**Failure (false positive)** — 제외 조건 해당: 세 콜론 모두 구조적이다. 첫째는 목록 도입, 둘째는 명시적 정의, 셋째는 참고 자료 라벨. 어느 것도 극적 반전을 연출하지 않으며, 제거하면 리듬 문제를 고치는 게 아니라 문서의 참조 형식을 망가뜨린다.
