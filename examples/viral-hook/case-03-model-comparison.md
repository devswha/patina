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
| Gemini 2.0 Flash | `gemini -p` (CLI 0.40.0, oauth default) | `examples/sample-rewritten-gemini.md` |
| Gemini 3 Flash Preview | `gemini -m gemini-3-flash-preview -p` (CLI 0.41.1) | `examples/sample-rewritten-gemini-3.md` |

---

## `--score` 비교

| Variant | Overall | viral-hook raw | viral-hook detected |
|---------|---------|----------------|---------------------|
| 원본 (`sample.md`) | **19.6** | 93.3 | #1 H, #2 M, #3 H, #4 H, #5 H |
| Codex rewrite | **16.0** | 60.0 | #1 H, #3 H, #4 M, #5 L |
| Claude rewrite | **13.1** | 53.3 | #1 H, #3 M, #5 H |
| Gemini 2.0 Flash | **30.8** | 73.3 | #1 H, #2 M, #3 H, #5 H |
| **Gemini 3 Flash Preview** | **26.1** | **80.0** | #1 H, #2 L, #3 H, #4 M, #5 H |

핵심 관찰:
- **Codex/Claude는 점수를 낮춤** (-3.6 / -6.5)
- **두 Gemini는 모두 점수를 올림** (+11.2 / +6.5)
- Gemini 3가 2.0보다는 낮지만 여전히 원본보다 높음 — register는 평어체로 회귀했으나 self-audit meta가 점수에 잡힘 (다음 섹션 참조)
- 네 모델 모두 viral-hook 핵심 신호(권위 단언/과장 어휘)는 잔류 — score-only 격리 의도대로.

---

## Voice·문체 차이 (선택 구절)

### Phase 3 메타 출력 동작

| | Codex (GPT-5.5) | Claude (Sonnet) | Gemini 2.0 Flash | Gemini 3 Flash Preview |
|---|---|---|---|---|
| 본문 위 메타 | 한 줄 ("잔여 AI 티: ...") | 16줄 자기검수 (보존/완화 패턴 명시) | 5개 "AI Tells" 번호 리스트 | 5개 bullet (패턴별 처리 명시) |
| 메타 형식 | 짤막한 코멘트 | 구조화된 섹션 (선언적) | 패턴별 분석 (해설형) | 짧은 bullet (수정 항목별) |

→ Claude는 self-audit을 가장 충실히. Gemini 2/3는 둘 다 패턴별 처리 명시 — 분석 톤. Codex는 형식적 한 줄.

### 핵심 단어 선택

| 원문 어휘 | Codex | Claude | Gemini 2.0 | Gemini 3 |
|---|---|---|---|---|
| "역사상 이런 속도는 없었다" | "거의 못 봤다" | (삭제 후 사실 진술) | "전례 없는 속도입니다" | (삭제, 평이한 사실 진술) |
| "미친 듯이 달려든" | "한꺼번에 몰렸다" | (삭제 + 인과 재진술) | "왜 이렇게 열광할까요?" | "왜 이렇게 열광하는 걸까?" (평어 질문) |
| "...이유가 뭘까" | (제거) | (제거) | **유지** (격식형 변환) | **유지** (평어형 변환) |
| "99%는 ... 상위 1%는" | "대부분은 ... 움직이는 사람은" | "대부분은 ... 일부는" | "대다수는 ... 감이 빠른 사람들은" | "대부분은 ... 감이 빠른 사람들은" |
| "가장 싸게 올라탈 타이밍" | "가장 싸게 배울 수 있는 타이밍" | "제일 싸게 타는 타이밍" | "가장 좋은 기회입니다" | "가장 좋은 타이밍이다" |
| "도구는 죄가 없다 / 게으름이 문제" | (큰 변경 없음) | **삭제** | "결국 실행력 차이일 뿐이죠" | "도구가 좋아도 안 쓰면 의미 없다" (순화) |

### 종결 어미·register

- **Codex**: `~다` 일관적 평서. 중성·뉴스 톤.
- **Claude**: `~다` 본문 + 마지막만 캡션 클로저 — register layering 의식.
- **Gemini 2.0 Flash**: **`~습니다`/`~죠`/`~까요?` 격식체** 일관 — 한국어 textbook formal 톤.
- **Gemini 3 Flash Preview**: **`~다` 평어체로 회귀** — Codex/Claude와 같은 register. 2.0의 격식체 편향이 3에서 사라짐.

### 문장·단락 구조

- **Codex**: 1줄 단문 일부 묶음. 보수적.
- **Claude**: 적극 통합 + burstiness 의식 (self-audit에 명시).
- **Gemini 2.0**: 단락은 보존, 호흡 단문 → 격식 만연체로 변환.
- **Gemini 3**: Claude/Codex와 유사한 통합 패턴, 단문/장문 섞기. 마케팅 hook은 일부 보존 ("판이 바뀌고 있다", "가장 좋은 타이밍").

---

## 모델별 경향 (이번 1회 표본 한정)

**Codex (GPT-5.5):**
- 표면 어휘 치환 위주. "역사상" → "거의 못 봤다" 같은 1:1 매핑.
- 메타 출력 짧고 형식적.
- viral-hook 잔류량이 중간 (raw 60.0).
- Voice가 일정한 평서·뉴스 톤으로 수렴 — 사용자가 지적한 "지피티 말투 거의 동일" 인상의 근거.
- **Score: 16.0** (원본 19.6 대비 -3.6)

