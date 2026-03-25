# E2E Review Artifacts

실제 생성 샘플로 수행한 E2E 결과 모음입니다.

- Generated at: 2026-03-07T07:14:43.886656

## Files

1. `00-generated-sample-ko.md` — 실제 생성된 AI스러운 한국어 원문
2. `01-patina-audit-ko.md` — `/patina --audit` 결과
3. `02-patina-rewrite-ko.md` — `/patina` 재작성 결과
4. `03-patina-max-codex-ko.md` — `/patina-max --models codex` 결과
5. `04-patina-max-claude-codex-timeout.md` — `/patina-max --models claude,codex` 타임아웃 메모

## Quick Summary

- `/patina --audit`: success
- `/patina`: success
- `/patina-max --models codex`: success
- `/patina-max --models claude,codex`: timeout on this long sample
