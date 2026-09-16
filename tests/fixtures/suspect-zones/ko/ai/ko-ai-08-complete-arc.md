---
fixture_id: ko-ai-08-complete-arc
language: ko
class: ai
expected_hot: false
discourse_shape: complete-prose
why_designed_this_way: |
  Heading-less complete prose about a fictional open-source table classifier.
  Slop lexicon 0 (no 결론적으로/이를 통해/의미가 있다), sparse connectors,
  contentful lesson closer (배웠습니다) with no new number. Inspect-only
  discourse_shape is complete-prose. expected_hot follows current analyzeText
  burstiness/lexicon behavior and is not a claim that this flips hot.
topic: fictional open-source table classifier
---

테이블 칸을 종류별로 나누는 작은 분류기를 만들었다. 공개 저장소에 올렸고, 이슈 열두 개가 일주일 만에 달렸다.

첫 주는 헤더 행을 숫자 열로 오인하는 경우가 잦았다. 헤더에 연도가 있으면 측정값으로 읽혔다.

열 이름을 한 번 더 보는 규칙을 넣었다. 먹혔다. 그다음 주부터는 헤더 연도를 측정값으로 읽던 같은 실수가 거의 사라졌고, PR 네 건이 그 규칙을 고쳤다.

이 작업을 하면서 헤더와 값을 먼저 구분하지 않으면 나머지 파이프라인이 전부 흔들린다는 걸 배웠습니다.
