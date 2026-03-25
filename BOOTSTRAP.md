# BOOTSTRAP.md — patina 워크스페이스 부트스트랩

## 세션 시작 시 수행할 작업

1. `IDENTITY.md` 읽기 — 정체성 확인
2. `CLAUDE.md` 읽기 — 운영 규칙 확인
3. `TOOLS.md` 읽기 — 환경 정보 확인
4. clawhip status 확인 — 데몬 정상 동작 확인
5. GitHub 이슈/PR 상태 확인 — 미처리 항목 파악

## 프로젝트 경로

```
/home/devswha/workspace/patina
```

## 연결된 서비스

- GitHub: devswha/patina
- Discord: 채널 DISCORD_CHANNEL
- clawhip: http://127.0.0.1:25294

## Autonomous Bot

- Bot runs hourly via cron (`scripts/bot.sh`)
- Bot PRs are labeled `bot`
- `AUTO_MERGE` env var controls merge behavior (default: `false`)
- Bot rules: `memory/topics/bot-rules.md`
