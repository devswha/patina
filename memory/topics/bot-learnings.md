# Bot Learnings

Lessons extracted from incidents, human review feedback, and bot failures.
The bot reads this file before each run to avoid repeating mistakes.

## Lessons

### 2026-03-25: cron PATH 미설정으로 5일간 무음 장애
- **증상:** 봇이 매시간 실행되지만 claude CLI를 찾지 못해 즉시 종료
- **원인:** `claude`는 `~/.local/bin/`에 설치되어 있지만, cron의 최소 PATH(`/usr/bin:/usr/local/bin`)에 미포함. bot.sh에 nvm 초기화는 있었으나 `~/.local/bin` PATH 추가 누락
- **왜 못 잡았나:** 수동 테스트(`./scripts/bot.sh`)는 터미널의 full PATH에서 실행되어 문제 없었음. `env -i` 시뮬레이션 검증을 계획했지만 실행하지 않음
- **이중 장애:** clawhip 데몬도 꺼져서 실패 알림 자체도 전달 안 됨 → 완전 무음
- **교훈:**
  1. cron용 스크립트는 반드시 `env -i`로 최소 환경 테스트할 것
  2. 외부 CLI 도구는 절대 PATH 또는 `export PATH="$HOME/.local/bin:$PATH"`로 명시할 것
  3. clawhip 데몬 상태를 주기적으로 확인하는 별도 체크 필요
