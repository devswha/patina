# heartbeat-prompt.md — 하네스 헬스체크 프롬프트

## 목적
하네스가 정상 동작 중인지 주기적으로 확인하는 경량 프롬프트.
cron이 별도 주기로 이 프롬프트를 실행하면, 하네스 환경 상태를 빠르게 점검하고 이상 시 알림을 보낸다.

## 헬스체크 항목

### 필수 (하나라도 실패 → 알림)
1. **Git 상태**: `git status --short` — dirty면 경고
2. **브랜치**: `git branch --show-current` — main이 아니면 경고
3. **고아 브랜치**: `git branch -r --list 'origin/bot/*'` — 24시간 이상 된 것 있으면 경고
4. **OpenClaw gateway**: `openclaw status` — 비정상이면 경고
5. **디스크**: `df -h /home/devswha` — 90% 이상이면 경고
6. **최근 실행**: 최신 `artifacts/harness/*/result.json` — 3회 연속 failure면 경고

### 선택 (정보 수집만)
- 열린 이슈 수: `gh issue list --state open --json number | jq length`
- 열린 봇 PR 수: `gh pr list --state open --label bot --json number | jq length`
- 오늘 실행 횟수: `ls artifacts/harness/$(date +%Y%m%d)-* 2>/dev/null | wc -l`

## 응답 형식

### 정상
```
HEARTBEAT_OK
```

### 이상 감지
```
⚠️ patina heartbeat alert:
- [항목]: [상세]
- [항목]: [상세]
```

## 실행 주기 권장
- 6시간마다 (`0 */6 * * *`)
- 또는 하네스 cron과 별도 오프셋 (`30 */6 * * *`)

## 알림 채널
- Discord: `channel:1484400552262762496`
- 정상이면 무음 (HEARTBEAT_OK → 폐기)
- 이상이면 알림 전송
