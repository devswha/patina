# patina

## Current state

- v3.2.0 — 프롬프트 기반 AI 텍스트 휴머나이저 스킬
- 2-Phase 파이프라인 안정화됨
- 한국어 28개, 영어 24개 패턴 탐지 팩 운용 중
- MAX mode (multi-model scoring) 활성

## Active priorities

- 패턴 커버리지 확장
- 영어 en-structure 팩 완성 (현재 placeholder)
- ouroboros scoring 시스템 안정화

## Autonomous Bot — 3-Agent Harness

- Status: Phase 1 구현 완료, 첫 테스트 PASS
- Architecture: Planner → Generator → Evaluator (하이브리드 통신)
- Orchestrator: `scripts/harness.sh` (bot.sh deprecated)
- Agents: `planner`, `generator`, `evaluator` (전부 Opus)
- Prompts: `scripts/harness-prompts/{planner,generator,evaluator}.md`
- Artifacts: `artifacts/harness/{run-id}/`
- Design doc: `docs/harness-design.md`
- Mode: `AUTO_MERGE=false`
- Rules: `memory/topics/bot-rules.md`
- Discord: configured locally via `.env` (`DISCORD_CHANNEL`)
- Known issue: harness.sh SIGKILL on first test (PR 생성 직전, 원인 미조사)

## Keep here

- project status
- active priorities
- blockers and follow-ups
- links to handoffs and decisions
