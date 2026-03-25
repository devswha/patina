# BOOTSTRAP.md — patina 워크스페이스 부트스트랩

## 세션 시작 시 수행할 작업

1. `IDENTITY.md` 읽기 — 정체성 확인
2. `CLAUDE.md` 읽기 — 운영 규칙 확인
3. `TOOLS.md` 읽기 — 환경 정보 확인
4. `openclaw status` 확인 — gateway / Discord 채널 상태 확인
5. 필요하면 `./scripts/openclaw-bootstrap.sh` 실행 — patina 에이전트, Discord 라우팅, 기존 봇 토큰, component bridge 동기화
6. GitHub 이슈/PR 상태 확인 — 미처리 항목 파악

## 프로젝트 경로

```
/home/devswha/workspace/patina
```

## 연결된 서비스

- GitHub: devswha/patina
- Discord: 채널 `1484400552262762496` (`oh-my-humanizer`)
- OpenClaw Gateway: `openclaw status`로 현재 주소/상태 확인

## Autonomous Bot

- Discord 대화는 OpenClaw gateway가 직접 처리
- Cron bot runs hourly via cron (`scripts/bot.sh`)
- Bot PRs are labeled `bot`
- `AUTO_MERGE` env var controls merge behavior (default: `false`)
- Bot rules: `memory/topics/bot-rules.md`
