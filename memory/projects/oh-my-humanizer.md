# oh-my-humanizer

## Current state

- v3.2.0 — 프롬프트 기반 AI 텍스트 휴머나이저 스킬
- 2-Phase 파이프라인 안정화됨
- 한국어 28개, 영어 24개 패턴 탐지 팩 운용 중
- MAX mode (multi-model scoring) 활성

## Active priorities

- 패턴 커버리지 확장
- 영어 en-structure 팩 완성 (현재 placeholder)
- ouroboros scoring 시스템 안정화

## Autonomous Bot

- Status: active (hourly cron)
- Mode: `AUTO_MERGE=false` (validation period)
- Rules: `memory/topics/bot-rules.md`
- Discord: channel DISCORD_CHANNEL

## Keep here

- project status
- active priorities
- blockers and follow-ups
- links to handoffs and decisions
