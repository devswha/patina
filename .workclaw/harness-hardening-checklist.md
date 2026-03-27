# harness-hardening-checklist.md — 하네스 강화 체크리스트

## 목적
현재 하네스(harness.sh + 3-agent 파이프라인)의 알려진 취약점과 개선 항목을 추적한다.
봇 작업이 아닌 **사람이 판단하고 적용**하는 항목들.

---

## 🔴 Critical — 즉시 대응 권장

### C1. 시크릿 노출 방지
- [ ] harness.sh 로그에 환경 변수 덤프하는 부분 없는지 확인
- [ ] `artifacts/harness/*/` 경로가 `.gitignore`에 포함되어 있는지 확인
- [ ] agent 출력에 토큰/키가 포함되지 않도록 출력 필터링

### C2. 에이전트 프롬프트 인젝션 방어
- [ ] Planner가 이슈 본문을 읽을 때 제목/라벨만 우선 사용 (현재 규칙 준수 확인)
- [ ] Generator가 외부 입력을 코드에 삽입하지 않는지 Evaluator가 검증
- [ ] `allowed-scope.md` denylist 위반 시 FAIL 판정 자동화

### C3. 병렬 실행 방지
- [ ] flock 경로(`/tmp/patina-bot.lock`)가 실제로 동작하는지 검증
- [ ] cron이 겹치는 경우 두 번째 실행이 graceful하게 종료되는지 확인

---

## 🟡 Important — 안정성 향상

### I1. 에러 복구 강화
- [ ] trap handler가 모든 실패 경로(planner/generator/evaluator)에서 main 복귀하는지 확인
- [ ] 고아 브랜치 정리 로직이 로컬+리모트 모두 커버하는지 확인
- [ ] `result.json`이 모든 종료 경로에서 기록되는지 확인

### I2. 타임아웃 세분화
- [ ] 전체 30분 외에 에이전트별 타임아웃(10분) 적용 여부 확인
- [ ] 타임아웃 시 에이전트 프로세스 정리(kill) 확인
- [ ] 타임아웃 원인을 `result.json`에 기록

### I3. 스코어링 신뢰성
- [ ] 스코어링 샘플 텍스트가 변경된 패턴을 실제로 exercise하는지 검증 방법 마련
- [ ] 스코어링 결과를 `review.md`에 포함시켜 추적 가능하게
- [ ] score threshold(30) 적절성 주기적 재평가

### I4. 알림 신뢰성
- [ ] `openclaw message send` 실패 시 fallback 경로 (로그 파일 기록은 현재 있음)
- [ ] 연속 알림 실패 감지 및 에스컬레이션
- [ ] 알림 메시지 포맷 표준화 (run-id, 상태, 소요 시간 포함)

---

## 🟢 Nice-to-have — 점진적 개선

### N1. 관측성(Observability)
- [ ] 실행 히스토리 대시보드 (artifacts/harness/*/result.json 집계)
- [ ] 주간/월간 봇 활동 리포트 자동화
- [ ] 에이전트별 소요 시간 측정 및 기록

### N2. 테스트 격리
- [ ] Generator가 작업하는 동안 worktree 분리 (main 오염 방지)
- [ ] dry-run 모드 추가 (PR 생성 없이 spec → diff → review만 실행)

### N3. 롤백 자동화
- [ ] 머지된 PR이 문제를 일으킨 경우 자동 revert PR 생성
- [ ] revert 조건 정의 (CI 실패, 스코어링 회귀 등)

### N4. 멀티태스크 확장
- [ ] 1시간 1태스크 제약 완화 조건 정의
- [ ] 태스크 큐 구현 (현재는 매 실행마다 이슈 목록 재스캔)

### N5. 에이전트 학습 루프
- [ ] Evaluator REVISE 피드백을 `bot-learnings.md`에 자동 추가
- [ ] 반복되는 REVISE 패턴 감지 및 Generator 프롬프트 개선 제안

---

## 적용 기록

| 날짜 | 항목 | 상태 | 비고 |
|---|---|---|---|
| 2026-03-27 | 초안 작성 | ✅ | `.workclaw/` 구조 신설 |

---

_이 파일은 사람이 관리합니다. 봇이 수정하지 않습니다._
