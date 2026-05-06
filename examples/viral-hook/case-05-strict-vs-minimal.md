---
pack: ko-viral-hook
type: prompt-mode-ab
score_only: true
v3_11_feature: --prompt-mode
---

# Viral Hook Case 05: Strict vs Minimal prompt A/B (3 models)

case-04에서 세운 가설("naive prompt가 모델 voice를 더 자유롭게 풀어준다") 검증.
v3.11에 추가한 `--prompt-mode <strict|minimal>` 플래그로 같은 입력·같은 모델에서 두 prompt 모드를 비교했다.

## 실험 셋업

- **입력**: `examples/sample.md` (35줄, AI 인플루언서 마케팅 포스트)
- **공통**: `[BODY]/[/BODY]` 격리 (v3.11 self-audit 분리)
- **strict** (기본): 34141자 — 패턴 정의 + 예시 + voice + scoring 전체
- **minimal**: 2941자 — 패턴별 "주의 어휘"만 추출 + 친근한 한국어 한 문단 instruction
- 압축 비율: 91.4% 감소 (34141 → 2941자)

## 실험 결과

| Model | Strict (case-03) | Minimal (case-05) | Δ Overall | Strict viral-hook raw | Minimal viral-hook raw |
|---|---|---|---|---|---|
| Codex GPT-5.5 | 16.0 | **15.2** | **-0.8** (노이즈 안) | 60.0 | 73.3 |
| Claude Sonnet 4.6 | **13.1** | 27.0 | **+13.9** ⚠ | 53.3 | 86.7 |
| Gemini 3 Flash Preview | 26.1 | **16.9** | **-9.2** ✓ | 80.0 | 73.3 |

±10 LLM 분산을 고려하면:
- **Codex**: 분산 안. 영향 거의 없음.
- **Claude**: 분산 밖. minimal이 명확히 *나쁨*.
- **Gemini 3**: 분산 경계. minimal이 *확실히 나음*.

## 해석

### 가설은 부분만 맞았다

case-04에서 세운 가설은 "naive prompt가 모델의 voice prior를 자유롭게 풀어줘서 더 자연스러운 결과를 낸다"였다. 결과:

- **Gemini 3에서 가설 성립**: 26.1 → 16.9. structured prompt가 모델을 분석가 모드로 끌고 들어가 self-audit meta(이젠 분리됐지만 잔재)와 격식 어휘를 유발했음. minimal에서 voice가 풀림.
- **Claude에서 가설 기각**: 13.1 → 27.0. Claude는 strict prompt에서 패턴 정의·예시·voice 가이드를 충실히 활용해 가장 적극적인 humanize를 수행했음. minimal에서 정보 손실 → viral 신호 잔류.
- **Codex에서 중립**: ~같음. Codex는 어느 쪽이든 표면 어휘 치환에 머무름. prompt design이 voice 변화를 끌어내지 못함.

### 모델별 prompt 친화성이 다르다

| 모델 | Strict 강점 | Minimal 강점 |
|---|---|---|
| Codex GPT-5.5 | 거의 같음 | 거의 같음 |
| Claude Sonnet 4.6 | **패턴·예시 기반 적극 재진술** | (활용 못함) |
| Gemini 3 Flash | (분석가 모드로 경직) | **자연스러운 voice 풀림** |

**Claude는 instruction-rich**: 패턴 정의를 받으면 그것을 실제로 패턴 매칭해서 적용. Strict가 도구로 작용.
**Gemini는 voice-rich**: 자기 voice prior가 강해서 instruction을 줄일수록 자연스러움.
**Codex는 둘 다 비슷**: 어느 쪽이든 *같은 보수적 톤*으로 수렴.

### 압축의 부작용

minimal에서 viral-hook raw가 거의 모든 모델에서 *증가*한 점이 흥미롭다:

| Model | Strict viral-hook raw | Minimal viral-hook raw |
|---|---|---|
| Codex | 60.0 | 73.3 (+13.3) |
| Claude | 53.3 | 86.7 (+33.4) |
| Gemini 3 | 80.0 | 73.3 (-6.7) |

→ minimal에는 viral-hook 패턴 정의가 없어서 (score-only 격리) 모델이 viral hook을 적극적으로 줄이지 않음. 다만 viral-hook은 본래 rewrite 대상이 아니므로 (score-only 격리 정책) 이 자체는 의도된 동작이지만, **strict 모드가 다른 카테고리 humanize 과정에서 우연히 viral 신호도 일부 감소시켰던 것**으로 보인다.

## 결론

**하나의 정답은 없다. 모델별로 prompt-mode를 매칭해야 한다.**

| 추천 prompt-mode | 모델 |
|---|---|
| `strict` (기본) | Claude — 패턴·예시 기반 instruction 적극 활용 |
| `minimal` | Gemini (2.x, 3.x flash 계열) — voice prior 자유롭게 |
| 동등 | Codex — 어느 쪽이든 결과 비슷 |

## 다음 단계 제안 (Phase 3 영향)

이 결과는 roadmap의 **Phase 3.3 모델별 voice profile** 우선순위를 끌어올린다:

1. **Backend 자동 감지 + prompt-mode 자동 선택**:
   - `--backend codex-cli` → strict (또는 둘 다 OK)
   - `--backend claude` 또는 claude API → strict
   - `--backend gemini` → minimal 권장
2. **새 옵션 `--prompt-mode auto`**: backend별 휴리스틱으로 자동 선택
3. **patina-max에서 모델별 prompt-mode 적용**: 각 모델에 가장 잘 맞는 prompt를 보내서 best-of-N 품질 향상

## 한계

- **표본 1개**: 마케팅 글 한 편만. 다른 장르(기술 문서, 학술, 내러티브)는 다른 결과 가능.
- **점수 1회 측정**: ±10 분산 안에서 13.9 차이는 통계적으로 의미 있지만 n회 평균이 더 안전.
- **Claude 결과 추가 검증 필요**: minimal이 27.0으로 *대폭* 올라간 이유가 prompt-mode 자체인지, 압축 과정에서 빠진 핵심 instruction이 있는지 분리 검증 필요.

## 결과 저장 위치

| File | Description |
|---|---|
| `examples/sample-rewritten-codex-minimal.md` | Codex minimal mode rewrite |
| `examples/sample-rewritten-claude-minimal.md` | Claude minimal mode rewrite |
| `examples/sample-rewritten-gemini-3-minimal.md` | Gemini 3 minimal mode rewrite |

case-03 저장된 strict mode rewrites와 1:1 비교 가능.
