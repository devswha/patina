# Before/After Gallery

아래는 문체를 다듬을 때 의미를 어디까지 보존해야 하는지 보여 주는 예시입니다. 모델 기반 편집 검토로 정리했으며, 실제 실행 로그나 사람의 평가 점수가 아닙니다. 원문의 사실 여부를 독립적으로 검증한 자료도 아닙니다.

## English: 부풀린 제품 카피

**Before**

> AI coding tools represent a transformative leap forward in the software development lifecycle, enabling teams to streamline workflows, enhance collaboration, and unlock unprecedented levels of productivity across the organization.

**After**

> AI coding tools let teams streamline workflows, improve collaboration and reach new levels of productivity across the organization. They mark a major step forward in software development.

**편집 설명**: 세 갈래 장점 나열을 문장으로 나눴습니다. 워크플로·협업·조직 전반의 생산성에 대한 원문의 주장은 유지했습니다. 테스트 초안이나 설정 파일 같은 적용 사례를 새로 만들지 않았습니다.

## Korean: 장점 나열

**Before**

> 본 솔루션은 사용자의 업무 효율성을 극대화하고, 생산성 향상을 도모하며, 더 나은 협업 경험을 제공하는 혁신적인 도구입니다.

**After**

> 이 도구는 사용자의 업무 효율을 최대한 높이고 생산성 향상을 돕습니다. 협업 경험도 더 좋게 만드는 새로운 도구입니다.

**편집 설명**: "본 솔루션", "도모하며"를 풀어썼습니다. 업무 효율·생산성·협업의 세 주장은 남겼으며, 문서 정리나 초안 작성 기능을 추가하지 않았습니다.

## English: 흐릿한 균형감

**Before**

> While there are challenges to consider, it is important to recognize that this technology has the potential to create meaningful value when implemented thoughtfully.

**After**

> This technology could create meaningful value if implemented thoughtfully, though challenges remain.

**편집 설명**: 빈 도입어를 줄였습니다. 어려움이 있다는 점, 신중하게 도입할 경우라는 조건, 가치 창출의 가능성은 남겼습니다.

## Technical: 아키텍처 주장

**Before**

> This architecture provides a robust and scalable foundation for future enhancements, ensuring that teams can effectively adapt to evolving requirements while maintaining operational excellence.

**After**

> This architecture gives teams a solid, scalable base for future improvements. It lets them adapt to changing requirements while keeping operations running well.

**편집 설명**: 기반과 운영에 대한 추상적인 표현을 풀었습니다. 확장성과 요구사항 대응 능력은 유지했고, 백엔드·CLI·설정 구조를 새 사실로 넣지 않았습니다.

## Korean: instructional / tutorial register

**Before**

> Git stash는 작업 중인 변경사항을 임시로 저장할 수 있는 매우 유용한 기능입니다. 본 명령어를 활용함으로써 사용자는 현재 작업 내용을 손실 없이 다른 브랜치로 신속하게 전환할 수 있게 됩니다.

**After**

> Git stash는 작업 중인 변경사항을 잠시 저장하는 데 유용합니다. 이 명령어로 현재 작업 내용을 잃지 않고 다른 브랜치로 빠르게 전환할 수 있습니다.

**편집 설명**: "본 명령어를 활용함으로써"와 늘어진 종결을 줄였습니다. 임시 저장과 작업 보존, 빠른 브랜치 전환은 그대로입니다. 원문에 없는 사용 상황은 보충하지 않았습니다.

## Korean: 1인칭 회고 — 기억과 감정 보존

**Before**

> 처음 코드 리뷰를 받았던 날을 떠올리면 여전히 마음 한구석이 묘해지는 것을 느낀다. 선배의 피드백 한 줄 한 줄이 마치 거대한 산처럼 다가왔으며, 그 순간은 개발자로서의 성장에 있어 잊을 수 없는 의미 있는 전환점이었다고 표현할 수 있을 것이다.

**After**

> 처음 코드 리뷰를 받던 날을 떠올리면 지금도 마음이 묘하다. 선배의 피드백은 한 줄 한 줄 거대한 산처럼 다가왔다. 개발자로 성장하면서 잊을 수 없는 전환점이라 할 만한 날이었다.

