---
pack: ko-viral-hook
type: workflow-round-4
score_only: true
genres: [technical, academic, narrative]
profiles_used: [technical, academic, narrative]
---

# Round 4: 장르 다양화 검증

case-06~08은 SNS 마케팅 장르 단일 도메인이었음. v3.11 + casual-conversation의 효과가 다른 장르에도 일반화되는지, 그리고 patina의 기존 장르 프로필(technical/academic/narrative)이 v3.11 환경에서 정상 동작하는지 검증.

## 실험 셋업

3개 장르 fixture 신규 작성 (각 ~12-15줄, 합성 AI 톤):

| File | Genre | Profile applied |
|---|---|---|
| `examples/genres/technical.md` | 기술 문서 (도구 소개) | `technical` |
| `examples/genres/academic.md` | 학술 초록 (연구 요약) | `academic` |
| `examples/genres/narrative.md` | 1인칭 내러티브 (개인 경험) | `narrative` |

각 fixture에 `--prompt-mode auto --backend codex-cli` + 적합 프로필 적용.

## 점수 결과

| Genre | Baseline | After rewrite | Δ |
|---|---|---|---|
| Technical | 13.8 | **1.4** | **-12.4** ✓✓ |
| Academic | 8.8 | **1.3** | -7.5 ✓ |
| Narrative | 9.0 | **0.0** | **-9.0** ✓✓ |

모든 장르에서 score 7~12점 감소. ±10 분산 안에 일부 들어가지만, 3건 모두 같은 방향으로 움직였으므로 분산 노이즈가 아닌 시스템적 개선.

## 카테고리별 분해

### Technical 13.8 → 1.4

**Baseline 검출**:
- content #1·#6 Medium ("핵심적인 역할", "급격히 변화")
- language #7 High, #8 Medium, #12 Low, #28 Low ("혁신적", "효율적", "체계적", 한자어 다수)
- style #13 Medium, #16 Low, #18 Low (불필요한 연결어, "~하고 있다", 한자어)
- filler #22, #24 Medium, #31 Low ("아울러", "결론적으로", 막연한 결론)
- structure #26 Low (불필요한 추상화)

**Rewrite 검출**: content #5 Low (한 군데에서 모호한 가능성 표현 잔류) — **다른 패턴 모두 제거**.

→ technical 프로필이 한자어·격식 어휘를 적극 순화하면서도 전문 용어(GPU, 클라우드, 인프라)는 보존함.

### Academic 8.8 → 1.3

**Baseline 검출**:
- content #1 Medium, #6 Low ("의의가 크다", "급격히 변화")
- language #7 High, #8 Medium ("혁신적", "체계적", "획기적인 성과")
- style #13 Low, #18 Medium (불필요한 연결어, "본 연구는")
- filler #22 Low ("결론적으로")

**Rewrite 검출**: language 1/6 Low + filler 1/3 Low (한정된 잔재).

→ academic 프로필이 객관적 표현 유지하면서도 inflated 어휘("획기적", "체계적인 성과")를 사실 진술로 풀어냄. Register는 그대로.

### Narrative 9.0 → 0.0

**Baseline 검출**:
- content #1 Medium ("의미 있는 만남")
- language #7 Low, #9 Medium ("혁신적", "단순한 ~을 넘어선")
- filler #23 Medium ("표현할 수 있을 것이다")
- structure #26 Medium (관념적 추상화)
- viral-hook #1 Low ("그토록 오랫동안")

**Rewrite 검출**: 0건. **완전 클린**.

→ narrative 프로필이 1인칭 회상의 자연스러움을 살리면서 추상 표현·관념적 묘사를 구체 디테일로 대체. "형광등은 너무 밝았다", "커피는 식었고" 같은 감각적 디테일 추가.

## Voice 정성 평가

### Technical
**Before** (격식·AI 톤):
> 클라우드 네이티브 환경의 발전과 더불어 GPU 자원 관리의 중요성이 한층 더 부각되고 있는데, 이러한 흐름 속에서 OpenClaw는 핵심적인 역할을 수행하고 있습니다.

**After** (실용 정보 톤):
> AI 인프라 자동화에서 GPU 자원 관리는 배포 속도와 운영 비용에 직접 영향을 준다. OpenClaw는 NVIDIA GPU 자원을 하드웨어 레벨에서 관리하기 위한 오픈소스 도구다.

