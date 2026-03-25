# Bot Learnings

Lessons extracted from incidents, human review feedback, and bot failures.
The bot reads this file before each run to avoid repeating mistakes.

## Lessons

### 2026-03-25: cron PATH 미설정으로 5일간 무음 장애
- **증상:** 봇이 매시간 실행되지만 런타임 CLI를 찾지 못해 즉시 종료
- **원인:** CLI가 `~/.local/bin/` 또는 nvm bin PATH에 있지만, cron의 최소 PATH(`/usr/bin:/usr/local/bin`)에 미포함
- **왜 못 잡았나:** 수동 테스트(`./scripts/bot.sh`)는 터미널의 full PATH에서 실행되어 문제 없었음. `env -i` 시뮬레이션 검증을 계획했지만 실행하지 않음
- **이중 장애:** 알림 전송 경로까지 비정상이면 실패 자체가 조용히 묻힐 수 있음
- **교훈:**
  1. cron용 스크립트는 반드시 `env -i`로 최소 환경 테스트할 것
  2. 외부 CLI 도구는 절대 PATH 또는 `export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"`처럼 명시할 것
  3. 알림/대화 런타임(OpenClaw gateway) 상태를 주기적으로 확인할 것

### 2026-03-25: Discord 연결은 커스텀 리스너보다 OpenClaw gateway에 위임
- **배경:** `discord.js` 리스너 + `clawhip` 알림 조합은 운영 지점이 둘로 갈라져 장애 추적이 번거로웠음
- **교훈:**
  1. Discord ingress/egress는 OpenClaw gateway 하나로 통합할 것
  2. 워크스페이스 라우팅은 exact channel binding으로 고정할 것
  3. 중복 응답 방지를 위해 legacy listener는 disable 상태를 유지할 것
  4. 기존 채널에서 보이던 봇 닉네임을 유지하려면 OpenClaw도 기존 bot token을 재사용할 것

### 2026-03-26: component-only bot 메시지는 별도 브리지가 필요
- **증상:** 다른 봇이 채널에 말해도 OpenClaw가 반응하지 않았음
- **원인:** 실제 메시지 본문은 비어 있고 Discord components(type 17/10) 안에 텍스트가 들어 있었음
- **교훈:**
  1. `channels.discord.allowBots=true`만으로는 component-only bot posts를 처리하지 못할 수 있음
  2. 최신 메시지 payload를 직접 읽어 `components[].content`까지 확인해야 함
  3. 브리지 서비스는 component-only bot posts만 릴레이해서 bot-to-bot 루프를 최소화할 것
