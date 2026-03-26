# TOOLS.md — patina 환경 정보

## 레포 구조

```
patina/
├── AGENTS.md                # OpenClaw/Codex 공통 작업 규칙
├── USER.md                  # Discord 대화용 사용자 지침
├── SKILL.md                 # 메인 오케스트레이터 (2-Phase 파이프라인)
├── SKILL-MAX.md             # MAX mode 설계/참고 문서
├── patina-max/SKILL.md      # MAX mode 엔트리포인트
├── .patina.default.yaml     # 기본 설정
├── core/
│   ├── voice.md             # 문체/개성 가이드라인
│   └── scoring.md           # 스코어링 알고리즘
├── patterns/
│   ├── ko-*.md              # 한국어 AI 패턴 탐지 팩 (28개)
│   └── en-*.md              # 영어 AI 패턴 탐지 팩 (24개)
├── profiles/
│   ├── default.md           # 기본 프로필
│   └── blog.md              # 블로그/에세이 프로필
├── examples/                # 패턴별 성공/실패 예시
├── custom/                  # 사용자 확장 (gitignore됨)
└── memory/                  # bot memory scaffold
```

## 프로젝트 특성

- **프롬프트 기반 스킬** — 실행 코드보다 지침/패턴이 핵심
- 2-Phase 처리 파이프라인 (구조 → 문장/어휘 → 자기검수)
- `--lang` 플래그로 언어 선택, `Glob patterns/{lang}-*.md`로 패턴 자동 탐색
- 프로필별 voice-override, pattern-override 지원

## 기술 스택 주의사항

- 별도 앱 빌드는 거의 없음 — 마크다운 기반 프롬프트 프로젝트
- 버전 동기화 필수: `SKILL.md`, `SKILL-MAX.md`, `patina-max/SKILL.md`, `.patina.default.yaml`, `README.md`
- 새 언어 추가: `{lang}-*.md` 패턴 파일만 생성하면 자동 탐색

## Autonomous Bot

```
scripts/
├── bot.sh                  # Cron entrypoint: flock, openclaw agent, notifications
├── bot-prompt.md           # Cron bot brain: task priority, quality gates, reporting
├── openclaw-bootstrap.sh   # OpenClaw agent + Discord channel binding bootstrap
├── openclaw-component-bridge.mjs # Component-only Discord bot messages → OpenClaw relay
├── patina-component-bridge.service # User systemd unit for the component bridge
└── logs/                   # Run logs (gitignored, rotated at 30 days)
```

```bash
# local-only runtime config (gitignored)
cp .env.example .env
$EDITOR .env
```

```bash
# OpenClaw 에이전트/Discord 라우팅 프로비저닝
./scripts/openclaw-bootstrap.sh

# component-only bot 메시지 브리지 1회 점검
npm run openclaw:component-bridge:once

# 수동 봇 실행
./scripts/bot.sh

# 봇 활동 확인
cat memory/daily/$(date +%Y-%m-%d).md

# Auto-merge 토글 (기본값: false)
AUTO_MERGE=true ./scripts/bot.sh
```

## OpenClaw 연동

```bash
# 상태 확인
openclaw status

# patina 워크스페이스를 Discord 채널에 바인딩
./scripts/openclaw-bootstrap.sh

# 수동 알림 테스트
openclaw message send --channel discord --target "channel:${DISCORD_CHANNEL}" --message "patina 테스트 알림"

# component-only bot 메시지 브리지 상태
npm run openclaw:component-bridge:status
```

## 운영 메모

- Discord 연결은 OpenClaw gateway가 담당하므로 별도 `discord.js` 리스너를 돌리지 않음
- 실제 Discord/OpenClaw 식별자와 토큰은 공개 레포에 두지 않고 로컬 `.env` 또는 홈 디렉터리 설정에서만 관리
- `scripts/openclaw-bootstrap.sh`는 정확한 Discord 채널 peer binding을 추가함
- 가능하면 기존 `~/.clawhip/config.toml`의 Discord 토큰을 재사용해서 예전 봇 닉네임/권한을 그대로 이어감
- component-only Discord bot posts는 `scripts/openclaw-component-bridge.mjs`가 감지해서 `openclaw agent --deliver`로 릴레이함
- stricter allowlist가 필요하면 `OPENCLAW_ENFORCE_ALLOWLIST=true ./scripts/openclaw-bootstrap.sh`