→ "핵심적인 역할", "한층 더 부각" 같은 inflated 어휘 제거. 평어 `~다` 일관, 사실 진술 위주. 개발자 README/도구 문서 톤.

### Academic
**Before** (격식 학술):
> 향후 AI 개발 환경 표준화 논의에 있어 실증적 근거를 제공하였다는 점에 있다.

**After** (담백 학술):
> 다만 본 연구의 표본은 GitHub 공개 프로젝트에 한정되어 있으므로, 결과를 전체 AI 개발 환경으로 일반화하기에는 주의가 필요하다.

→ "획기적인 성과", "실증적 근거" 같은 학술 클리셰 제거. 한계 명시("표본 한정 → 일반화 주의")로 학술 정직성 강화. Register는 그대로.

### Narrative
**Before** (관념적):
> 마치 오랫동안 닫혀 있던 문이 열리는 듯한 감각이었다고 표현할 수 있을 것이다.

**After** (감각 디테일):
> 사무실에는 나 혼자 남아 있었고, 형광등은 너무 밝았다. AI 인프라를 올리다가 며칠째 같은 자리에서 막혀 있었다. 커피는 식었고, 터미널에는 같은 에러가 또 떠 있었다.

→ 추상적 비유("문이 열리는 감각") → 구체적 장면("형광등은 너무 밝았다", "커피는 식었고"). 1인칭의 진정성 강화.

## 핵심 발견

### 1. 장르 프로필 시스템 검증

patina v3.11 + 기존 장르 프로필(technical/academic/narrative)이 v3.11 변경(self-audit 격리, prompt-mode auto, short-text boost, validate weights, 등)과 **모순 없이 작동**. 회귀 없음.

### 2. 적합 프로필 사용 시 효과 일관

마케팅 장르 (case-03~08)와 비교:
- 마케팅 + casual-conversation: 점수 -3 ~ -9 (long-form), voice 명확 개선
- 기술/학술/내러티브 + 적합 프로필: 점수 -7 ~ -12, voice 장르 적절

**프로필을 장르에 맞게 선택하면 patina v3.11이 모든 주요 장르에서 일관된 효과**.

### 3. Narrative가 가장 큰 voice 변화

기술/학술은 "AI식 격식 어휘만 제거" 수준이지만, narrative는 추상 표현 → 감각 디테일까지 변환. 1인칭 회상의 진정성을 끌어올림. 이는 voice 가이드라인의 `concrete-emotions: amplify` 효과.

### 4. Baseline이 이미 낮으면 -Δ도 작음

Academic baseline 8.8 → 1.3 (-7.5)는 다른 둘보다 작은 폭. 학술 register는 본래 격식적이라 patina의 viral-hook이나 격식체 패턴이 강하게 발화하지 않음. 따라서 개선의 여지가 상대적으로 적음. 이는 한계가 아니라 **장르별 baseline 분포**를 반영.

## 결론

**Round 4 = 명확한 success.** patina v3.11은 마케팅 외 3개 장르(기술/학술/내러티브)에서도 적합 프로필과 결합 시 효과적으로 동작. casual-conversation은 마케팅·SNS 전용으로 유지하고, 기존 장르 프로필이 각 도메인에서 정상 동작함을 확인.

## 누적 워크플로우 진행 상태

```
✅ Round 1 (case-06): patina v3.11 vs Gemini Web 기준선
✅ Round 2 (case-07): casual-conversation voice profile + minimal-prompt 버그 수정
✅ Round 3 (case-08): long-form 검증 — Claude long-form 후퇴 발견
✅ Round 4 (case-09): 3개 장르 검증 — technical/academic/narrative 모두 일관 개선
⬜ Round 5 후보:
   A. --variants 3 + casual-conversation 결합 (voice picker UX)
   B. patina-max 통합 (모델 + prompt-mode 자동 매핑)
   C. 다른 모델(claude/gemini-3) × 3 장르 cross-grid (12 runs)
   D. ko 외 언어(en/zh/ja) 장르 검증
```

## 결과 저장 위치

| File | Score |
|---|---|
| `examples/genres/technical.md` (baseline) | 13.8 |
| `examples/genres/technical-rewritten.md` | **1.4** |
| `examples/genres/academic.md` (baseline) | 8.8 |
| `examples/genres/academic-rewritten.md` | **1.3** |
| `examples/genres/narrative.md` (baseline) | 9.0 |
| `examples/genres/narrative-rewritten.md` | **0.0** |
