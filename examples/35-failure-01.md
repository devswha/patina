---
pattern: 35
type: failure
name: 뜸들이기 서두
pack: ko-filler
language: ko
---

# Pattern 35: 뜸들이기 서두 — Failure (False Positive)

## Input Text

> 솔직히 말하면, 3월에 회사를 접을 뻔했다. 급여는 잔고 만 몇천 원을 남기고 겨우 나갔고, 공동창업자에게도 아내에게도 말하지 않았다. 이 글이 그 이야기를 처음 꺼내는 자리다.

## Expected Output

> (수정 없음 — 이 텍스트는 Pattern 35를 발화시키지 않아야 한다)

## Applied Pattern

- Pattern 35 (뜸들이기 서두): "솔직히 말하면"이 문단을 연다.

## Judgment

**Failure (false positive)** — 제외 조건 해당: 1인칭 글에서 말하기 어려운 고백 앞에 붙은 진짜 머뭇거림이다. 사업 주장을 솔직한 발언으로 연출하는 것이 아니라, 숨겨온 사실을 처음 꺼내며 마음을 다잡는 표지다. 삭제하면 고백적 문단의 결이 평평한 보고문으로 바뀐다.
