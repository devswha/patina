---
title: gstack — Claude Code를 팀처럼 쓰는 법
category: Github
source_repo: https://github.com/garrytan/gstack
created: 2026-03-27
notes:
  - GitHub stats checked on 2026-03-27 UTC via gh CLI
  - README self-reported productivity metrics are marked as README claims
---

## 본문

[Github] gstack
https://github.com/garrytan/gstack

Claude Code를 그냥 채팅창처럼 쓰면 금방 막힌다.
역할도 없고, 검토도 없고, QA도 없으니까.

gstack는 그걸 "한 명의 AI"가 아니라 "역할이 나뉜 팀"처럼 쓰게 만드는 세팅이다. Garry Tan이 공개했다.

## 답글 1

이 레포를 한 줄로 요약하면 이렇다.

- 아이디어를 재정의하는 `/office-hours`
- CEO 시점으로 범위를 다시 보는 `/plan-ceo-review`
- 엔지니어링 관점으로 설계를 고정하는 `/plan-eng-review`
- 브랜치 변경을 잡아내는 `/review`
- 실제 브라우저로 확인하는 `/qa`
- PR까지 마무리하는 `/ship`

핵심은 "좋은 프롬프트 모음"이 아니라, 개발 과정을 순서로 강제한다는 점이다.

## 답글 2

README 기준으로 gstack는 Claude Code를 "가상 엔지니어링 팀"처럼 쓰게 만든다.
CEO, 엔지니어링 매니저, 디자이너, 리뷰어, QA, 보안 책임자, 릴리즈 엔지니어 역할을 나눠 놓았다.

그래서 흐름도 단순하다.

생각 → 계획 → 구현 → 리뷰 → 테스트 → 배포 → 회고

AI를 똑똑하게 쓰는 사람들은 대개 여기서 차이가 난다.
모델 성능보다, 일을 어떤 순서로 시키는지가 더 중요하다.

## 답글 3

이 레포가 특히 재밌는 이유는 Claude 전용에서 안 멈춘다는 점이다.
README에 따르면 SKILL.md 표준을 지원하는 에이전트라면 쓸 수 있게 열어뒀다.

즉:
- Claude Code
- Codex
- Gemini CLI
- Cursor

같은 계열로 확장해서 설치할 수 있다.
Codex 쪽은 `.agents/skills/gstack`에 clone한 뒤 `./setup --host codex`로 붙이는 방식이다.

## 답글 4

수치도 강하게 적혀 있다.
다만 이건 외부 검증 수치가 아니라 README에 적힌 자기 보고라는 점은 감안해서 봐야 한다.

README에 따르면:
- 최근 60일 생산 코드 60만+ 라인
- 테스트 비중 35%
- 하루 1만~2만 라인
- 1주일 기준 362 commits, 140,751 lines added

중요한 건 숫자 자체보다,
"혼자 많이 친다"가 아니라 "역할 분리와 리뷰 루프를 붙였더니 처리량이 폭증했다"는 주장이다.

## 답글 5

2026-03-27 UTC 기준 GitHub 지표는 이렇다.
- Stars: 50,844
- Forks: 6,519
- License: MIT

왜 많이 보느냐면,
단순히 "Claude Code 잘 쓰는 법"이 아니라
"AI 에이전트를 팀처럼 운영하는 운영체제"에 가깝기 때문이다.

처음 써볼 거면 README가 권하는 진입점대로
`/office-hours` → `/plan-ceo-review` → `/review` → `/qa`
이 순서만 따라가도 감이 올 거다.

## 답글 6

다만 바로 따라 쓰면 안 맞는 팀도 있다.

- 프로세스를 싫어하는 사람
- 작은 스크립트만 빨리 고치는 사람
- 이미 자기 워크플로우가 단단한 팀

한테는 과할 수 있다.

반대로,
"AI가 코드는 짜는데 자꾸 방향이 틀어진다"
"리뷰와 QA가 빠져서 결국 내가 다시 본다"
싶으면 한 번 뜯어볼 가치가 충분하다.

소스:
- GitHub repo: https://github.com/garrytan/gstack
- README / repo metadata checked on 2026-03-27 UTC