**Claude (Sonnet 4.6):**
- 인과 구조까지 재진술. "마케팅 빨이 아니다 → 정확히 그 부분을 해결해주는 도구라서".
- self-audit phase를 명시·구조화해서 출력 (16줄).
- "가르치는 톤" 같은 register-level 패턴까지 식별·삭제.
- viral-hook 잔류량 가장 적음 (raw 53.3).
- self-audit 누출이 길어 raw output 활용 시 후처리 필요.
- **Score: 13.1** (원본 19.6 대비 -6.5, 가장 큰 감소)

**Gemini 2.0 Flash (Code Assist OAuth 기본):**
- 패턴 탐지 목록을 본문 앞에 번호로 명시 — 분석가형 톤.
- 본문 register를 **`~습니다` 격식체**로 통일 — Codex/Claude의 평서체와 가장 큰 갈림길.
- viral-hook의 일부(미스터리 질문)를 형태만 바꿔 유지 (`이유가 뭘까` → `왜 이렇게 열광할까요?`).
- 마케팅 강도(권위 단언, 1%/대다수 프레이밍)는 격식체로 옷만 갈아입은 채 남음.
- **Score: 30.8** (원본 19.6 대비 **+11.2 증가**)

**Gemini 3 Flash Preview:**
- 2.0의 격식체 편향에서 **평어체(`~다`)로 회귀** — Codex/Claude와 같은 register.
- 본문 위 self-audit 메타가 더 짧고 정돈됨 (5개 bullet).
- 핵심 viral 어휘들을 평어체로 자연스럽게 풀어냄: "전례 없는 속도입니다" → 평이한 사실 진술, "왜 이렇게 열광할까요?" → "왜 이렇게 열광하는 걸까?"
- 그러나 일부 viral hook ("판이 바뀌고 있다", "가장 좋은 타이밍이다") 잔류 + meta block 자체가 점수에 잡힘.
- **Score: 26.1** (원본 19.6 대비 **+6.5 증가**, 2.0보다는 낮지만 여전히 원본보다 높음)
- 본문 register는 좋아졌지만 self-audit meta 출력이 score 끌어올림 — meta를 stripping하면 점수 더 떨어질 가능성.

## Gemini가 점수를 더 높인 이유

Codex/Claude가 "마케팅 톤 → 정보 전달 톤"으로 register를 낮춘 반면, Gemini는 **"viral 마케팅 톤 → 격식 마케팅 톤"** 으로 register를 *바꾸지 않고 한 단계 위로 끌어올림*. 결과:

1. **격식체 자체가 AI 패턴 신호**: ko-content의 만연체·격식 종결어미는 patina의 기존 28개 패턴이 적극 잡는 영역. Gemini의 `~습니다`/`~까요?` 종결이 이쪽 카테고리를 새로 활성화.
2. **viral-hook 일부 보존**: 권위 단언("전례 없는 속도입니다"), 미스터리 질문("왜 이렇게 열광할까요?"), 1% 프레이밍 모두 격식체 옷을 입혔을 뿐 의미적으로 유지.
3. **호흡 단문 → 만연체 변환**: viral-hook #4(호흡 최적화 단문)는 줄였지만 그 자리를 ko-content/style 만연체가 차지.

→ patina 점수상으로는 "AI 같음"이 오히려 증가. 사람 직관으로 보면 마케팅 임팩트는 약해졌지만 "AI가 정중하게 다듬은 글" 인상이 더 강해짐.

이 결과는 **patina의 score 메트릭이 viral-hook과 격식 AI 패턴 둘 다를 한 축에 묶어 측정한다는 점**을 드러냄. 어느 한 쪽만 줄이고 다른 쪽이 늘면 점수가 올라갈 수 있음. score를 단일 지표가 아니라 **카테고리별 raw breakdown**으로 보는 게 더 정확.

---

## 한계

- **표본 1개**: 마케팅 글 한 편만. 다른 장르(기술 문서·학술·내러티브)에서는 결과 다를 수 있음.
- **점수 ±10 분산**: 13.1 vs 16.0 차이는 LLM 자체 분산 범위 안. 30.8과 13.1 차이(~17점)는 분산 밖이라 의미 있는 차이로 볼 수 있지만 n회 평균이 더 정확.
- **score-only 격리**: 세 모델 모두 viral-hook 신호의 일부만 자체 판단으로 줄임 — patina의 명시적 viral-hook 패턴을 rewrite에 노출시키면 결과 달라질 수 있음 (단, score-only 정책 위배).
- **Gemini 격식체 편향**: 한국어 출력 기본 스타일이 `~습니다` 격식체로 강하게 수렴하는 경향. 다른 register를 원하면 명시적 voice override 필요.
- **scoring 모델 일관성**: --score는 codex-cli 단일 모델로만 측정. 점수 자체에 모델 편향이 있을 수 있음 (예: codex가 본인 출력에 관대하거나 엄격할 가능성).

---

## 결과 저장 위치

- `examples/sample.md` — 원본 (untracked, IP 사유)
- `examples/sample-rewritten-codex.md` — Codex/GPT-5.5 rewrite
- `examples/sample-rewritten-claude.md` — Claude/Sonnet rewrite
- `examples/sample-rewritten-gemini.md` — Gemini 2.0 Flash rewrite
- `examples/sample-rewritten-gemini-3.md` — Gemini 3 Flash Preview rewrite

각 파일에 verbatim 결과(메타 + 본문 + YAML footer) 보존.
