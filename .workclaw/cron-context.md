# cron-context.md — Cron 실행 컨텍스트 가이드

## 목적
OpenClaw cron이 harness를 트리거할 때 주입되는 컨텍스트를 정의한다.
하네스가 "지금 뭘 해야 하는지"를 빠르게 판단할 수 있도록 최소한의 상태를 전달한다.

## 컨텍스트 구성

### 1. 환경 변수 (harness.sh가 설정)
| 변수 | 설명 | 기본값 |
|---|---|---|
| `REPO_DIR` | 워크스페이스 루트 | `/home/devswha/workspace/patina` |
| `AUTO_MERGE` | PR 자동 머지 여부 | `false` |
| `MAX_REVISE_LOOPS` | 평가자 REVISE 최대 횟수 | `3` |
| `DISCORD_CHANNEL` | 알림 대상 채널 | `1484400552262762496` |

### 2. 런타임 상태 (매 실행 시 수집)
- `git status --short` — dirty checkout이면 즉시 skip
- `git branch -r --list 'origin/bot/*'` — 고아 브랜치 정리
- `gh issue list --state open --json number,title,labels` — 작업 후보
- `gh pr list --state open --author @me --json number,title` — 진행 중 PR

### 3. 메모리 주입
harness 실행 전 플래너가 읽어야 할 파일:
- `memory/topics/bot-rules.md` — 운영 규칙
- `memory/topics/bot-learnings.md` — 실패 교훈
- `memory/daily/{today}.md` — 오늘 이미 한 작업

### 4. Artifact 경로
```
artifacts/harness/{RUN_ID}/
├── spec.md       # 플래너 출력
├── diff.patch    # 제너레이터 출력
├── review.md     # 평가자 출력
├── result.json   # 최종 상태 (success/failure/skip/no-tasks)
└── pr-body.md    # PR 본문 (생성 시)
```

## 실행 주기
- 기본: 매시 정각 (`0 * * * *`)
- flock으로 중복 방지 (`/tmp/patina-bot.lock`)
- 1회 실행당 최대 1개 태스크

## Skip 조건
| 조건 | 동작 |
|---|---|
| dirty checkout | `result.json` skip 기록, 즉시 종료 |
| 열린 bot/* PR 존재 | skip (이전 PR 머지/리뷰 대기) |
| 이슈 없음 + 감사 통과 | `No actionable tasks found.` |
