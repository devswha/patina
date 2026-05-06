---
pack: ko-viral-hook
type: prompt-design-comparison
score_only: true
---

# Viral Hook Case 04: Naive prompt vs structured patina prompt (Gemini)

같은 모델(Gemini)에게 두 가지 다른 방식으로 humanize를 요청했을 때 결과가 얼마나 다른지 비교.
patina의 37KB structured prompt 설계가 모델의 voice prior를 어떻게 제약하는지 드러내는 케이스.

**Source**: 사용자가 Gemini Web UI에서 직접 실험.

---

## 두 접근의 차이

| | Naive prompt (Gemini Web) | Structured patina prompt (CLI) |
|---|---|---|
| 입력 텍스트 | sample.md의 단락 1개만 (~100자) | sample.md 전체 (~600자) |
| 지시어 | "야 이거 ai가 쓴거같은데 사람처럼 만들어줘" | 37KB system-style: 패턴팩, voice, scoring, mode |
| 출력 자유도 | 자유 — 3개 stylistic variant 자체 생성 | 단일 출력 |
| 모델 | Gemini Web (likely gemini-3-pro급) | gemini-2.0-flash / gemini-3-flash-preview |
| 메타 | 톤 비유 + 3 variant + 수정팁 | self-audit phase block |

---

## 입력 (사용자가 Gemini Web에 던진 부탁)

> 야 이거 ai가 쓴거같은데 사람처럼 만들어줘.
>
> [아래 단락 첨부]
> 마케팅 잘해서 뜬 게 아니다. (...) 실전에서 바로 돈이 되는 도구는 대중이 먼저 알아본다.

(원문 단락 전체: `examples/gemini-web/original-paragraph.txt`)

---

## Gemini Web의 자체 진단

> 확실히 AI 특유의 그 '엄근진(엄격·근엄·진지)'한 느낌이 있네요. 마치 성공한 사업가가 강연장에서 팔짱 끼고 "이게 본질입니다"라고 훈수 두는 톤이랄까요?

→ 사용자 직관과 일치하는 voice 진단. 여기서 "엄근진"은 patina의 ko-viral-hook #3(검증 회피 단언) + ko-content #1(과도한 중요성 부여)에 가까운 신호.

---

## Gemini Web의 3개 variant (파일 참조)

세 가지 stylistic variant를 자발적으로 생성:

1. **거친 개발자 커뮤니티 스타일** — `examples/gemini-web/v1-rough.txt`
   도입: "마케팅 빨이라고요? 아닙니다. 이거 써본 개발자들은 알아요. ..."
2. **트렌디 블로그/SNS 스타일** — `examples/gemini-web/v2-blog.txt`
   도입: "마케팅 잘해서 떴다는 말은 솔직히 과소평가죠. ..."
3. **구어체 스타일** — `examples/gemini-web/v3-casual.txt`
   도입: "에이, 이거 마케팅으로 뜬 거 아니에요. ..."

추가로 수정 팁("'무명의 오픈소스' → '이름도 없던'", "'멘탈 나갈 때' 같은 감정 형용사 추가") 까지 제공.

---

## `--score` 비교

| Variant | Score | viral-hook | 메모 |
|---------|-------|------------|------|
| 원문 단락 (sample.md 단락 1/7) | **1.3** | #4 Low, #5 Low | 단락 단독으론 이미 낮음 |
| Gemini Web v1 거친 | **4.2** | #3 Low | "이름도 없던" 검증 회피 잔류 |
| Gemini Web v2 블로그 | **0.0** | none | 가장 낮음 |
| Gemini Web v3 구어체 | **0.0** | none | 가장 낮음 |

참고 (case-03 결과, 35줄 전체 입력):

| Variant | Score |
|---------|-------|
| sample.md 원본 (35줄) | 19.6 |
| Codex rewrite | 16.0 |
| Claude rewrite | 13.1 |
| Gemini 2.0 Flash (patina prompt) | 30.8 |
| Gemini 3 Flash Preview (patina prompt) | 26.1 |

---

## 직접 비교는 불가

| 비교 축 | Naive | Structured |
|---|---|---|
| 입력 길이 | 단락 1개 | 35줄 전체 |
| 의미 폭 | 마케팅 부정문 1개 | 마케팅 hook + CTA + FOMO + 비교계급 |
| 점수 기대값 | viral signal 1~2개 (low) | 5/5 누적 (high) |

→ score 1.3 vs 19.6 차이는 **순수히 입력 길이/누적 신호의 함수**. Gemini Web이 더 잘 humanize했다고 결론 짓기 어려움.

---

## 그럼에도 흥미로운 발견

같은 단락 1개에 대한 voice 차이를 보면:

| | 원문 1.3점 | Gemini Web v3 0.0점 |
|---|---|---|
| 종결어미 | `~다`/`~임` 격식 | `~죠`/`~겠어요?` 친근한 구어 |
| 사람 직관 | "엄근진" / 강연 톤 | 친한 사람이 카페에서 설명하는 톤 |

**점수 차이는 1.3점인데 voice는 명확히 다름**. patina의 score 메트릭이 짧은 텍스트의 register/persona 변화를 충분히 반영하지 못하는 영역이 있음.

---

## patina 발전 시사점

### 1. Short-text scoring 보정

짧은 텍스트(< 200자)에서 viral signal 1~2개만 떠도 voice 차이가 큰 경우 점수가 둔감. ko-language(~다 vs ~죠) 종결어미·register 변화를 더 가중하거나, 짧은 텍스트 전용 scoring path를 검토할 가치.

### 2. Naive prompt 실험 가치

Gemini Web의 결과가 사용자 직관에 더 가까웠다는 점에서, patina의 37KB structured prompt 설계가 모델을 *분석가 모드*로 끌고 들어가서 자연스러운 voice 생성을 막고 있을 가능성. 후속 실험 후보:
- patina와 같은 패턴 정보를 담되 "친구처럼 다듬어줘" 톤의 메타 instruction
- 자유로운 N-variant 생성 후 score-best 선택

### 3. 변형 옵션 노출

Gemini Web이 자발적으로 3개 stylistic variant를 만든 건 사용자에게 선택권을 줌. patina에 `--variants 3` 같은 옵션을 추가해 톤별 candidate를 한 번에 보여주는 path.

### 4. 출처: 모델 voice prior는 강하다

`gemini-3-flash-preview`(CLI)와 `gemini-3-pro급`(Web)의 voice 차이는 같은 시리즈 내에서도 크게 다름. Pro 계열에 접근하면 이번 case-03 결과가 다시 바뀔 가능성 — Code Assist OAuth 한계로 직접 검증 불가.

---

## 결과 저장 위치

- `examples/gemini-web/original-paragraph.txt` — 원문 단락 (사용자가 Gemini Web에 던진 입력)
- `examples/gemini-web/v1-rough.txt` — Gemini Web 변형 1 (거친 개발자)
- `examples/gemini-web/v2-blog.txt` — Gemini Web 변형 2 (블로그/SNS)
- `examples/gemini-web/v3-casual.txt` — Gemini Web 변형 3 (구어체)

각 파일에 verbatim 결과 보존.
