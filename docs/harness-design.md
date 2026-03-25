# Patina 3-Agent Harness Design

> 참고: [Anthropic — Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps)

## 개요

기존 단일 봇(`bot.sh` → `openclaw agent`)을 **Planner / Generator / Evaluator** 3에이전트 체제로 전환한다.
각 에이전트는 독립 OpenClaw agent로 등록되며, 오케스트레이터 스크립트가 실행 순서와 데이터 전달을 관리한다.

## 목표

1. **Self-evaluation bias 제거** — 생성과 평가를 구조적으로 분리
2. **컨텍스트 격리** — 각 에이전트가 깨끗한 컨텍스트에서 시작
3. **독립 스케줄링** — 역할별 다른 주기/트리거 가능
4. **모델 최적화** — 역할별 최적 모델 선택 가능
5. **멀티 레포 확장** — 다른 레포에도 동일 패턴 적용 가능

---

## 기술 스택

| 구성 요소 | 기술 | 버전 | 역할 |
|---|---|---|---|
| **오케스트레이터** | Bash | 5.1 | harness.sh — 파이프라인 제어, 에이전트 호출, 상태 관리 |
| **에이전트 실행** | OpenClaw CLI | 2026.2.9 | `openclaw agent --agent <id> --message <prompt>` |
| **병렬 실행** (선택) | omx / tmux | 0.11.9 / 3.2a | Generator+Evaluator 병렬 가능 시 활용 |
| **JSON 처리** | Node.js inline | 22.17.1 | `-e` one-liner로 result.json 파싱 (jq 미설치) |
| **Git 관리** | git + gh CLI | 2.4.0 | 브랜치, PR 생성, 이슈 조회 |
| **알림** | OpenClaw message | — | Discord 채널 실시간 보고 |
| **스케줄링** | cron | — | 매 시간 harness.sh 실행 |

### 의존성 원칙
- **새 의존성 없음** — 이미 설치된 것만 사용
- Bash + Node.js inline으로 JSON 처리 (jq/yq 불필요)
- Python3는 bootstrap 스크립트에서만 사용 (기존 유지)

### 통신 방식: 하이브리드

에이전트 간 데이터 전달은 **호출은 OpenClaw, 데이터는 파일** 방식:

```bash
# 오케스트레이터가 에이전트 호출 (OpenClaw 네이티브)
openclaw agent --agent planner \
  --message "분석할 이슈: $ISSUES. 스펙을 $RUN_DIR/spec.md에 작성해라."

# 큰 데이터(spec, diff, review)는 파일로 전달
# 에이전트가 파일 경로를 받아서 읽고, 결과도 파일로 씀

# 결과 판정: result.json
cat $RUN_DIR/result.json
# → { "verdict": "PASS", "score": 22, ... }
```

**이유:**
- 호출/제어: OpenClaw가 세션 관리, 타임아웃, 모델 선택 담당
- 데이터: 파일이라 크기 제한 없음, 디버깅 시 바로 확인 가능
- 실패 복구: artifact가 디스크에 남아있어 수동 재시도 가능

---

## 아키텍처

```
                    ┌──────────────────────┐
                    │   Orchestrator       │
                    │   (harness.sh)       │
                    │   cron 매 시간       │
                    └──────┬───────────────┘
                           │
                    openclaw agent --message
                    (호출은 OpenClaw, 데이터는 파일)
                           │
              ┌────────────┼────────────────┐
              ▼            ▼                ▼
     ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
     │   Planner    │ │  Generator   │ │  Evaluator   │
     │  (patina-    │ │  (patina-    │ │  (patina-    │
     │   planner)   │ │   generator) │ │   evaluator) │
     └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
            │                │                │
            ▼                ▼                ▼
     ┌──────────────────────────────────────────────┐
     │        Shared Artifact Layer (파일)           │
     │   artifacts/harness/{run-id}/                │
     │   ├── spec.md        (Planner → Generator)   │
     │   ├── diff.patch     (Generator → Evaluator) │
     │   ├── review.md      (Evaluator → Generator) │
     │   └── result.json    (최종 상태)              │
     └──────────────────────────────────────────────┘
```

---

## 에이전트 정의

### 1. Planner (`planner`)

**역할:** 이슈 분석 → 작업 스펙(spec) 생성

| 항목 | 값 |
|---|---|
| Agent ID | `planner` |
| Workspace | `/home/devswha/workspace/patina` |
| Model | `cliproxy/claude-opus-4-6` |
| 트리거 | 오케스트레이터가 호출 |
| 타임아웃 | 5분 |

**입력:**
- GitHub 열린 이슈 목록 (JSON)
- 최근 PR 히스토리
- 레포 상태 (브랜치, dirty 여부)

