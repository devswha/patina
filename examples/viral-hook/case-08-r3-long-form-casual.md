---
pack: ko-viral-hook
type: workflow-round-3
score_only: true
profile_used: casual-conversation
---

# Round 3: long-form casual-conversation (sample.md 35줄)

Round 2의 voice profile 효과가 단락 1개를 넘어 긴 글에서도 유지되는지 검증.
같은 35줄 sample.md에 `--profile casual-conversation --prompt-mode auto` 적용.

## R1 → R3 점수 추이 (case-03 baseline 대비)

| Backend | R1 (default profile) | R3 (casual-conversation) | Δ | 평가 |
|---|---|---|---|---|
| Codex | 16.0 | **13.0** | **-3.0** | ✓ 개선 |
| Claude | **13.1** | 17.6 | +4.5 | ⚠ 약간 후퇴 |
| Gemini-3 | 26.1 | **17.1** | **-9.0** | ✓✓ 큰 개선 |

±10 분산을 고려하면 Codex와 Claude는 노이즈 안, Gemini-3만 의미 있는 개선. 하지만 voice 측면에서는 R2에서 이미 검증된 패턴이 그대로 유지됨.

## 카테고리별 분해

### Codex R3 (13.0)
- content #1·#2·#4: Medium~Low → "역사상", "전 세계", "표준" 같은 절대 단언이 R1보다 줄어들었지만 여전히 일부 잔류
- viral-hook raw 73.3: short-text boost가 35줄에선 비활성, 일반 long-text formula 적용

