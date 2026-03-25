# TOOLS.md — oh-my-humanizer 환경 정보

## 레포 구조

```
oh-my-humanizer/
├── SKILL.md                 # 메인 오케스트레이터 (2-Phase 파이프라인)
├── SKILL-MAX.md             # MAX mode 설계/참고 문서
├── humanizer-max/SKILL.md   # MAX mode 엔트리포인트
├── .humanizer.default.yaml  # 기본 설정
├── core/
│   ├── voice.md             # 문체/개성 가이드라인
│   └── scoring.md           # 스코어링 알고리즘
├── patterns/
│   ├── ko-*.md              # 한국어 AI 패턴 탐지 팩 (28개)
│   └── en-*.md              # 영어 AI 패턴 탐지 팩 (28개)
├── profiles/
│   ├── default.md           # 기본 프로필
│   └── blog.md              # 블로그/에세이 프로필
├── examples/                # 패턴별 성공/실패 예시
├── custom/                  # 사용자 확장 (gitignore됨)
└── memory/                  # clawhip memory scaffold
```

## 프로젝트 특성

- **프롬프트 기반 스킬** — 실행 코드 없음, Claude가 런타임
- **oh-my-zsh 스타일 플러그인 구조** (v3.2.0)
- 2-Phase 처리 파이프라인 (구조 → 문장/어휘 → 자기검수)
- `--lang` 플래그로 언어 선택, `Glob patterns/{lang}-*.md`로 패턴 자동 탐색
- 프로필별 voice-override, pattern-override 지원

## 기술 스택 주의사항

- 코드 빌드/테스트 없음 — 마크다운 기반 프롬프트 프로젝트
- 버전 동기화 필수: `SKILL.md`, `SKILL-MAX.md`, `humanizer-max/SKILL.md`, `.humanizer.default.yaml`, `README.md`
- 새 언어 추가: `{lang}-*.md` 패턴 파일만 생성하면 자동 탐색

## Autonomous Bot

```
scripts/
├── bot.sh           # Cron entrypoint: flock, timeout, claude -p, notifications
├── bot-prompt.md    # Bot brain: task priority, inline scoring, quality gates
└── logs/            # Run logs (gitignored, rotated at 30 days)
```

```bash
# Manual bot run
./scripts/bot.sh

# Check bot activity
cat memory/daily/$(date +%Y-%m-%d).md

# Toggle auto-merge (default: false)
AUTO_MERGE=true ./scripts/bot.sh
```

## clawhip 연동

```bash
# 상태 확인
clawhip status

# 수동 알림 테스트
clawhip send --channel 1484400552262762496 --message "oh-my-humanizer 테스트 알림"
```
