---
pack: ko-viral-hook
type: workflow-round-1
score_only: true
v3_11_features: ['--prompt-mode auto', 'short-text boost', 'self-audit isolation']
---

# Round 1: patina v3.11 vs Gemini Web baseline (single paragraph)

Iterative improvement workflow의 첫 라운드.
같은 4줄 단락을 patina v3.11 (auto prompt-mode, 3 backends) 과 사용자가 Gemini Web에 던진 캐주얼 부탁으로 각각 처리하고, 점수 + voice를 정직하게 비교한다.

## 입력

`examples/gemini-web/original-paragraph.txt` — sample.md 두 번째 단락 4줄.

## 점수 비교 표

| Variant | Score | viral-hook | 메모 |
|---|---|---|---|
| 원문 (`original-paragraph.txt`) | 1.3 | #4 #5 Low | baseline |
| Gemini Web v1 (rough dev) | 4.2 | #3 Low | "이름도 없던" 검증 회피 잔류 |
| Gemini Web v2 (blog/SNS) | **0.0** | none | 가장 낮음 |
| Gemini Web v3 (casual) | **0.0** | none | 가장 낮음 |
| **patina codex (auto)** | **0.0** | none | 동등 ✓ |
| patina claude (auto) | 2.0 | #4 short-text boost | 단문 4개 → boost 활성 |
| patina gemini-3 (auto) | 4.2 | 1/5 | viral 1개 잔류 |

## 핵심 발견

**patina v3.11이 Gemini Web과 정상적으로 경쟁 가능한 수준에 도달했다.** Codex backend로 v3.11 auto mode를 쓰면 0.0점 (Gemini Web v2/v3과 동일). 이전 case-04에서는 입력 길이가 달라서 비교가 무의미했는데, 이번 라운드는 같은 단락 1:1 비교라 결과가 의미를 가진다.

### v3.11 기여 요소 분리

각 v3.11 기능이 어떻게 기여했나:

