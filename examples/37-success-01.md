---
pattern: 37
type: success
name: 콜론 반전 연출
pack: ko-style
language: ko
---

# Pattern 37: 콜론 반전 연출 — Success

## Input Text

> 연휴 동안 임포터를 Rust로 다시 썼다. 결과: 12배 빨라짐. 더 놀라운 건: 메모리 사용량 절반. 반전: 바이너리가 기존 Python 번들보다 작다.

## Expected Output

> 연휴 동안 임포터를 Rust로 다시 써서 12배 빨라졌다. 메모리 사용량은 절반으로 줄었고, 바이너리는 기존 Python 번들보다 작다.

## Applied Pattern

- Pattern 37 (콜론 반전 연출): 네 문장에 콜론 연출 3개 — "결과:", "더 놀라운 건:", "반전:" — 사실 하나하나를 펀치라인 전달로 바꾼다.

## Judgment

**Success** — 발화 조건 충족: 콜론 연출 3회는 2회 이상 기준을 넘고, 어느 콜론도 목록·라벨·정의의 구조적 역할을 하지 않는다. 평서문이 같은 사실을 드럼롤 없이 전달하고, 문단이 참여 최적화 카피처럼 읽히지 않게 된다.
