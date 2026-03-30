---
title: gstack 카드뉴스 초안
source_repo: https://github.com/garrytan/gstack
created: 2026-03-27
format: cardnews-storyboard
notes:
  - GitHub stats checked on 2026-03-27 UTC via gh CLI
  - README self-reported productivity metrics are labeled explicitly
---

# Slide 1 — Cover
- 제목: gstack
- 부제: Claude Code를
  팀처럼 쓰는 법
- 한 줄 메시지: 프롬프트 모음이 아니라 개발 프로세스 세트

# Slide 2 — 문제 제기
- 제목: AI 코딩이 자꾸
  어긋나는 이유
- 포인트:
  - 역할이 없다
  - 리뷰가 없다
  - QA가 없다
  - 그래서 결국 사람이 다시 본다
- 강조 문장: 모델보다 운영 방식이 더 중요하다

# Slide 3 — gstack가 하는 일
- 제목: Claude Code를
  역할 분리된 팀으로
- 포인트:
  - `/office-hours` — 문제 재정의
  - `/plan-ceo-review` — 범위 점검
  - `/plan-eng-review` — 설계 고정
  - `/review` — production bug 관점 검토
  - `/qa` — 실제 브라우저 확인
  - `/ship` — PR/릴리즈 마무리

# Slide 4 — 핵심 구조
- 제목: 이건 도구 모음보다
  프로세스에 가깝다
- 흐름:
  - 생각
  - 계획
  - 구현
  - 리뷰
  - 테스트
  - 배포
  - 회고
- 강조 문장: 각 스킬이 다음 단계의 입력을 만든다

# Slide 5 — 왜 화제가 됐나
- 제목: 숫자보다
  주장 구조가 세다
- 포인트:
  - README 기준 최근 60일 생산 코드 60만+ 라인
  - 테스트 비중 35%
  - 하루 1만~2만 라인 주장
  - 1주일 362 commits, 140,751 lines added
- 주의 문구:
  - 위 수치는 README의 자기 보고 기준
  - 핵심은 처리량이 아니라 역할 분리 + 리뷰 루프

# Slide 6 — Codex 사용자에게 중요한 점
- 제목: Claude 전용에서
  안 멈춘다
- 포인트:
  - SKILL.md 표준 기반 호환성 강조
  - Codex / Gemini CLI / Cursor 설치 경로 제공
  - Codex는 `.agents/skills/gstack` + `./setup --host codex`
- 강조 문장: 워크플로우를 다른 에이전트로도 이식하려는 시도

# Slide 7 — 지금 볼 만한 이유
- 제목: AI를 잘 쓰는 건
  모델 선택이 끝이 아니다
- 포인트:
  - 역할을 나누고
  - 순서를 고정하고
  - 검토와 QA를 붙여야 한다
- CTA:
  - AI가 자꾸 엉뚱한 방향으로 가면
  - gstack README의 Quick start부터 읽어볼 것

# Reference
- Repo: https://github.com/garrytan/gstack
- Stats checked on 2026-03-27 UTC:
  - Stars: 50,844
  - Forks: 6,519
  - License: MIT