1. **`--prompt-mode auto`**: codex/claude는 strict, gemini는 minimal — case-05의 모델별 친화성 매핑이 적용됨
2. **Self-audit 격리**: 메타가 본문에서 분리되어 점수에 반영되지 않음 — case-03 Gemini 3 +6.5 inflation 제거됨
3. **Short-text boost**: Claude rewrite의 4줄 단문 배치(viral-hook #4)가 Medium에서 High로 boost되어 단문 배열의 voice 충실도가 점수에 더 정확히 반영됨 — 이전엔 0점에 머물러 있던 신호 발견

## Voice 정성 평가

각 patina 결과를 Gemini Web v3 (casual) 와 voice 비교:

### patina codex (auto, score 0.0)
> 마케팅으로 뜬 게 아니다. 개발자들이 새벽 3시에 버그 잡다가 머리 쥐어뜯을 때 느끼던 그 가려운 지점을 정확히 긁어줬기 때문이다. NVIDIA가 이 무명 오픈소스와 손잡은 것도 우연이 아니다. 실전에서 바로 돈이 되는 도구는 보통 현장이 먼저 알아본다.

특징: 평어 `~다` 일관, "현장이 먼저 알아본다" 구체화. **뉴스 기사 톤**.

### patina claude (auto, score 2.0)
> 마케팅 잘해서 뜬 게 아니다. / 개발자들이 새벽 3시에 버그 잡다 머리 쥐어뜯던 그 '가려운 곳' — 거기를 정확히 긁어준 거임. / NVIDIA가 이 무명 오픈소스랑 손잡은 것도 그래서다. / 실전에서 돈 되는 도구는, 대중이 먼저 안다.

특징: 평어 + `~준 거임` 구어 어미, 대시(—)로 호흡 부여, "안다"로 짧은 끝맺음. **블로그 댓글 톤**.

### patina gemini-3 (auto, score 4.2)
> 마케팅을 잘해서 뜬 게 아닙니다. 새벽 3시에 버그를 잡다 머리 쥐어뜯던 개발자들의 그 '가려운 곳'을 제대로 긁어줬기 때문이죠. 엔비디아가 이 이름 없는 오픈소스와 손을 잡은 건 결코 우연이 아닙니다. 실전에서 바로 돈이 되는 도구는 사람들이 먼저 알아보게 되어 있습니다.

특징: 격식 `~습니다`/`~죠` 회귀(2.0의 격식체 편향이 일부 살아남). **뉴스레터 톤**.

### Gemini Web v3 (casual, score 0.0)
> 에이, 이거 마케팅으로 뜬 거 아니에요. 개발자들이 새벽까지 버그랑 씨름하다가 '아, 진짜 이런 거 하나 있으면 좋겠다' 싶었던 걸 정확히 파고든 거죠. 엔비디아가 괜히 이 무명 오픈소스를 픽했겠어요? 실무에서 바로 써먹고 결과 뽑아낼 수 있는 도구는, 가르쳐주지 않아도 사람들이 먼저 알아보고 줄 서기 마련이에요.

특징: 친한 사이에 말하듯 "에이~", "픽했겠어요?" 같은 구어 표현. **카페 대화 톤**.

## Voice 친밀도 랭킹 (사람이 카페에서 친구에게 말하는 톤에 가까운 순)

1. **Gemini Web v3** — "에이~", "~겠어요?" 친한 대화체
2. **patina claude (auto)** — `~준 거임`, 대시 호흡
3. **Gemini Web v2** — 블로그 톤
4. **patina codex (auto)** — 뉴스 평어 톤
5. **patina gemini-3 (auto)** — 격식체 잔재

## Gap: 점수 0이지만 voice 다름

**Codex 0.0 = Gemini Web v3 0.0** 인데도 voice 친밀도는 명확히 다름. patina --score는 "AI 신호"를 잘 잡지만 **"친밀도/persona"는 측정하지 않음**. 이게 다음 개선의 단서.

## 개선 제안 (Round 2 후보)

### Proposal A: Persona/intimacy 카테고리 추가

`ko-viral-hook`과 별개로 **`ko-persona`** 신규 score-only 카테고리:
- 격식 회귀 (`~습니다`/`~죠` 빈도)
- 1인칭 부재 ("내가", "제가" 등이 한 번도 없음)
- 화자-청자 거리 감각 (대화 호명 없음)

이 신호가 강하면 "친밀도 부족" → 점수 +5 정도 가산 (또는 별도 메트릭 노출).

### Proposal B: Voice profile prompt injection

`profiles/_voice/<intimacy>.md` — `casual-conversation` 프로필 신설:
- "친구에게 카페에서 말하듯 써. ~죠/~네/~겠어요? 같은 친근 종결어미를 활용해."
- `--profile casual-conversation` 또는 `--tone casual` + 새 voice profile

Codex/Claude의 평어 톤 vs Gemini Web v3의 친한 대화체 갭을 prompt 단에서 좁힘.

### Proposal C: Multi-judge scoring

같은 결과를 codex/claude/gemini가 각각 점수화 → 평균. 단일 모델 편향 감소.

### 우선순위

1. **B (voice profile)** — 작업 작고 직접 voice gap 해결
2. **A (persona category)** — 점수 둔감성 보강하지만 calibration 필요
3. **C (multi-judge)** — 비용 큼

## Round 2 후보 입력

다음 라운드 입력 후보:
- 기술 문서 (AI tool overview)
- 학술 초록 (영어 또는 한국어)
- 내러티브 (개인 경험담)
- 더 긴 마케팅 글 (sample.md 외)

사용자가 선택한 입력으로 Round 2 진행.

## 결과 저장 위치

- `examples/round1-codex.txt` — codex auto rewrite (score 0.0)
- `examples/round1-claude.txt` — claude auto rewrite (score 2.0)
- `examples/round1-gemini-3.txt` — gemini-3 auto rewrite (score 4.2)
- `examples/gemini-web/v1-rough.txt`, `v2-blog.txt`, `v3-casual.txt` — Gemini Web 기준선
