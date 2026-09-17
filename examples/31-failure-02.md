---
pattern: 31
type: failure
name: 결론 신호어 남용
pack: ko-filler
---

# Pattern 31: 결론 신호어 남용 — Failure (False Positive)

## Input Text

> 금요일 배포 포스트모템. 교훈:
> - 배포 체크리스트에 롤백 런북을 추가한다.
> - 금요일 프로덕션 푸시 전에 보조 리뷰어를 호출한다.
> - 장애 템플릿에 캐시 플러시 순서를 적는다.

## Expected Output

> (수정 없음 — 이 텍스트는 Pattern 31을 발화시키지 않아야 한다)

## Applied Pattern

- Pattern 31 (결론 신호어 남용): "교훈"이 목록 제목으로 등장한다.

## Judgment

**Failure (false positive)** — 교훈 목록 자체가 산출물인 포스트모템이다. 롤백 런북 추가, 보조 리뷰어 호출, 캐시 플러시 순서 기록은 본문이 이미 보여준 사건을 해설하는 문장이 아니라 수행할 조치다. 무수정 대조군은 그 조치를 지우지 않는다.
