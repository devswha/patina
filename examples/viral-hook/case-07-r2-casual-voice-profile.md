---
pack: ko-viral-hook
type: workflow-round-2
score_only: true
profile_introduced: casual-conversation
bug_fixed: minimal-prompt-drops-profile-body
---

# Round 2: `casual-conversation` voice profile (Proposal B 구현)

Round 1에서 발견한 voice gap("점수는 0인데 카페 친구 톤은 못 맞춤") 해결 시도.
Proposal B를 채택해 신규 voice profile `casual-conversation`을 추가하고, 같은 단락에 적용해 voice 친밀도를 끌어올렸다. 진행 중 minimal prompt 버그 1개 발견·수정.

## 변경 요약

1. **신규 프로필**: `profiles/casual-conversation.md`
   - voice-overrides: first-person/opinions/rhythm/messiness/concrete-emotions/reader-address/hedge-tone 강화
   - pattern-overrides: ko #8(`~적` 접미사) amplify, ko #18(한자어) amplify, ko #14(볼드) suppress, ko #19(챗봇) reduce
   - 가이드: `~잖아요?/~죠/~겠어요?` 종결어미, `에이~/솔직히/진짜로` 입말 충완어, "친구가 옆에 앉아있는 톤"

2. **버그 발견·수정**: `buildMinimalPrompt`가 profile body를 받지 않아 minimal mode에서 voice profile이 무시되던 이슈
   - 증상: Gemini-3가 R2 strict는 친근체로, minimal은 격식체로 출력
   - 수정: profile 인자 추가 + 프롬프트에 "## 톤·프로필 가이드" 섹션 삽입
   - 영향: minimal prompt 사이즈 2.9KB → 4.0KB (여전히 strict 34KB 대비 88% 압축)

## 입력 (Round 1과 동일)

`examples/gemini-web/original-paragraph.txt` — sample.md 두 번째 단락 4줄.

## R1 → R2 점수 추이

| Backend | R1 (default profile) | R2 (casual-conversation) | Δ | Voice 변화 |
|---|---|---|---|---|
| Codex | 0.0 | 2.2 | +2.2 | `~다` 평어 → **`~요/~잖아요?`** |
| Claude | 2.0 | 1.4 | -0.6 | `~다`+`~거임` → **`~잖아요?/솔직히`** |
| Gemini-3 (initial) | 4.2 | 0.0* | -4.2 | 격식 `~습니다` → 격식 `~습니다` ⚠ |
| Gemini-3 (after fix) | — | **0.0** | — | 격식 → **`~요/~잖아요?/~거든요`** ✓ |

*점수 0.0은 voice match 실패 케이스 — minimal prompt 버그로 친근체 변환 미적용. 실제 voice 평가는 fix 후 결과만 유효.

세 backend 모두 점수가 ±10 분산 안에 있으면서 voice는 결정적으로 개선. 점수의 "노이즈 같은" 흔들림을 voice 변화가 명확히 정당화한다.

## Voice 정성 비교 (R1 vs R2)

### Codex
- **R1**: "마케팅으로 뜬 게 아니다. ... 보통 현장이 먼저 알아본다." (뉴스 평어 톤)
- **R2**: "에이, 마케팅 잘해서 뜬 거 아니에요. ... 결국 사람들이 먼저 알아봐요." (카페 친구 톤) ✓

### Claude
- **R1**: "마케팅 잘해서 뜬 게 아니다. ... 대중이 먼저 안다." (블로그 댓글 톤)
- **R2**: "이거 마케팅으로 뜬 거 아니에요. ... 솔직히 사람들이 먼저 알아봐요." (대화체) ✓

### Gemini-3 (after fix)
- **R1**: "마케팅을 잘해서 뜬 게 아닙니다. ... 사람들이 먼저 알아보게 되어 있습니다." (격식 뉴스레터)
- **R2 (fixed)**: "에이, 이거 마케팅 잘해서 뜬 거 아니에요. ... 사람들이 제일 먼저 알아보는 법이거든요." (대화체) ✓