**출력:** `artifacts/harness/{run-id}/spec.md`
```markdown
# Task Spec

## Issue
- Number: #17
- Title: Upgrade Korean patterns #1-24 with fire/exclusion conditions
- Priority: documentation

## Scope
- Files to modify: patterns/ko-content.md, patterns/ko-language.md, ...
- Estimated changes: 24 patterns across 5 packs

## Plan
1. ko-content (#1-6): 발화/제외 조건 추가
2. ko-language (#7-12): 발화/제외 조건 추가
3. ...

## Acceptance Criteria
- 모든 24개 패턴에 발화 조건, 제외 조건 존재
- 기존 패턴 구조(severity, examples) 유지
- ko-structure (#25-28) 형식과 일관성
```

**프롬프트 핵심 지침:**
- 이슈 제목/라벨 우선, body는 필요시만
- 스펙은 구체적이되 구현 세부사항은 Generator에게 위임
- 작업 불가 판단 시 `{ "status": "skip", "reason": "..." }` 반환

---

### 2. Generator (`generator`)

**역할:** 스펙 기반으로 실제 코드/문서 수정, 브랜치 생성

| 항목 | 값 |
|---|---|
| Agent ID | `generator` |
| Workspace | `/home/devswha/workspace/patina` |
| Model | `cliproxy/claude-opus-4-6` |
| 트리거 | 오케스트레이터가 spec.md와 함께 호출 |
| 타임아웃 | 20분 |

**입력:**
- `artifacts/harness/{run-id}/spec.md`
- (재작업 시) `artifacts/harness/{run-id}/review.md`

**출력:**
- `bot/*` 브랜치에 커밋
- `artifacts/harness/{run-id}/diff.patch` (변경 요약)

**프롬프트 핵심 지침:**
- spec.md의 계획을 따르되, 구현 판단은 자율적으로
- 기존 패턴/코드 스타일 준수
- 변경 완료 후 자체 검증 (lint, syntax check 등)
- review.md가 있으면 피드백 반영하여 수정
- 커밋 메시지는 Lore 스타일 + `Co-Authored-By: patina-bot <bot@devswha.dev>`

---

### 3. Evaluator (`evaluator`)

**역할:** Generator의 변경사항을 독립적으로 리뷰 + 스코어링

| 항목 | 값 |
|---|---|
| Agent ID | `evaluator` |
| Workspace | `/home/devswha/workspace/patina` |
| Model | `cliproxy/claude-opus-4-6` |
| 트리거 | 오케스트레이터가 diff.patch와 함께 호출 |
| 타임아웃 | 10분 |

**입력:**
- `artifacts/harness/{run-id}/spec.md` (원래 요구사항)
- `artifacts/harness/{run-id}/diff.patch` (변경 내용)
- Git diff 직접 확인 가능

**출력:** `artifacts/harness/{run-id}/review.md`
```markdown
# Review

## Verdict: PASS | FAIL | REVISE

## Scores (content 변경 시)
- Original: 45/100
- Humanized: 22/100
- Target: <= 30

## Findings
1. [PASS] 모든 24개 패턴에 발화 조건 추가됨
2. [FAIL] ko-language #8: 제외 조건이 너무 광범위
3. [REVISE] ko-style #15: 예시가 부족

## Feedback for Generator
- #8: 제외 조건을 "학술 논문의 인용 맥락"으로 한정할 것
- #15: before/after 예시 1쌍 추가 필요
```

**프롬프트 핵심 지침:**
- **냉정하게 평가** — 기본 성향을 skeptical로 설정
- Generator의 컨텍스트를 전혀 공유하지 않음 (독립 세션)
- content 변경 시 inline ouroboros 스코어링 수행
- 기준 미달이면 구체적 피드백과 함께 REVISE 반환
- 3회 REVISE 후에도 미달이면 FAIL

---

## 오케스트레이터 (`harness.sh`)

기존 `bot.sh`를 대체하는 메인 실행 스크립트.

```
harness.sh 실행 흐름:

1. 사전 점검 (lock, auth, clean main)
2. Planner 호출 → spec.md 생성
   └─ skip이면 종료
3. Generator 호출 (spec.md 전달) → 브랜치 + diff.patch
4. Evaluator 호출 (spec.md + diff.patch) → review.md
   ├─ PASS → PR 생성
   ├─ REVISE → Generator 재호출 (review.md 포함), 최대 3회
   └─ FAIL → 브랜치 삭제, 실패 보고
5. PR 생성 (+ AUTO_MERGE 시 squash merge)
6. Discord 알림, daily log 기록
7. 정리 (lock 해제)
```

