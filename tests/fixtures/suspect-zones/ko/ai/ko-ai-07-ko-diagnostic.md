---
fixture_id: ko-ai-07-ko-diagnostic
language: ko
class: ai
expected_hot: true
register: workplace-summary
source_type: synthetic
model_family: local-fixture
notes: "Korean diagnostic composite: no comma rhythm, regular eojeol lengths, low suffix-class diversity; legacy burstiness/MATTR/lexicon stay cold."
expected_metrics:
  detectors:
    burstiness: false
    koDiagnostics: true
    mattr: false
    lexicon: false
    endingMonotony: false
    candor: false
    thematicBreak: false
---
아침 회의는 기록을 확인합니다. 담당자는 오늘 진행할 항목을 차례대로 검토합니다. 화면은 변경된 값을 보여주고 팀은 같은 절차를 다시 확인합니다. 마지막으로 결과는 공유합니다.
