# E2E Review Artifacts

실제 생성 샘플로 수행한 과거 E2E 결과 모음입니다. 일부 항목은 현재 CLI surface에서 제거된 MAX 모드 기록입니다.

- Generated at: 2026-03-07T07:14:43.886656
- Archive note: `03-patina-max-codex-ko.md`와 `04-patina-max-claude-codex-timeout.md`는 legacy `/patina-max` 기록이며, 현재 기본 모델/백엔드 문서가 아닙니다.

## Files

1. `00-generated-sample-ko.md` — 실제 생성된 AI스러운 한국어 원문
2. `01-patina-audit-ko.md` — `/patina --audit` 결과
3. `02-patina-rewrite-ko.md` — `/patina` 재작성 결과
4. `03-patina-max-codex-ko.md` — 보관된 legacy `/patina-max --models codex` 결과 (현재 defaults 아님)
5. `04-patina-max-claude-codex-timeout.md` — 보관된 legacy `/patina-max --models claude,codex` 타임아웃 메모

## Quick Summary

- `/patina --audit`: success
- `/patina`: success
- legacy `/patina-max --models codex`: archived success record, not current CLI/defaults
- legacy `/patina-max --models claude,codex`: archived timeout note on this long sample