### 피드백 루프

```
Generator ←──── review.md ────── Evaluator
    │                                ▲
    └──── diff.patch (v2) ───────────┘
         (최대 3회 반복)
```

---

## 디렉토리 구조 변경

```
scripts/
├── harness.sh                    # 오케스트레이터 (bot.sh 대체)
├── harness-prompts/
│   ├── planner.md                # Planner 에이전트 프롬프트
│   ├── generator.md              # Generator 에이전트 프롬프트
│   └── evaluator.md              # Evaluator 에이전트 프롬프트
├── bot.sh                        # (deprecated, harness.sh로 이관)
├── bot-prompt.md                 # (deprecated, harness-prompts/로 분리)
├── openclaw-bootstrap.sh         # 수정: 3개 에이전트 등록 추가
├── openclaw-component-bridge.mjs # 변경 없음
└── logs/

artifacts/
└── harness/
    └── {run-id}/                 # YYYYMMDD-HHMM 형식
        ├── spec.md
        ├── diff.patch
        ├── review.md
        └── result.json
```

---

## Bootstrap 변경사항

`openclaw-bootstrap.sh`에 3개 에이전트 등록 추가:

```bash
# 기존 patina 에이전트 (대화용) — 변경 없음
# + 신규 3개:
AGENTS=("planner" "generator" "evaluator")
for agent_id in "${AGENTS[@]}"; do
  openclaw agents add "$agent_id" --non-interactive --workspace "$REPO_DIR"
done
```

---

## 모델 전략

| Agent | 모델 | 비고 |
|---|---|---|
| Planner | `cliproxy/claude-opus-4-6` | 전 에이전트 동일 모델 |
| Generator | `cliproxy/claude-opus-4-6` | |
| Evaluator | `cliproxy/claude-opus-4-6` | |

나중에 비용 최적화가 필요하면 Planner를 Sonnet으로 내릴 수 있음.
Evaluator를 다른 provider 모델로 돌려서 diversity를 확보하는 것도 가능.

---

## 멀티 레포 확장 계획

현재는 patina 전용이지만, 구조적으로 레포 독립적:

```
# 다른 레포에 적용할 때:
harness.sh --repo /path/to/other-repo \
           --planner other-planner \
           --generator other-generator \
           --evaluator other-evaluator
```

또는 레포별 설정 파일:
```yaml
# .harness.yaml
planner: planner
generator: generator
evaluator: evaluator
artifact-dir: artifacts/harness
max-revisions: 3
auto-merge: false
```

---

## 마이그레이션 계획

### Phase 1: 기반 구축
1. 에이전트 3개 등록 (bootstrap.sh 수정)
2. 프롬프트 3개 작성 (harness-prompts/)
3. 오케스트레이터 작성 (harness.sh)
4. artifact 디렉토리 구조 생성

### Phase 2: 검증
5. 수동 실행으로 #17 이슈 처리 테스트
6. 피드백 루프 동작 확인
7. 에이전트 간 artifact 전달 확인

### Phase 3: 전환
8. cron을 harness.sh로 교체
9. bot.sh / bot-prompt.md deprecated 처리
10. bot-rules.md / bot-learnings.md 업데이트

### Phase 4: 멀티 레포
11. .harness.yaml 설정 파일 지원
12. 다른 레포에 적용

---

## 리스크 & 완화

| 리스크 | 영향 | 완화 |
|---|---|---|
| 에이전트 간 통신 실패 | 파이프라인 중단 | artifact 파일 기반 (네트워크 불필요), 각 단계 독립 재시도 |
| Evaluator가 너무 관대 | self-eval과 다를 바 없음 | 프롬프트에 skeptical 기본 성향 + few-shot 캘리브레이션 |
| 비용 증가 (3x 에이전트) | 토큰 비용 | Planner에 경량 모델, Generator/Evaluator 타임아웃 제한 |
| 복잡도 증가 | 디버깅 어려움 | artifact 로그로 각 단계 추적 가능, result.json에 전체 상태 기록 |
| 기존 bot.sh와의 호환 | 전환기 혼란 | Phase 2에서 충분히 검증 후 전환, bot.sh는 deprecated 유지 |

---

## 결정 사항 (확정)

- [x] 에이전트 네이밍: `planner` / `generator` / `evaluator`
- [x] 모델: 전 에이전트 Opus (`cliproxy/claude-opus-4-6`)
- [x] 첫 테스트 대상: #17 이슈
- [x] 기술 스택: Bash 기반, 새 의존성 없음
- [x] 통신 방식: 하이브리드 (호출은 OpenClaw, 데이터는 파일)
- [x] 구현: omx 코딩 에이전트에 위임
