# execution-loop-prompt.md — 하네스 실행 루프 명세

## 목적
`harness.sh`가 구동하는 3-agent 실행 루프의 전체 흐름을 정의한다.
각 에이전트의 역할, 입출력, 전이 조건을 명시하여 하네스 동작을 예측 가능하게 만든다.

## 전체 흐름

```
cron trigger
    │
    ▼
┌─────────────────┐
│  Pre-flight     │  git clean? main branch? orphan cleanup?
│  Checks         │  실패 → skip + result.json 기록
└────────┬────────┘
         │ pass
         ▼
┌─────────────────┐
│  Planner        │  이슈/PR/레포 상태 읽기 → spec.md 작성
│  Agent          │  태스크 없으면 → "No actionable tasks" + 종료
└────────┬────────┘
         │ spec.md
         ▼
┌─────────────────┐
│  Generator      │  bot/* 브랜치 생성 → 구현 → quality gate → diff.patch
│  Agent          │  
└────────┬────────┘
         │ diff.patch
         ▼
┌─────────────────┐
│  Evaluator      │  cold-context 리뷰 → review.md → PASS / REVISE / FAIL
│  Agent          │  
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
  PASS     REVISE ──→ Generator (최대 3회) ──→ 3회 초과 시 FAIL
    │         
    ▼         
┌─────────────────┐
│  PR Creation    │  push → gh pr create → 라벨 부여
│  & Merge        │  AUTO_MERGE=true면 squash merge + branch delete
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Cleanup        │  result.json 기록, daily log 추가, Discord 알림
│  & Notify       │  git checkout main
└─────────────────┘
```

## 에이전트별 상세

### Planner
- **입력**: 오픈 이슈, 오픈 PR, 레포 상태, bot-rules, bot-learnings
- **출력**: `spec.md` (태스크 정의, 변경 대상, 예상 quality gate 유형)
- **우선순위**: bug > enhancement > documentation > version-sync > audit > discovery > multilingual
- **타이브레이커**: 같은 우선순위면 가장 오래된 이슈 (낮은 번호)

### Generator
- **입력**: `spec.md`, 관련 소스 파일
- **출력**: `diff.patch` (커밋된 변경사항)
- **규칙**:
  - `bot/{issue}-{slug}` 브랜치에서 작업
  - Lore 커밋 메시지 + `Co-Authored-By: patina-bot <bot@devswha.dev>`
  - 콘텐츠 변경 시 인라인 스코어링 실행 (목표: ≤ 30)
  - scope 위반 금지 (`.workclaw/allowed-scope.md` 참조)

### Evaluator
- **입력**: `spec.md`, `diff.patch`, 변경된 파일 (cold context — Generator 대화 미참조)
- **출력**: `review.md` + 판정 (`PASS` / `REVISE` / `FAIL`)
- **판정 기준**:
  - `PASS`: spec 충족, scope 준수, quality gate 통과
  - `REVISE`: 경미한 문제, 수정 가능 (구체적 피드백 포함)
  - `FAIL`: scope 위반, 반복 실패 (3회 REVISE), 되돌릴 수 없는 문제

## 타임아웃
- 전체 하네스: 30분
- 개별 에이전트: 10분 (harness.sh에서 관리)
- 타임아웃 시: 브랜치 정리, failure 기록, 알림

## 실패 모드

| 실패 유형 | 처리 |
|---|---|
| dirty checkout | skip — 즉시 종료 |
| 플래너 태스크 없음 | no-tasks — 정상 종료 |
| 스코어링 > 30 (3회) | abandon — 브랜치 삭제 |
| rebase 충돌 | abort — 브랜치 삭제, 알림 |
| evaluator FAIL | 브랜치 삭제, 알림 |
| 타임아웃 | failure 기록, 다음 실행에서 정리 |
| 비정상 종료 | trap handler → main 복귀, 알림 |
