---
fixture_id: ko-nat-06-headed-notes
language: ko
class: natural
expected_hot: false
discourse_shape: headed-notes
why_designed_this_way: |
  Same facts as ko-ai-08-complete-arc, written as headings plus bullets.
  No lesson closer, no why-scaffolding. Inspect-only discourse_shape is
  headed-notes. expected_hot follows current analyzeText behavior.
topic: fictional open-source table classifier
---

# 작업

- 테이블 칸 분류기
- 공개 저장소
- 이슈 열두 개

# 문제

- 헤더 행을 숫자 열로 오인
- 헤더의 연도를 측정값으로 읽음

# 방법

- 열 이름을 한 번 더 보는 규칙

# 결과

- 같은 실수 감소
- PR 네 건