## Gemini Web v3 기준선과의 voice 친밀도 비교

| Variant | 점수 | 도입 어미 | 본문 종결 | 친밀도 평가 |
|---|---|---|---|---|
| Gemini Web v3-casual | 0.0 | "에이," | `~겠어요?/~기 마련이에요` | ⭐⭐⭐⭐⭐ |
| **Codex R2** | 2.2 | "에이," | `~잖아요?/~봐요` | ⭐⭐⭐⭐ |
| **Claude R2** | 1.4 | "이거" | `~잖아요?/솔직히 ~봐요` | ⭐⭐⭐⭐ |
| **Gemini-3 R2 fixed** | 0.0 | "에이, 이거" | `~잖아요?/~거든요` | ⭐⭐⭐⭐⭐ |

세 backend 모두 R1 대비 큰 voice 개선. **Gemini-3 fixed**는 사용자 직관과 가장 가깝게 변환됨 — Gemini Web v3-casual의 voice를 거의 동등 수준으로 재현.

## 검증 포인트

- ✅ 점수: 모두 0~3 사이 (human band)
- ✅ Voice: `~요/~잖아요?/~죠` 친근체 일관 (3 backend)
- ✅ 의미 보존: NVIDIA·새벽 3시·OpenClaw·핵심 4개 주장 모두 유지
- ✅ minimal-prompt-profile fix: tests/unit/tone.test.js 140/140 pass

## 부수 발견 (다음 라운드 후보)

### 1. R2 점수가 R1 대비 일부 상승 (Codex 0.0 → 2.2)

`에이/솔직히/~잖아요?` 같은 입말 어휘가 ko-content #1(과도한 중요성)이나 viral-hook #5(인플루언서 어휘) 인접 영역으로 분류될 가능성. **정성적 voice는 명확히 개선**됐는데 점수는 약간 상승하는 역설.

→ Round 3 후보: short-text scoring boost 적용 시 친근체 어휘를 어떻게 분류할지 재검토. 친근체는 인플루언서 톤과 다른 신호이므로 추가 카테고리(예: `intimacy`)가 필요할 수도.

### 2. Voice profile body가 minimal prompt에서 더 효과적

흥미롭게도 strict 모드에서는 카테고리 prefix·예시·voice 가이드 등이 모두 들어가서 모델이 어디에 집중할지 결정하지만, minimal 모드에서는 profile body가 거의 단독으로 voice를 결정함. **minimal + casual-conversation 조합이 의외로 voice 정렬에 더 효과적**일 가능성 — case-05 결과(Gemini는 minimal이 좋음)와 일관.

### 3. Persona 카테고리(Proposal A) 보류

Round 2 결과로 voice profile이 직접 voice 변화를 끌어내므로 Proposal A(persona detection 카테고리)는 우선순위 하향. 사용자가 점수 둔감성을 명확히 문제 삼을 때 다시 검토.

## 결과 저장 위치

| File | Description | Score |
|---|---|---|
| `examples/round2-codex-casual.txt` | Codex R2 casual rewrite | 2.2 |
| `examples/round2-claude-casual.txt` | Claude R2 casual rewrite | 1.4 |
| `examples/round2-gemini-3-casual.txt` | Gemini-3 R2 (initial, profile dropped) | 0.0 |
| `examples/round2-gemini-3-casual-fixed.txt` | Gemini-3 R2 (after fix) | **0.0** ✓ |

## 결론

**Proposal B (`casual-conversation` voice profile) 효과 검증 완료.** patina v3.11 + 새 프로필로 친밀한 대화체 voice 정렬 가능. 발견된 minimal prompt 버그도 수정 완료.

Round 3 후보:
- **A. 다른 입력 장르 검증**: 기술/학술/내러티브로 일반화 검증
- **B. 더 긴 입력**: 단락 1개 → 전체 글로 확장 검증 (sample.md 35줄)
- **C. variants와 결합**: `--profile casual-conversation --variants 3` 으로 친밀체 다양성 탐색
- **D. patina-max 통합**: 모델별 best 자동 선택