**편집 설명**: 장황한 감정 설명과 겹친 완화를 줄였습니다. 선배의 피드백과 전환점이라는 평가는 남겼습니다. 회고를 다듬더라도 원문에 없는 신체 감각이나 장면을 만들지는 않습니다.

## Korean: SNS marketing — viral-hook signals

**Before**

> GitHub 역사상 이런 속도는 없었다. 단 60일 만에 별 25만 개. OpenClaw라는 도구가 세운 기록임. 광고 한 번 안 하고 전 세계 개발자들이 미친 듯이 달려든 이유가 뭘까.

**After**

> GitHub 역사상 이런 속도는 없었다. 단 60일 만에 별 25만 개. OpenClaw라는 도구가 세운 기록임. 광고 한 번 안 하고 전 세계 개발자들이 미친 듯이 달려든 이유가 뭘까.

**편집 설명**: 교정 없음: 이 예시는 바이럴 훅 팩의 score-only 동작을 보여 줍니다. 출처 없는 숫자와 기록 주장을 그대로 두고 점수·감사 대상으로 살핍니다. "새벽 3시 버그 수정" 같은 성공 원인을 만들어 질문에 답하지 않습니다. 수치나 기록의 사실 여부를 검증한 자료는 아닙니다.

## English: chatbot register

**Before**

> I'd be happy to help you understand Git stash! That's a great question. Git stash is a very useful command that allows you to temporarily save your changes. Let me know if you have any other questions!

**After**

> Git stash is useful for temporarily saving your changes.

**편집 설명**: 챗봇 도입·칭찬·맺음말을 덜었습니다. 원문이 실제로 설명한 임시 저장 기능만 남겼으며, 브랜치 전환이나 긴급 작업 상황을 덧붙이지 않았습니다.

## English: viral-hook authority claim

**Before**

> The fastest growth GitHub has ever seen — devs around the world are absolutely losing their minds. Why is everyone flocking to OpenClaw without any marketing?

**After**

> The fastest growth GitHub has ever seen — devs around the world are absolutely losing their minds. Why is everyone flocking to OpenClaw without any marketing?

**편집 설명**: 교정 없음: 영문 바이럴 훅도 점수·감사 전용 대조군으로 보존합니다. 별 개수·기간·명령어 기능·NVIDIA 채택처럼 입력에 없는 근거는 넣지 않습니다. 원문의 기록·인기 주장에 대한 사실 확인은 별도입니다.

## 갤러리 추가 자료

원문·재작성 쌍은 아래 경로에서 볼 수 있습니다. 연구 실행 기록은 당시 결과로 남아 있으며, 현재의 설명용 기대 출력과 구별해야 합니다. 이번 검토에서 본문을 고친 파일도 끝의 과거 톤 메타데이터는 보존했습니다.

- **`examples/short/`** — 네 개의 짧은 Korean fixture(marketing, tutorial, essay, email)와 짝을 이루는 `*-rewritten.md` 파일.
- **`examples/genres/`** — 세 개의 긴 Korean genre(technical, academic, narrative)와 짝을 이루는 rewrite.
- **`examples/rewrite-axes/`** — v7 축 fixture. `casual`/`professional`은 Register를, `academic`/`narrative`/`marketing`/`instructional`은 Document Type을 보여 줍니다. 해당 자료는 별도 검토 범위이며, 이 페이지의 편집 검토가 모든 출력의 의미 보존을 보증하지는 않습니다.
- **`examples/viral-hook/`** — 스코어 전용 viral-hook 팩의 탐지 case study(`case-01`, `case-02`).

## patina가 확인하는 것

- rewrite가 AI-writing pattern을 제거했나요?
- rewrite가 원래 주장을 유지했나요?
- rewrite가 source에 없던 내용을 추가했나요?
- 변경을 `--audit`, `--diff`, `--score`로 검토할 수 있나요?

목표는 editing quality이지 detector evasion이 아닙니다. AI detector는 잡음이 많습니다. patina는 score를 대략적인 신호로 보고, diff를 실제로 유용한 산출물로 봅니다.