### Claude R3 (17.6, R1 13.1보다 약간 ↑)
- content #1 High + #4 Medium: casual 어휘 ("에이/솔직히/~잖아요?")가 viral-hook과 *content* 카테고리 양쪽에서 더 강하게 잡힘
- viral-hook raw 80.0: 단문 배치(#4)가 친근한 분위기로도 유지되어 High severity
- → **Claude가 친근체로 풀어쓰면서 viral-hook 신호가 오히려 더 명확히 표면화**

### Gemini-3 R3 (17.1, R1 26.1에서 -9.0)
- content #1 Medium만 잔류, language 카테고리 #30 Medium (수사적 질문은 보존됨)
- viral-hook raw 80.0: 핵심 신호는 그대로지만 격식체→친근체 전환으로 인한 ko-language 격식 패턴이 사라짐
- → **격식체 잔재 제거 효과가 점수에 직접 반영**

## 예상 vs 실제

| 가설 | 예상 | 실제 |
|---|---|---|
| Codex casual은 R1 대비 비슷할 것 | 분산 안 | -3.0 (분산 안, 약간 개선) ✓ |
| Claude casual은 R1과 비슷할 것 | 분산 안 | +4.5 (분산 안, 약간 후퇴) ⚠ |
| Gemini-3 casual은 R1 대비 큰 개선 | -10 이상 | -9.0 ✓ |

Claude의 +4.5는 단락 1개 R2에서는 -0.6이었는데 35줄에선 +4.5로 뒤집힘. **친근체 어휘가 긴 텍스트에서 viral-hook을 더 강하게 활성화**하는 것으로 보임.

## 발견: Claude × casual × long-form 조합의 역효과

Round 2 (단락 1개): Claude 2.0 → 1.4 (개선)
Round 3 (35줄 전체): Claude 13.1 → 17.6 (후퇴)

이유 추정:
1. 단락 1개에서는 친근체가 voice로만 작용
2. 긴 텍스트에서는 친근체 어휘 ("에이/솔직히/~잖아요?")가 viral-hook #5 AI 인플루언서 어휘 패턴과 충돌
3. Claude는 strict prompt에서 패턴 정의를 적극 활용해 humanize → 친근체+viral-hook의 *경계* 위에서 진동

→ **patina의 ko-viral-hook #5와 ko-casual-conversation의 영역 분리 필요**.

## Round 4 후보 — Claude long-form 후퇴 해결

### A. casual-conversation 프로필에 viral-hook #5 reduce 추가

```yaml
pattern-overrides:
  ko:
    "viral-hook-5": reduce  # 인플루언서 어휘 — casual에서는 일부 허용
```

`에이/솔직히/~잖아요?` 같은 친근체 입말 어휘가 viral-hook #5(AI 인플루언서 어휘)와 다르다는 점을 프로필 단에서 명시.

### B. ko-viral-hook #5의 발화 조건 강화

현재 #5는 "한 글에 1개 등장 → Low" 인데, casual 어휘와의 구분이 필요. "역대급/미친 듯이/판이 바뀌었다" 같은 인플루언서 특유 어휘는 amplify 유지하되, "에이/솔직히/진짜로" 같은 입말 충완어는 발화 제외.

### C. 모델별 voice profile 조합 매핑

`profiles/_voice/<model>.md` (Phase 3.3 후속):
- Claude × long-form casual에는 별도 profile override 적용
- Codex/Gemini는 그대로

### D. variants와 결합

`--variants 3 --profile casual-conversation` — Claude가 친근체 1개, 중간체 1개, 평어체 1개 생성. 사용자가 voice picker로 선택.

### 우선순위

1. **A (프로필 override)** — 즉시 가능, 변경 작음
2. **B (#5 발화 조건)** — 패턴 정의 정밀화, 영향 큼
3. **C (모델별 voice)** — 작업 큼
4. **D (variants)** — 이미 구현된 기능 활용

## R3 voice 정성 평가

긴 텍스트에서도 R2와 동등하게 친근체로 변환됨을 확인. 일부 발췌:

### Codex R3 (13.0)
> 이거 GitHub에서 진짜 미친 속도로 떠버린 도구 얘기예요. 60일 만에 별 25만 개. 광고 한 푼도 안 썼는데, 전 세계 개발자들이 "OpenClaw" 한 줄에 다 달려들었거든요.

→ "이거", "~예요", "거든요" 친근체. R1의 평어 톤보다 명확히 가까움.

### Claude R3 (17.6)
> 이거 GitHub 역사상 이런 속도, 본 적 없어요. 60일 만에 별 25만 개. OpenClaw라는 도구가 세운 기록인데, 광고 하나 없이 전 세계 개발자들이 미쳐서 달려들었어요.

→ "본 적 없어요", "~었어요" 친근체. 다만 "미쳐서 달려들었어요"가 viral-hook #5에 잡힘.

### Gemini-3 R3 (17.1)
> 깃허브에서 이렇게 빨리 뜬 거 본 적 있어요? 60일 만에 별 25만 개를 찍었거든요. OpenClaw라는 툴이 광고 한 푼 안 들이고 해낸 일이에요.

→ "본 적 있어요?", "~거든요", "~이에요" 친근체. R1의 격식 `~습니다`에서 완전히 풀려남.

세 backend 모두 voice는 R2와 동등 수준. 점수 차이는 viral-hook 카테고리의 long-text 누적 신호가 결정.

## 결론

**Round 3 = mixed result.** voice profile은 long-form에서도 voice 측면에서 일관 유효. 다만 ko-viral-hook #5와 ko-casual-conversation의 영역 충돌이 Claude long-form에서 노출됨. Round 4에서 Proposal A·B로 해결할 만함.

워크플로우 진행 상태:
```
✅ Round 1 (case-06): patina v3.11 vs Gemini Web 점수 동등 (단락)
✅ Round 2 (case-07): voice 친밀도 동등 — casual-conversation profile 효과
✅ Round 3 (case-08): long-form 검증 — voice 유지, Claude long-form 후퇴 발견
⬜ Round 4: Claude long-form 회복 — Proposal A (프로필에 viral-hook #5 reduce) 추천
```

## 결과 저장 위치

| File | Score |
|---|---|
| `examples/round3-codex-casual-full.md` | 13.0 |
| `examples/round3-claude-casual-full.md` | 17.6 |
| `examples/round3-gemini-3-casual-full.md` | 17.1 |
