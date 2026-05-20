---
fixture_id: ko-ai-06-chat-register
language: ko
class: ai
expected_hot: true
expected_metrics:
  cv_band: low
  mattr_band: high
  lexicon_density_min: 0
  lexicon_density_max: 80
why_designed_this_way: |
  공개 가능한 형태로 재작성한 Discord 봇 응답체 fixture. 실제 운영 맥락을 반영하되 개인 메시지나 비공개 내용을 포함하지 않는다.
topic: Discord bot project update
---

런타임 브리지는 컴포넌트 전용 봇 메시지를 작업 큐로 전달합니다. 스케줄러는 생성기가 브랜치를 만들기 전에 각 핸드오프를 기록합니다. 평가기는 변경 diff와 테스트 결과와 저장소 상태를 함께 확인합니다. 이 흐름은 디스코드 스레드를 읽기 쉽게 유지하면서 감사 기록을 남깁니다. 다음 실행에서도 같은 채널 바인딩을 재사용하고 중복 리스너를 피해야 합니다.
