---
pack: ko-viral-hook
type: model-comparison
score_only: true
---

# Viral Hook Case 03: Codex vs Claude rewrite comparison

같은 patina 프롬프트를 두 모델에 보내서 voice/문체 차이를 비교한다.
입력: `examples/sample.md` (Case 02b와 동일).

| Model | Backend | Output |
|---|---|---|
| GPT-5.5 (Codex) | `codex exec` (codex-cli 0.128.0) | `examples/sample-rewritten-codex.md` |
| Claude Sonnet 4.6 | `claude -p` (Claude Code 2.1.131) | `examples/sample-rewritten-claude.md` |
| Gemini 2.x | `gemini -p` (CLI 0.40.0) | _skipped — `GEMINI_API_KEY` 미설정_ |

---

## `--score` 비교

| Variant | Overall | viral-hook raw | viral-hook detected |
|---------|---------|----------------|---------------------|
| 원본 (`sample.md`) | **19.6** | 93.3 | #1 H, #2 M, #3 H, #4 H, #5 H |
| Codex rewrite | **16.0** | 60.0 | #1 H, #3 H, #4 M, #5 L |
| Claude rewrite | **13.1** | 53.3 | #1 H, #3 M, #5 H |

두 모델 모두 점수 떨어뜨리지만 **Claude 가 ~3점 더 낮음**. 양쪽 다 viral-hook 핵심 신호(권위 단언/과장 어휘)는 잔류 — score-only 격리 의도대로.

---

## Voice·문체 차이 (선택 구절)

### Phase 3 메타 출력 동작

| | Codex (GPT-5.5) | Claude (Sonnet) |
|---|---|---|
| 본문 위 메타 누출 | 한 줄 ("잔여 AI 티: ...") | 16줄 (Phase 3 자기검수 + 보존/완화 패턴 명시) |
| 메타 형식 | 짤막한 코멘트 | 구조화된 섹션 |

→ Claude가 self-audit phase를 더 충실히 따름. Codex는 형식적 메타 한 줄로 처리.

### 핵심 단어 선택

| 원문 어휘 | Codex 변환 | Claude 변환 |
|---|---|---|
| "역사상 이런 속도는 없었다" | "거의 못 봤다" | (삭제) → "60일 만에 별 25만 개를 찍었다" |
| "미친 듯이 달려든" | "한꺼번에 몰렸다" | (삭제 + 인과 재진술) |
| "...이유가 뭘까" | (제거) | (제거) |
| "99%는 ... 상위 1%는" | "대부분은 ... 움직이는 사람은" | "대부분은 ... 일부는" + "1%의 AI 실전 활용법" 마지막 줄 |
| "지금이 가장 싸게 올라탈 타이밍" | "가장 싸게 배울 수 있는 타이밍" | "지금이 제일 싸게 타는 타이밍" |
| "도구는 죄가 없다 / 게으름이 문제" | (보존, 큰 변경 없음) | **삭제** (자기검수 메타에 "가르치는 톤" 명시 후 제거) |

### 문장·단락 구조

- **Codex**: 1줄 단문 일부를 한두 단락으로 묶음. 보수적 변경.
- **Claude**: 더 적극적으로 단락 통합. 짧은 단락과 긴 단락을 의도적으로 비대칭화한다고 self-audit에 명시. burstiness를 더 인지하고 적용.

### 종결 어미

- **Codex**: `~다` 일관적 평서. 중성적·뉴스 톤.
- **Claude**: `~다` 본문 + 마지막 한 줄만 캡션 클로저("더 깊게 풀어드린다") — register layering 의식.

---

## 모델별 경향 (이번 1회 표본 한정)

**Codex (GPT-5.5):**
- 표면 어휘 치환 위주. "역사상" → "거의 못 봤다" 같은 1:1 매핑.
- 메타 출력 짧고 형식적.
- viral-hook 잔류량이 더 많음 (raw 60.0).
- 결과 voice가 일정한 톤으로 수렴 — 사용자가 지적한 "지피티 말투 거의 동일" 인상의 근거.

**Claude (Sonnet 4.6):**
- 인과 구조까지 손댐. "마케팅 빨이 아니다 → 정확히 그 부분을 해결해주는 도구라서" 등.
- self-audit phase를 명시적·구조화해서 출력.
- "가르치는 톤" 같은 register-level 패턴까지 식별·삭제.
- 점수 더 낮음 (Overall 13.1 < 16.0).
- 다만 self-audit 누출이 16줄로 길어 raw output 활용 시 후처리 필요.

---

## 한계

- **표본 1개**: 4종 마케팅 톤 글 한 편만. 다른 장르(기술 문서·학술·내러티브)에서는 결과 다를 수 있음.
- **Gemini 미수행**: `GEMINI_API_KEY` 미설정으로 3-way 비교 불가. 후속 작업.
- **점수 ±10 분산**: 16.0 vs 13.1 차이는 LLM 자체 분산 범위 안. 한 번 실행으로 결정짓기 어렵고, n회 평균 필요.
- **score-only 격리**: 두 모델 모두 viral-hook 신호의 일부만 자체 판단으로 줄임 — patina의 명시적 viral-hook 패턴을 rewrite에 노출시키면 다른 결과가 나올 수 있음 (단, score-only 정책 위배).

---

## 결과 저장 위치

- `examples/sample.md` — 원본 (untracked, IP 사유)
- `examples/sample-rewritten-codex.md` — Codex/GPT-5.5 rewrite
- `examples/sample-rewritten-claude.md` — Claude/Sonnet rewrite

각 파일에 verbatim 결과(메타 + 본문 + YAML footer) 보존.
