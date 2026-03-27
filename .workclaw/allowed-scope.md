# allowed-scope.md — 봇 허용 범위 정의

## 목적
자율 봇(하네스)이 수정할 수 있는 파일/영역과 절대 건드리면 안 되는 영역을 명시한다.
평가자(Evaluator)가 scope 위반을 감지하면 즉시 FAIL 판정한다.

## 허용 범위 (Allowlist)

### 콘텐츠 — 스코어링 게이트 필요
| glob | 설명 |
|---|---|
| `patterns/*.md` | 패턴 팩 (ko-*, en-*) |
| `examples/*.md` | 성공/실패 예시 |
| `profiles/*.md` | 프로필 (voice/pattern override) |
| `core/voice.md` | 문체 가이드라인 |
| `custom/*.md` | 사용자 확장 (gitignore됨) |

### 구조/설정 — 구조 검증만
| glob | 설명 |
|---|---|
| `.patina.default.yaml` | 기본 설정 |
| `README.md` | 프로젝트 문서 |
| `CLAUDE.md` | 에이전트 규칙 |
| `TOOLS.md` | 환경 정보 |
| `AGENTS.md` | 작업 규칙 |
| `USER.md` | Discord 대화 행동 |
| `BOOTSTRAP.md` | 부트스트랩 절차 |

### 버전 동기화 — 5파일 교차 검증 필수
| 파일 | 비고 |
|---|---|
| `SKILL.md` | 메인 오케스트레이터 — **파이프라인 로직 변경 금지** |
| `SKILL-MAX.md` | MAX mode 설계 참고 |
| `patina-max/SKILL.md` | MAX mode 엔트리포인트 |
| `.patina.default.yaml` | 버전 필드만 |
| `README.md` | 버전 배지/텍스트만 |

### 인프라/스크립트 — bash -n 검증
| glob | 설명 |
|---|---|
| `ops/*.sh` | 셸 스크립트 |
| `ops/*.mjs` | Node 스크립트 (node --check) |

### 메모리 — 추가만 허용 (삭제/덮어쓰기 금지)
| glob | 설명 |
|---|---|
| `memory/daily/*.md` | 일일 로그 (append-only) |
| `artifacts/harness/*/` | 하네스 아티팩트 (run별 디렉토리) |

## 금지 영역 (Denylist)

| 경로/패턴 | 이유 |
|---|---|
| `SKILL.md` 파이프라인 로직 | 핵심 처리 흐름 — 명시적 요청 없이 변경 금지 |
| `core/scoring.md` | 스코어링 알고리즘 — 명시적 요청 없이 변경 금지 |
| `.workclaw/*` | 봇 메타 설정 — 사람만 수정 |
| `SOUL.md` | 정체성 — 사람만 수정 |
| `IDENTITY.md` | 정체성 — 사람만 수정 |
| `MEMORY.md` | 메모리 포인터 — 구조 변경 금지 |
| `memory/topics/*.md` | 운영 규칙/교훈 — append만 허용, 기존 내용 수정 금지 |
| `.github/*` | CI/워크플로 — 사람만 수정 |
| `.git/*` | Git 내부 |
| `node_modules/` | 의존성 |

## Scope 위반 처리
1. 평가자가 diff에서 denylist 파일 변경을 감지하면 → **즉시 FAIL**
2. allowlist 외 파일 변경 감지 → **REVISE** (사유 명시)
3. 메모리 파일 기존 내용 삭제/수정 감지 → **FAIL**
