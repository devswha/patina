# humanizer-korean

## Core Mission

**"AI처럼 안보이는 한국어 문장 만들기"** — 이것이 이 프로젝트의 유일한 핵심 목표다.

AI가 생성한 한국어 텍스트에서 기계적 패턴을 탐지하고, 사람이 쓴 것처럼 자연스럽게 고쳐주는 Claude Code 스킬.

## Architecture

- 프롬프트 기반 스킬 (실행 코드 없음, Claude가 런타임)
- oh-my-zsh 스타일 플러그인 구조 (v2.1)
- `SKILL.md`가 오케스트레이터, 2-Phase 파이프라인 (구조→문장/어휘→자기검수)
- 프로필별 voice-override, pattern-override 지원

## Key Files

- `SKILL.md` — 메인 오케스트레이터 (2-Phase 처리 파이프라인)
- `.humanizer.default.yaml` — 기본 설정
- `core/voice.md` — 문체/개성 가이드라인
- `patterns/*.md` — AI 패턴 탐지 팩 (27개 패턴, 6개 팩)
- `profiles/default.md` — 기본 프로필
- `profiles/blog.md` — 블로그/에세이 프로필 (파일럿)
- `examples/` — 패턴별 성공/실패 예시
- `custom/` — 사용자 확장 (gitignore됨)

## Development Guidelines

- 모든 변경은 "이게 AI 텍스트를 더 사람답게 만드는가?"를 기준으로 판단
- 패턴 추가 시 반드시 실제 AI 생성 한국어 예시와 교정 예시를 포함
- `SKILL.md`, `.humanizer.default.yaml`, `README.md`의 version 필드는 동기화 필수
