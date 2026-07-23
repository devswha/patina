---
pattern: 36
type: failure
name: 가짜 통찰 셋업
pack: ko-filler
language: ko
---

# Pattern 36: 가짜 통찰 셋업 — Failure (False Positive)

## Input Text

> 대부분이 잘못 알고 있는 사실인데, 1976년 저작권법 개정으로 이 사안은 이미 규율된다. 시중 개론서 다섯 권 중 세 권이 반복하는 통념은 1978년 이전 음반이 연방 보호 밖이라는 것이다. 그러나 제301조 (c)항은 다르게 말한다. 주법 보호는 2067년까지 이어지고, 2018년 CLASSICS 법이 디지털 실연권을 그 위에 더했다.

## Expected Output

> (수정 없음 — 이 텍스트는 Pattern 36을 발화시키지 않아야 한다)

## Applied Pattern

- Pattern 36 (가짜 통찰 셋업): "대부분이 잘못 알고 있는"이 문단을 연다.

## Judgment

**Failure (false positive)** — 제외 조건 해당: 통념이 무엇인지(어디에 실렸는지까지) 문서화한 뒤 구체적인 법조문으로 반박한다. 셋업이 실제로 널리 퍼진 오독을 특정하고 증거로 교정하는 논증 작업을 하고 있으므로, 유일한-내부자 연출이 아니다.
